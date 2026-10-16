import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { FEED_VISIBLE, postInclude, toFeedPost } from '../feed/feed.service';
import { CreatePostDto } from './dto/create-post.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { UserPostsQueryDto } from './dto/user-posts-query.dto';
import { ReelsQueryDto } from './dto/reels-query.dto';
import { Prisma } from '../generated/prisma/client';

// Tab Reels chỉ xếp hạng trong chừng này reel mới nhất (giới hạn chi phí truy vấn)
const REEL_CANDIDATES = 500;
// Reel đã xem trong chừng này ngày thì không gợi ý lại
const REEL_SEEN_DAYS = 7;

@Injectable()
export class PostsService {
  constructor(
    private prisma: PrismaService,
    private uploads: UploadsService,
    private notifications: NotificationsService,
  ) {}

  async create(dto: CreatePostDto, userId: number) {
    const media = await Promise.all(
      dto.media.map((m) => this.uploads.resolve(m.url)),
    );

    // Giống Instagram: đăng đúng 1 video thì tự thành Reel (carousel có video vẫn là bài thường)
    const isReel = media.length === 1 && media[0].type === 'VIDEO';

    // Nested create chạy trong 1 transaction: Post + PostMedia cùng thành công hoặc cùng lỗi
    const post = await this.prisma.post.create({
      data: {
        authorId: userId,
        caption: dto.caption,
        location: dto.location || null,
        isReel,
        shareToFeed: isReel ? (dto.shareToFeed ?? true) : true,
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

  // Lưới bài chính trên profile, mới nhất trước (UsersService kiểm tra user tồn tại).
  // reels = true: tab Reels trên profile (gồm cả reel không chia sẻ lên feed)
  async findByUser(
    userId: number,
    q: UserPostsQueryDto,
    viewerId?: number,
    reels = false,
  ) {
    // Lấy dư 1 bản ghi để biết còn trang sau không
    const rows = await this.prisma.post.findMany({
      where: {
        authorId: userId,
        deletedAt: null,
        ...(reels ? { isReel: true } : FEED_VISIBLE),
      },
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
    const post = await this.ensurePost(postId);
    const { count } = await this.prisma.like.createMany({
      data: { postId, userId },
      skipDuplicates: true,
    });
    // count = 0: đã like từ trước (bấm lại / retry) -> không báo thêm lần nữa
    if (count) {
      await this.notifications.notify({
        type: 'LIKE',
        recipientId: post.authorId,
        actorId: userId,
        postId,
      });
    }
    return this.likeState(postId, true);
  }

  async unlike(postId: number, userId: number) {
    await this.ensurePost(postId);
    const { count } = await this.prisma.like.deleteMany({
      where: { postId, userId },
    });
    if (count) {
      await this.notifications.retract({
        type: 'LIKE',
        actorId: userId,
        postId,
      });
    }
    return this.likeState(postId, false);
  }

  // Tab Reels: gợi ý cả reel của người chưa follow, xếp theo điểm
  //   (1 + like + 2*comment + 0.1*view) / (số giờ từ lúc đăng + 2)^1.5
  //   x1.5 nếu là người mình follow, x ngẫu nhiên 0.85..1.15 để mỗi lần mở không giống hệt nhau.
  // Bỏ qua reel của chính mình, reel đã xem trong 7 ngày và các id FE gửi trong `exclude`.
  // Thiếu thì lấp lần lượt: reel đã xem của người khác -> reel của chính mình (mới nhất trước),
  // để tab không bị trống khi còn ít reel (vd. mình là người đầu tiên đăng reel)
  async findReels(q: ReelsQueryDto, viewerId?: number) {
    const viewer = viewerId ?? 0;
    const pick = (unseenOnly: boolean, take: number, skip: number[]) =>
      this.prisma.$queryRaw<{ id: number }[]>`
        WITH candidates AS (
          SELECT p.id, p."authorId", p."createdAt"
          FROM "Post" p
          WHERE p."isReel" AND p."deletedAt" IS NULL
            AND p."authorId" <> ${viewer}
            AND NOT (p.id = ANY(${skip}::int[]))
            ${
              unseenOnly
                ? Prisma.sql`AND NOT EXISTS (
                    SELECT 1 FROM "ReelView" v
                    WHERE v."postId" = p.id AND v."userId" = ${viewer}
                      AND v."createdAt" > now() - make_interval(days => ${REEL_SEEN_DAYS})
                  )`
                : Prisma.empty
            }
          ORDER BY p."createdAt" DESC
          LIMIT ${REEL_CANDIDATES}
        )
        SELECT c.id FROM candidates c
        ORDER BY (
          (1 + (SELECT count(*) FROM "Like" l WHERE l."postId" = c.id)
             + 2 * (SELECT count(*) FROM "Comment" x WHERE x."postId" = c.id)
             + 0.1 * (SELECT count(*) FROM "ReelView" v WHERE v."postId" = c.id))
          / power(extract(epoch FROM now() - c."createdAt") / 3600 + 2, 1.5)
          * CASE WHEN EXISTS (
              SELECT 1 FROM "Follow" f
              WHERE f."followerId" = ${viewer} AND f."followingId" = c."authorId"
            ) THEN 1.5 ELSE 1 END
          * (0.85 + random() * 0.3)
        ) DESC
        LIMIT ${take}
      `;

    const ids = (await pick(true, q.limit, q.exclude)).map((r) => r.id);
    if (viewerId && ids.length < q.limit) {
      const more = await pick(false, q.limit - ids.length, [
        ...q.exclude,
        ...ids,
      ]);
      ids.push(...more.map((r) => r.id));
    }
    if (viewerId && ids.length < q.limit) {
      const own = await this.prisma.post.findMany({
        where: {
          authorId: viewerId,
          isReel: true,
          deletedAt: null,
          id: { notIn: [...q.exclude, ...ids] },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit - ids.length,
        select: { id: true },
      });
      ids.push(...own.map((r) => r.id));
    }

    const posts = await this.prisma.post.findMany({
      where: { id: { in: ids } },
      include: postInclude(viewerId),
    });
    const byId = new Map(posts.map((p) => [p.id, p]));
    return {
      data: ids.map((id) => toFeedPost(byId.get(id)!, viewerId)),
      // không có cursor: lần sau gửi `exclude` = các id đang có để lấy lô tiếp theo
      meta: { limit: q.limit, hasMore: ids.length === q.limit },
    };
  }

  // FE gọi khi reel được xem đủ ~3s. Mỗi người tính 1 lượt; chủ reel / khách không tính
  async recordReelView(postId: number, viewerId?: number) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null, isReel: true },
      select: { authorId: true },
    });
    if (!post) throw new NotFoundException('Reel not found');
    if (viewerId && viewerId !== post.authorId) {
      await this.prisma.reelView.createMany({
        data: { userId: viewerId, postId },
        skipDuplicates: true,
      });
    }
    const viewCount = await this.prisma.reelView.count({ where: { postId } });
    return { postId, viewCount };
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
      select: { id: true, authorId: true },
    });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }
}
