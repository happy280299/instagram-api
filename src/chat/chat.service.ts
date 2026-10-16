import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  toAvatarUrl,
  toPublicUrl,
  toVideoThumbnailUrl,
} from '../common/public-url';
import { UploadsService } from '../uploads/uploads.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RealtimeEvent } from '../realtime/realtime.events';
import { PresenceService } from '../realtime/presence.service';
import { ConversationQueryDto } from './dto/conversation-query.dto';
import { MessageQueryDto } from './dto/message-query.dto';
import { SendMessageDto } from './dto/send-message.dto';

const memberUserSelect = {
  id: true,
  username: true,
  name: true,
  avatarUrl: true,
  isVerified: true,
} satisfies Prisma.UserSelect;

const messageSelect = {
  id: true,
  conversationId: true,
  content: true,
  mediaUrl: true,
  mediaType: true,
  mediaWidth: true,
  mediaHeight: true,
  createdAt: true,
  sender: { select: { id: true, username: true, avatarUrl: true } },
} satisfies Prisma.MessageSelect;

type MessageRow = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private prisma: PrismaService,
    private uploads: UploadsService,
    private realtime: RealtimeService,
    private presence: PresenceService,
  ) {}

  // Bấm "Nhắn tin" trên profile: mở cuộc trò chuyện 1-1, chưa có thì tạo (chưa có tin nhắn nào)
  async openDirect(username: string, me: number) {
    const other = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (!other) throw new NotFoundException('User not found');
    if (other.id === me) {
      throw new BadRequestException('You cannot message yourself');
    }

    const directKey = [me, other.id].sort((a, b) => a - b).join(':');
    let conversation = await this.prisma.conversation.findUnique({
      where: { directKey },
      select: { id: true },
    });
    if (!conversation) {
      try {
        conversation = await this.prisma.conversation.create({
          data: {
            directKey,
            members: { create: [{ userId: me }, { userId: other.id }] },
          },
          select: { id: true },
        });
      } catch (err) {
        // 2 người cùng bấm "Nhắn tin" 1 lúc -> trùng directKey: dùng cái vừa được tạo
        if ((err as { code?: string }).code !== 'P2002') throw err;
        conversation = await this.prisma.conversation.findUniqueOrThrow({
          where: { directKey },
          select: { id: true },
        });
      }
    }
    return this.findOne(conversation.id, me);
  }

  // Hộp thư: cuộc trò chuyện đã có tin nhắn, mới nhắn gần nhất trước.
  // Cursor = id cuộc trò chuyện cuối trang (so theo lastMessageAt của nó)
  async findAll(me: number, q: ConversationQueryDto) {
    let after = Prisma.empty;
    if (q.cursor) {
      const c = await this.prisma.conversation.findUnique({
        where: { id: q.cursor },
        select: { lastMessageAt: true },
      });
      if (c?.lastMessageAt) {
        after = Prisma.sql`AND (c."lastMessageAt", c.id) < (${c.lastMessageAt}, ${q.cursor})`;
      }
    }

    const rows = await this.prisma.$queryRaw<
      { id: number; unreadCount: number }[]
    >`
      SELECT c.id, ${this.unreadSql(me)} AS "unreadCount"
      FROM "ConversationMember" m
      JOIN "Conversation" c ON c.id = m."conversationId"
      WHERE m."userId" = ${me} AND c."lastMessageAt" IS NOT NULL ${after}
      ORDER BY c."lastMessageAt" DESC, c.id DESC
      LIMIT ${q.limit + 1}
    `;
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const items = await this.hydrate(
      page.map((r) => r.id),
      me,
    );

    return {
      data: page.map((r) => ({
        ...items.get(r.id)!,
        unreadCount: r.unreadCount,
      })),
      meta: {
        limit: q.limit,
        nextCursor: hasMore ? page[page.length - 1].id : null,
        hasMore,
      },
    };
  }

  async findOne(id: number, me: number) {
    await this.ensureMember(id, me);
    const [items, [{ unreadCount }]] = await Promise.all([
      this.hydrate([id], me),
      this.prisma.$queryRaw<{ unreadCount: number }[]>`
        SELECT ${this.unreadSql(me)} AS "unreadCount"
        FROM "ConversationMember" m
        WHERE m."conversationId" = ${id} AND m."userId" = ${me}
      `,
    ]);
    return { ...items.get(id)!, unreadCount };
  }

  // Tin nhắn mới nhất trước; kéo lên để tải tin cũ hơn (cursor = id tin cũ nhất đang có)
  async findMessages(id: number, me: number, q: MessageQueryDto) {
    await this.ensureMember(id, me);
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId: id,
        deletedAt: null,
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
      select: messageSelect,
    });
    const hasMore = rows.length > q.limit;
    const messages = hasMore ? rows.slice(0, q.limit) : rows;
    return {
      data: messages.map(toMessage),
      meta: {
        limit: q.limit,
        nextCursor: hasMore ? messages[messages.length - 1].id : null,
        hasMore,
      },
    };
  }

  async send(id: number, dto: SendMessageDto, me: number) {
    await this.ensureMember(id, me);
    const content = dto.content ?? '';
    // ảnh / video phải upload qua POST /uploads trước (giống post, story)
    const media = dto.mediaUrl
      ? await this.uploads.resolve(dto.mediaUrl)
      : null;
    if (!content && !media) {
      throw new BadRequestException('Message cannot be empty');
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const m = await tx.message.create({
        data: {
          conversationId: id,
          senderId: me,
          content,
          mediaUrl: media?.path,
          mediaType: media?.type,
          mediaWidth: media?.width,
          mediaHeight: media?.height,
        },
        select: messageSelect,
      });
      await tx.conversation.update({
        where: { id },
        data: { lastMessageAt: m.createdAt, lastMessageId: m.id },
      });
      // tin của chính mình thì coi như mình đã đọc
      await tx.conversationMember.update({
        where: { conversationId_userId: { conversationId: id, userId: me } },
        data: { lastReadMessageId: m.id },
      });
      return m;
    });

    const payload = toMessage(message);
    const members = await this.memberIds(id);
    // gửi cả cho chính mình: tab / thiết bị khác của mình cũng thấy tin vừa gửi
    this.realtime.emitToUsers(members, RealtimeEvent.MessageNew, payload);
    await this.pushUnreadCount(members.filter((u) => u !== me));
    return payload;
  }

  // Mở cuộc trò chuyện -> đánh dấu đã đọc tới tin mới nhất, báo "Đã xem" cho người kia
  async markRead(id: number, me: number) {
    await this.ensureMember(id, me);
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id },
      select: { lastMessageId: true },
    });
    const lastReadMessageId = conversation.lastMessageId;
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: id, userId: me } },
      data: { lastReadMessageId },
    });

    this.realtime.emitToUsers(
      await this.memberIds(id),
      RealtimeEvent.ConversationRead,
      { conversationId: id, userId: me, lastReadMessageId },
    );
    await this.pushUnreadCount([me]);
    return { conversationId: id, lastReadMessageId };
  }

  // Thu hồi: chỉ người gửi, ẩn với mọi người (giống "Unsend" của Instagram)
  async unsend(messageId: number, me: number) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { senderId: true, conversationId: true, deletedAt: true },
    });
    if (!message || message.deletedAt) {
      throw new NotFoundException('Message not found');
    }
    if (message.senderId !== me) {
      throw new ForbiddenException('You can only unsend your own messages');
    }

    const { conversationId } = message;
    await this.prisma.$transaction(async (tx) => {
      await tx.message.update({
        where: { id: messageId },
        data: { deletedAt: new Date(), content: '', mediaUrl: null },
      });
      // tin bị thu hồi là tin cuối -> preview trong hộp thư lùi về tin trước đó
      const latest = await tx.message.findFirst({
        where: { conversationId, deletedAt: null },
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageId: latest?.id ?? null },
      });
    });

    const members = await this.memberIds(conversationId);
    this.realtime.emitToUsers(members, RealtimeEvent.MessageDeleted, {
      conversationId,
      messageId,
    });
    await this.pushUnreadCount(members.filter((u) => u !== me));
    return null;
  }

  // Chấm đỏ trên icon tin nhắn: số cuộc trò chuyện còn tin chưa đọc
  async unreadCount(me: number) {
    const [{ count }] = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "ConversationMember" m
      WHERE m."userId" = ${me} AND ${this.unreadSql(me)} > 0
    `;
    return { count };
  }

  // Gọi từ ChatGateway khi client gửi 'conversation:typing'
  async typing(conversationId: number, me: number, isTyping: boolean) {
    const members = await this.memberIds(conversationId);
    if (!members.includes(me)) return; // không phải thành viên -> bỏ qua
    this.realtime.emitToUsers(
      members.filter((u) => u !== me),
      RealtimeEvent.ConversationTyping,
      { conversationId, userId: me, isTyping },
    );
  }

  // Số tin chưa đọc của `me` trong cuộc trò chuyện m."conversationId" (m = ConversationMember)
  private unreadSql(me: number) {
    return Prisma.sql`(
      SELECT count(*)::int FROM "Message" x
      WHERE x."conversationId" = m."conversationId"
        AND x.id > COALESCE(m."lastReadMessageId", 0)
        AND x."senderId" <> ${me}
        AND x."deletedAt" IS NULL
    )`;
  }

  // Thông tin hiển thị của nhiều cuộc trò chuyện (chưa gồm unreadCount)
  private async hydrate(ids: number[], me: number) {
    const conversations = await this.prisma.conversation.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        createdAt: true,
        lastMessageAt: true,
        lastMessageId: true,
        members: {
          select: {
            userId: true,
            lastReadMessageId: true,
            user: {
              select: {
                ...memberUserSelect,
                lastActiveAt: true,
                showActivityStatus: true,
              },
            },
          },
        },
      },
    });
    const lastIds = conversations
      .map((c) => c.lastMessageId)
      .filter((id): id is number => id !== null);
    const lastMessages = await this.prisma.message.findMany({
      where: { id: { in: lastIds }, deletedAt: null },
      select: messageSelect,
    });
    const lastById = new Map(lastMessages.map((m) => [m.id, toMessage(m)]));

    return new Map(
      conversations.map((c) => {
        const others = c.members.filter((m) => m.userId !== me);
        // mình tắt trạng thái hoạt động thì cũng không thấy của người khác
        const iShow =
          c.members.find((m) => m.userId === me)?.user.showActivityStatus ??
          false;
        return [
          c.id,
          {
            id: c.id,
            // người còn lại trong cuộc trò chuyện (chat 1-1: đúng 1 người)
            members: others.map(
              ({ user: { lastActiveAt, showActivityStatus, ...u } }) => ({
                ...u,
                avatarUrl: toAvatarUrl(u.avatarUrl),
                // "Đang hoạt động" / "Hoạt động x phút trước"; null = bị ẩn
                ...this.presence.presenceFor(
                  { id: u.id, lastActiveAt, showActivityStatus },
                  iShow,
                ),
              }),
            ),
            // để hiện "Đã xem" dưới tin cuối của mình: id tin người kia đã đọc tới
            readStates: others.map((m) => ({
              userId: m.userId,
              lastReadMessageId: m.lastReadMessageId,
            })),
            lastMessage: c.lastMessageId
              ? (lastById.get(c.lastMessageId) ?? null)
              : null,
            lastMessageAt: c.lastMessageAt,
            createdAt: c.createdAt,
          },
        ];
      }),
    );
  }

  private async memberIds(conversationId: number) {
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  // Không phải thành viên thì trả 404 (không để lộ cuộc trò chuyện có tồn tại hay không)
  private async ensureMember(conversationId: number, userId: number) {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { userId: true },
    });
    if (!member) throw new NotFoundException('Conversation not found');
  }

  private async pushUnreadCount(userIds: number[]) {
    for (const userId of userIds) {
      try {
        this.realtime.emitToUser(
          userId,
          RealtimeEvent.ChatUnreadCount,
          await this.unreadCount(userId),
        );
      } catch (err) {
        this.logger.warn(`push chat unread failed: ${(err as Error).message}`);
      }
    }
  }
}

function toMessage(m: MessageRow) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    sender: { ...m.sender, avatarUrl: toAvatarUrl(m.sender.avatarUrl) },
    content: m.content,
    media: m.mediaUrl
      ? {
          url: toPublicUrl(m.mediaUrl),
          type: m.mediaType,
          width: m.mediaWidth,
          height: m.mediaHeight,
          thumbnailUrl:
            m.mediaType === 'VIDEO' ? toVideoThumbnailUrl(m.mediaUrl) : null,
        }
      : null,
    createdAt: m.createdAt,
  };
}
