import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { postInclude, toFeedPost } from '../feed/feed.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UserPostsQueryDto } from './dto/user-posts-query.dto';

@Injectable()
export class PostsService {
  constructor(
    private prisma: PrismaService,
    private uploads: UploadsService,
  ) {}

  async create(dto: CreatePostDto, userId: number) {
    const media = await Promise.all(
      dto.media.map((m) => this.uploads.resolve(m.url)),
    );

    // Nested create chạy trong 1 transaction: Post + PostMedia cùng thành công hoặc cùng lỗi
    const post = await this.prisma.post.create({
      data: {
        authorId: userId,
        caption: dto.caption,
        location: dto.location || null,
        media: {
          create: media.map((m, order) => ({
            url: m.path,
            type: m.type,
            width: m.width,
            height: m.height,
            order,
          })),
        },
      },
      include: postInclude(userId),
    });

    // Cùng shape với 1 item của GET /api/feed để FE dùng lại mapper
    return toFeedPost(post, userId);
  }

  // Chi tiết 1 bài (mở từ grid profile, link chia sẻ...), cùng shape với 1 item của feed
  async findOne(id: number, viewerId?: number) {
    const post = await this.prisma.post.findFirst({
      where: { id, deletedAt: null },
      include: postInclude(viewerId),
    });
    if (!post) throw new NotFoundException('Post not found');
    return toFeedPost(post, viewerId);
  }

  // Bài viết trên trang profile của 1 user, mới nhất trước (UsersService kiểm tra user tồn tại)
  async findByUser(userId: number, q: UserPostsQueryDto, viewerId?: number) {
    // Lấy dư 1 bản ghi để biết còn trang sau không
    const rows = await this.prisma.post.findMany({
      where: { authorId: userId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: postInclude(viewerId),
    });
    const hasMore = rows.length > q.limit;
    const posts = hasMore ? rows.slice(0, q.limit) : rows;

    return {
      data: posts.map((p) => toFeedPost(p, viewerId)),
      meta: {
        limit: q.limit,
        nextCursor: hasMore ? posts[posts.length - 1].id : null,
        hasMore,
      },
    };
  }

  // Like / bỏ like đều idempotent: bấm nhiều lần (double tap, retry) không lỗi, không tạo trùng
  async like(postId: number, userId: number) {
    await this.ensurePost(postId);
    await this.prisma.like.createMany({
      data: { postId, userId },
      skipDuplicates: true,
    });
    return this.likeState(postId, true);
  }

  async unlike(postId: number, userId: number) {
    await this.ensurePost(postId);
    await this.prisma.like.deleteMany({ where: { postId, userId } });
    return this.likeState(postId, false);
  }

  // Lưu / bỏ lưu: idempotent giống like. Chỉ chủ tài khoản thấy mình đã lưu gì
  async save(postId: number, userId: number) {
    await this.ensurePost(postId);
    await this.prisma.savedPost.createMany({
      data: { postId, userId },
      skipDuplicates: true,
    });
    return { postId, isSaved: true };
  }

  async unsave(postId: number, userId: number) {
    await this.ensurePost(postId);
    await this.prisma.savedPost.deleteMany({ where: { postId, userId } });
    return { postId, isSaved: false };
  }

  // Tab "Saved" trên profile của chính mình: lưu gần đây nhất trước.
  // Cursor = postId của bài cuối trang, ghép với userId thành khoá chính (userId, postId)
  async findSaved(userId: number, q: UserPostsQueryDto) {
    const rows = await this.prisma.savedPost.findMany({
      // bài đã bị xoá (soft delete) thì ẩn khỏi danh sách
      where: { userId, post: { deletedAt: null } },
      orderBy: [{ createdAt: 'desc' }, { postId: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor
        ? {
            cursor: { userId_postId: { userId, postId: q.cursor } },
            skip: 1,
          }
        : {}),
      select: { post: { include: postInclude(userId) } },
    });
    const hasMore = rows.length > q.limit;
    const posts = (hasMore ? rows.slice(0, q.limit) : rows).map((r) => r.post);

    return {
      data: posts.map((p) => toFeedPost(p, userId)),
      meta: {
        limit: q.limit,
        nextCursor: hasMore ? posts[posts.length - 1].id : null,
        hasMore,
      },
    };
  }

  // Trả likeCount mới để FE cập nhật lại số đã tăng/giảm trước (optimistic update)
  private async likeState(postId: number, isLiked: boolean) {
    const likeCount = await this.prisma.like.count({ where: { postId } });
    return { postId, isLiked, likeCount };
  }

  private async ensurePost(postId: number) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true },
    });
    if (!post) throw new NotFoundException('Post not found');
  }
}
