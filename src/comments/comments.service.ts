import {
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

const commentSelect = {
  id: true,
  content: true,
  createdAt: true,
  author: {
    select: { id: true, username: true, avatarUrl: true, isVerified: true },
  },
} satisfies Prisma.CommentSelect;

type CommentRow = Prisma.CommentGetPayload<{ select: typeof commentSelect }>;

@Injectable()
export class CommentsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async findAll(postId: number, q: CommentQueryDto, viewerId?: number) {
    await this.ensurePost(postId);

    // Cũ trước, mới sau (giống Instagram); lấy dư 1 bản ghi để biết còn trang sau không
    const rows = await this.prisma.comment.findMany({
      where: { postId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: commentSelect,
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

  async create(postId: number, dto: CreateCommentDto, userId: number) {
    const post = await this.ensurePost(postId);
    const comment = await this.prisma.comment.create({
      data: { postId, authorId: userId, content: dto.content },
      select: commentSelect,
    });
    // Xoá comment thì thông báo này tự mất (Cascade theo commentId)
    await this.notifications.notify({
      type: 'COMMENT',
      recipientId: post.authorId,
      actorId: userId,
      postId,
      commentId: comment.id,
    });
    return toComment(comment, userId);
  }

  // Được xoá: người viết comment, chủ bài post, hoặc ADMIN
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

    await this.prisma.comment.delete({ where: { id } });
    // thông báo COMMENT bị xoá theo Cascade -> cập nhật lại chấm đỏ của chủ bài
    await this.notifications.syncUnreadCount(comment.post.authorId);
    return null;
  }

  private async ensurePost(postId: number) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true, authorId: true },
    });
    if (!post) throw new NotFoundException('Không tìm thấy bài viết');
    return post;
  }
}

function toComment(c: CommentRow, viewerId?: number) {
  return {
    ...c,
    author: { ...c.author, avatarUrl: toAvatarUrl(c.author.avatarUrl) },
    isMine: c.author.id === viewerId,
  };
}
