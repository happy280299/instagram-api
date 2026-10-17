import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { toAvatarUrl } from '../common/public-url';
import { JwtPayload } from '../auth/jwt-payload';
import { CommentQueryDto } from './dto/comment-query.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { extractMentions } from '../common/text-entities';

// viewerId = undefined (khách) thì không cần biết mình đã like chưa
function commentSelect(viewerId?: number) {
  return {
    id: true,
    content: true,
    createdAt: true,
    parentId: true,
    author: {
      select: { id: true, username: true, avatarUrl: true, isVerified: true },
    },
    likes: viewerId
      ? { where: { userId: viewerId }, take: 1, select: { userId: true } }
      : false,
    _count: { select: { likes: true, replies: true } },
  } satisfies Prisma.CommentSelect;
}

type CommentRow = Prisma.CommentGetPayload<{
  select: ReturnType<typeof commentSelect>;
}>;

@Injectable()
export class CommentsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // Comment gốc của bài (cũ trước, mới sau - giống Instagram), kèm replyCount để hiện
  // "Xem N câu trả lời"; câu trả lời tải riêng qua findReplies
  async findAll(postId: number, q: CommentQueryDto, viewerId?: number) {
    await this.ensurePost(postId);
    return this.page({ postId, parentId: null }, q, viewerId);
  }

  async findReplies(commentId: number, q: CommentQueryDto, viewerId?: number) {
    const parent = await this.ensureComment(commentId);
    if (parent.parentId) {
      throw new BadRequestException('Replies only have one level');
    }
    return this.page({ parentId: commentId }, q, viewerId);
  }

  // parentId: trả lời 1 comment. Trả lời 1 câu trả lời thì gắn vào comment gốc của nó
  async create(postId: number, dto: CreateCommentDto, userId: number) {
    const post = await this.ensurePost(postId);

    let parent: { id: number; authorId: number } | null = null;
    if (dto.parentId) {
      const target = await this.prisma.comment.findFirst({
        where: { id: dto.parentId, postId },
        select: {
          id: true,
          authorId: true,
          parent: { select: { id: true, authorId: true } },
        },
      });
      if (!target) throw new NotFoundException('Comment not found');
      parent = target.parent ?? { id: target.id, authorId: target.authorId };
    }

    const comment = await this.prisma.comment.create({
      data: {
        postId,
        authorId: userId,
        content: dto.content,
        parentId: parent?.id,
      },
      select: commentSelect(userId),
    });

    // Xoá comment thì các thông báo này tự mất (Cascade theo commentId)
    await this.notifications.notify({
      type: 'COMMENT',
      recipientId: post.authorId,
      actorId: userId,
      postId,
      commentId: comment.id,
    });
    // người viết comment gốc (nếu không phải chủ bài - chủ bài đã nhận COMMENT)
    if (parent && parent.authorId !== post.authorId) {
      await this.notifications.notify({
        type: 'REPLY',
        recipientId: parent.authorId,
        actorId: userId,
        postId,
        commentId: comment.id,
      });
    }
    // ai đã nhận COMMENT / REPLY ở trên thì không báo thêm MENTION
    await this.notifications.notifyMentions({
      usernames: extractMentions(dto.content),
      actorId: userId,
      postId,
      commentId: comment.id,
      skip: [post.authorId, ...(parent ? [parent.authorId] : [])],
    });
    return toComment(comment, userId);
  }

  // Like / bỏ like comment: idempotent giống like bài
  async like(commentId: number, userId: number) {
    const comment = await this.ensureComment(commentId);
    const { count } = await this.prisma.commentLike.createMany({
      data: { commentId, userId },
      skipDuplicates: true,
    });
    if (count) {
      await this.notifications.notify({
        type: 'COMMENT_LIKE',
        recipientId: comment.authorId,
        actorId: userId,
        postId: comment.postId,
        commentId,
      });
    }
    return this.likeState(commentId, true);
  }

  async unlike(commentId: number, userId: number) {
    await this.ensureComment(commentId);
    const { count } = await this.prisma.commentLike.deleteMany({
      where: { commentId, userId },
    });
    if (count) {
      await this.notifications.retract({
        type: 'COMMENT_LIKE',
        actorId: userId,
        commentId,
      });
    }
    return this.likeState(commentId, false);
  }

  // Được xoá: người viết comment, chủ bài post, hoặc ADMIN.
  // Xoá comment gốc thì các câu trả lời bị xoá theo (Cascade)
  async remove(id: number, user: JwtPayload) {
    const comment = await this.prisma.comment.findUnique({
      where: { id },
      select: { authorId: true, post: { select: { authorId: true } } },
    });
    if (!comment) throw new NotFoundException('Không tìm thấy bình luận');

    const allowed =
      comment.authorId === user.sub ||
      comment.post.authorId === user.sub ||
      user.role === 'ADMIN';
    if (!allowed) {
      throw new ForbiddenException('Bạn không có quyền xoá bình luận này');
    }

    // những ai sẽ mất thông báo (của comment này + các câu trả lời) -> cập nhật lại chấm đỏ
    const affected = await this.prisma.notification.findMany({
      where: { OR: [{ commentId: id }, { comment: { parentId: id } }] },
      distinct: ['recipientId'],
      select: { recipientId: true },
    });
    await this.prisma.comment.delete({ where: { id } });
    for (const { recipientId } of affected) {
      await this.notifications.syncUnreadCount(recipientId);
    }
    return null;
  }

  // Cursor pagination, cũ trước; lấy dư 1 bản ghi để biết còn trang sau không
  private async page(
    where: Prisma.CommentWhereInput,
    q: CommentQueryDto,
    viewerId?: number,
  ) {
    const rows = await this.prisma.comment.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: commentSelect(viewerId),
    });
    const hasMore = rows.length > q.limit;
    const comments = hasMore ? rows.slice(0, q.limit) : rows;
    return {
      data: comments.map((c) => toComment(c, viewerId)),
      meta: {
        limit: q.limit,
        nextCursor: hasMore ? comments[comments.length - 1].id : null,
        hasMore,
      },
    };
  }

  private async likeState(commentId: number, isLiked: boolean) {
    const likeCount = await this.prisma.commentLike.count({
      where: { commentId },
    });
    return { commentId, isLiked, likeCount };
  }

  private async ensurePost(postId: number) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true, authorId: true },
    });
    if (!post) throw new NotFoundException('Không tìm thấy bài viết');
    return post;
  }

  // Comment còn tồn tại và bài của nó chưa bị xoá
  private async ensureComment(commentId: number) {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, post: { deletedAt: null } },
      select: { id: true, authorId: true, postId: true, parentId: true },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    return comment;
  }
}

function toComment(c: CommentRow, viewerId?: number) {
  const { likes, _count, ...rest } = c;
  return {
    ...rest,
    author: { ...c.author, avatarUrl: toAvatarUrl(c.author.avatarUrl) },
    isMine: c.author.id === viewerId,
    likeCount: _count.likes,
    isLiked: !!likes?.length,
    // chỉ comment gốc mới có câu trả lời
    replyCount: _count.replies,
  };
}
