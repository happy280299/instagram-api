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
}
