import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType, Prisma } from '../generated/prisma/client';
import {
  toAvatarUrl,
  toPublicUrl,
  toVideoThumbnailUrl,
} from '../common/public-url';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { RealtimeService } from '../realtime/realtime.service';
import { RealtimeEvent } from '../realtime/realtime.events';
import { MAX_MENTIONS } from '../common/text-entities';

// "A, B và 12 người khác đã thích..." -> hiện tối đa chừng này avatar
const PREVIEW_ACTORS = 2;
// Thông báo cũ hơn chừng này ngày thì job xoá đi
const RETENTION_DAYS = 90;

type NotifyInput = {
  type: NotificationType;
  recipientId: number;
  actorId: number;
  postId?: number;
  commentId?: number;
};

type GroupRow = {
  lastId: number;
  type: NotificationType;
  latestAt: Date;
  actorCount: number;
  isRead: boolean;
  actorIds: number[];
  postId: number | null;
  commentId: number | null;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
  ) {}

  // Gọi sau khi like / comment / follow thành công. Lỗi ở đây không được làm hỏng
  // hành động chính -> chỉ ghi log
  async notify(input: NotifyInput) {
    if (input.recipientId === input.actorId) return; // tự tương tác với chính mình
    try {
      await this.prisma.notification.create({ data: input });
      await this.pushNew(input.recipientId);
    } catch (err) {
      this.logger.warn(
        `notify ${input.type} failed: ${(err as Error).message}`,
      );
    }
  }

  // Bỏ like / bỏ follow thì gỡ thông báo tương ứng (giống Instagram)
  async retract(where: {
    type: NotificationType;
    actorId: number;
    postId?: number;
    recipientId?: number;
    commentId?: number | null;
  }) {
    try {
      // cần biết ai mất thông báo để cập nhật lại chấm đỏ của họ
      const rows = await this.prisma.notification.findMany({
        where,
        select: { id: true, recipientId: true },
      });
      if (!rows.length) return;
      await this.prisma.notification.deleteMany({
        where: { id: { in: rows.map((r) => r.id) } },
      });
      for (const id of new Set(rows.map((r) => r.recipientId))) {
        await this.syncUnreadCount(id);
      }
    } catch (err) {
      this.logger.warn(
        `retract ${where.type} failed: ${(err as Error).message}`,
      );
    }
  }

  // @nhắc tên trong caption (commentId = undefined) hoặc comment. `skip`: người đã nhận
  // thông báo khác cho cùng hành động (vd. chủ bài đã nhận COMMENT) -> không báo 2 lần
  async notifyMentions(input: {
    usernames: string[];
    actorId: number;
    postId: number;
    commentId?: number;
    skip?: number[];
  }) {
    if (!input.usernames.length) return;
    const users = await this.prisma.user.findMany({
      where: { username: { in: input.usernames.slice(0, MAX_MENTIONS) } },
      select: { id: true },
    });
    for (const { id } of users) {
      if (input.skip?.includes(id)) continue;
      await this.notify({
        type: 'MENTION',
        recipientId: id,
        actorId: input.actorId,
        postId: input.postId,
        commentId: input.commentId,
      });
    }
  }

  // Thông báo bị xoá theo Cascade (vd. xoá comment) -> gọi để cập nhật lại chấm đỏ
  async syncUnreadCount(userId: number) {
    try {
      const payload = await this.unreadCount(userId);
      this.realtime.emitToUser(
        userId,
        RealtimeEvent.NotificationUnreadCount,
        payload,
      );
    } catch (err) {
      this.logger.warn(`sync unread count failed: ${(err as Error).message}`);
    }
  }

  // Đẩy mục mới nhất (đã gộp, cùng shape với 1 phần tử của GET /notifications) + số chưa đọc
  private async pushNew(userId: number) {
    const { data } = await this.findAll(userId, {
      limit: 1,
    } as NotificationQueryDto);
    if (data[0]) {
      this.realtime.emitToUser(userId, RealtimeEvent.NotificationNew, data[0]);
    }
    await this.syncUnreadCount(userId);
  }

  // Màn Activity: like cùng 1 bài (hoặc cùng 1 comment) trong cùng 1 ngày gộp thành 1 mục,
  // các loại khác giữ riêng.
  // Sắp theo hành động mới nhất của mỗi mục; cursor = id của mục cuối trang
  async findAll(userId: number, q: NotificationQueryDto) {
    const groups = await this.prisma.$queryRaw<GroupRow[]>`
      SELECT max(n.id) AS "lastId",
             min(n.type::text) AS type,
             max(n."createdAt") AS "latestAt",
             count(*)::int AS "actorCount",
             bool_and(n."readAt" IS NOT NULL) AS "isRead",
             (array_agg(n."actorId" ORDER BY n.id DESC))[1:${PREVIEW_ACTORS}] AS "actorIds",
             min(n."postId") AS "postId",
             min(n."commentId") AS "commentId"
      FROM "Notification" n
      LEFT JOIN "Post" p ON p.id = n."postId"
      WHERE n."recipientId" = ${userId}
        -- bài đã xoá mềm thì ẩn thông báo của bài đó
        AND (n."postId" IS NULL OR p."deletedAt" IS NULL)
      GROUP BY CASE
        WHEN n.type = 'LIKE'
          THEN 'L:' || n."postId" || ':' || to_char(n."createdAt", 'YYYY-MM-DD')
        WHEN n.type = 'COMMENT_LIKE'
          THEN 'CL:' || n."commentId" || ':' || to_char(n."createdAt", 'YYYY-MM-DD')
        ELSE 'N:' || n.id
      END
      ${q.cursor ? Prisma.sql`HAVING max(n.id) < ${q.cursor}` : Prisma.empty}
      ORDER BY max(n.id) DESC
      LIMIT ${q.limit + 1}
    `;
    const hasMore = groups.length > q.limit;
    const page = hasMore ? groups.slice(0, q.limit) : groups;

    // Lấy thông tin actor / post / comment cho cả trang trong 3 query
    const ids = (pick: (g: GroupRow) => (number | null)[]) => [
      ...new Set(page.flatMap(pick).filter((id): id is number => !!id)),
    ];
    const [actors, posts, comments] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids((g) => g.actorIds) } },
        select: {
          id: true,
          username: true,
          avatarUrl: true,
          isVerified: true,
          // để hiện nút "Follow lại" cạnh thông báo FOLLOW
          followers: {
            where: { followerId: userId },
            select: { followerId: true },
          },
        },
      }),
      this.prisma.post.findMany({
        where: { id: { in: ids((g) => [g.postId]) } },
        select: {
          id: true,
          media: {
            orderBy: { order: 'asc' },
            take: 1,
            select: { url: true, type: true },
          },
        },
      }),
      this.prisma.comment.findMany({
        where: { id: { in: ids((g) => [g.commentId]) } },
        select: { id: true, content: true },
      }),
    ]);
    const actorById = new Map(
      actors.map(({ followers, ...a }) => [
        a.id,
        {
          ...a,
          avatarUrl: toAvatarUrl(a.avatarUrl),
          isFollowing: followers.length > 0,
        },
      ]),
    );
    const postById = new Map(
      posts.map((p) => {
        const m = p.media[0];
        const thumbnailUrl = !m
          ? null
          : m.type === 'VIDEO'
            ? toVideoThumbnailUrl(m.url)
            : toPublicUrl(m.url);
        return [p.id, { id: p.id, thumbnailUrl }];
      }),
    );
    const commentById = new Map(comments.map((c) => [c.id, c]));

    return {
      data: page.map((g) => ({
        id: g.lastId,
        type: g.type,
        createdAt: g.latestAt,
        isRead: g.isRead,
        // người làm gần nhất trước; actorCount = tổng số người (để hiện "và N người khác")
        actors: g.actorIds.map((id) => actorById.get(id)).filter((a) => !!a),
        actorCount: g.actorCount,
        post: g.postId ? (postById.get(g.postId) ?? null) : null,
        comment: g.commentId ? (commentById.get(g.commentId) ?? null) : null,
      })),
      meta: {
        limit: q.limit,
        nextCursor: hasMore ? page[page.length - 1].lastId : null,
        hasMore,
      },
    };
  }

  // Chấm đỏ trên icon trái tim: số hành động chưa đọc
  async unreadCount(userId: number) {
    const count = await this.prisma.notification.count({
      where: { recipientId: userId, readAt: null },
    });
    return { count };
  }

  // Mở màn Activity -> đánh dấu đã đọc tất cả
  async markAllRead(userId: number) {
    const { count } = await this.prisma.notification.updateMany({
      where: { recipientId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    // tab / thiết bị khác của cùng user cũng tắt chấm đỏ
    this.realtime.emitToUser(userId, RealtimeEvent.NotificationUnreadCount, {
      count: 0,
    });
    return { updated: count };
  }

  // Mỗi ngày lúc 3h sáng: xoá thông báo cũ hơn 90 ngày
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeOld() {
    const before = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: before } },
    });
    if (count) this.logger.log(`Purged ${count} old notifications`);
    return { purged: count };
  }
}
