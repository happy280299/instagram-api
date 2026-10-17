import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { FEED_VISIBLE, postInclude, toFeedPost } from '../feed/feed.service';
import { CreatePostDto } from './dto/create-post.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { UserPostsQueryDto } from './dto/user-posts-query.dto';
import { ReelsQueryDto } from './dto/reels-query.dto';
import { ExploreQueryDto } from './dto/explore-query.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { JwtPayload } from '../auth/jwt-payload';
import {
  MAX_HASHTAGS,
  extractHashtags,
  extractMentions,
} from '../common/text-entities';
import { Prisma } from '../generated/prisma/client';

// Tab Reels chỉ xếp hạng trong chừng này reel mới nhất (giới hạn chi phí truy vấn)
const REEL_CANDIDATES = 500;
// Bài đã xoá giữ lại chừng này ngày ("Đã xoá gần đây") rồi mới xoá hẳn cả file
const DELETED_POST_RETENTION_DAYS = 30;

// Explore chỉ xếp hạng trong chừng này bài mới nhất
const EXPLORE_CANDIDATES = 1000;

// Reel đã xem trong chừng này ngày thì không gợi ý lại
const REEL_SEEN_DAYS = 7;

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private prisma: PrismaService,
    private uploads: UploadsService,
    private notifications: NotificationsService,
  ) {}

  async create(dto: CreatePostDto, userId: number) {
    const media = await Promise.all(
      dto.media.map((m) => this.uploads.resolve(m.url)),
    );

    const tags = hashtagsOf(dto.caption);

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
        hashtags: { create: tags.map(linkHashtag) },
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

    await this.notifications.notifyMentions({
      usernames: extractMentions(dto.caption),
      actorId: userId,
      postId: post.id,
    });

    // Cùng shape với 1 item của GET /api/feed để FE dùng lại mapper
    return toFeedPost(post, userId);
  }

  // Chỉ tác giả được sửa
  async update(id: number, dto: UpdatePostDto, userId: number) {
    const post = await this.prisma.post.findFirst({
      where: { id, deletedAt: null },
      select: { authorId: true, isReel: true, caption: true },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (post.authorId !== userId) {
      throw new ForbiddenException('You can only edit your own posts');
    }
    const captionChanged = dto.caption !== undefined;
    const tags = captionChanged ? hashtagsOf(dto.caption!) : [];

    const updated = await this.prisma.post.update({
      where: { id },
      data: {
        caption: dto.caption,
        location: dto.location === undefined ? undefined : dto.location || null,
        shareToFeed: post.isReel ? dto.shareToFeed : undefined,
        // sửa caption -> tính lại hashtag
        hashtags: captionChanged
          ? { deleteMany: {}, create: tags.map(linkHashtag) }
          : undefined,
      },
      include: postInclude(userId),
    });

    if (captionChanged) {
      // chỉ báo cho người mới được nhắc; ai bị bỏ khỏi caption thì gỡ thông báo
      const before = extractMentions(post.caption);
      const after = extractMentions(dto.caption!);
      await this.notifications.notifyMentions({
        usernames: after.filter((u) => !before.includes(u)),
        actorId: userId,
        postId: id,
      });
      const removed = before.filter((u) => !after.includes(u));
      if (removed.length) {
        const users = await this.prisma.user.findMany({
          where: { username: { in: removed } },
          select: { id: true },
        });
        for (const u of users) {
          await this.notifications.retract({
            type: 'MENTION',
            actorId: userId,
            postId: id,
            recipientId: u.id,
            commentId: null,
          });
        }
      }
    }
    return toFeedPost(updated, userId);
  }

  // Tác giả hoặc ADMIN. Xoá mềm: bài biến mất ngay (feed, profile, đã lưu, thông báo...),
  // file + dữ liệu được job purgeDeleted xoá hẳn sau 30 ngày
  async remove(id: number, user: JwtPayload) {
    const post = await this.prisma.post.findFirst({
      where: { id, deletedAt: null },
      select: { authorId: true },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (post.authorId !== user.sub && user.role !== 'ADMIN') {
      throw new ForbiddenException('You cannot delete this post');
    }
    await this.prisma.post.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return null;
  }

  // Mỗi ngày lúc 4h sáng: bài đã xoá quá 30 ngày -> xoá dòng (like, comment, media... theo
  // Cascade) rồi xoá file không còn ai dùng. Xoá file lỗi thì rollback, lần sau thử lại
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeDeleted() {
    const before = new Date(
      Date.now() - DELETED_POST_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const posts = await this.prisma.post.findMany({
      where: { deletedAt: { lt: before } },
      orderBy: { deletedAt: 'asc' },
      take: 100,
      select: { id: true, media: { select: { url: true } } },
    });
    let purged = 0;
    for (const post of posts) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            await tx.post.delete({ where: { id: post.id } });
            for (const { url } of post.media) {
              await this.uploads.removeIfUnused(url, tx);
            }
          },
          { timeout: 30_000 },
        );
        purged++;
      } catch (err) {
        this.logger.warn(
          `Post ${post.id}: purge failed, will retry: ${(err as Error).message}`,
        );
      }
    }
    if (posts.length) {
      this.logger.log(`Purged ${purged}/${posts.length} deleted posts`);
    }
    return { found: posts.length, purged };
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
        ORDER BY ${trendingScore(viewer)} DESC
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

    return {
      data: await this.loadInOrder(ids, viewerId),
      // không có cursor: lần sau gửi `exclude` = các id đang có để lấy lô tiếp theo
      meta: { limit: q.limit, hasMore: ids.length === q.limit },
    };
  }

  // Explore: lưới bài (cả reel) của người mình CHƯA follow, xếp theo trendingScore.
  // Hết thì lấp bằng bài của người đã follow để lưới không trống. Khách: mọi bài
  async explore(q: ExploreQueryDto, viewerId?: number) {
    const viewer = viewerId ?? 0;
    const pick = (followed: boolean, take: number, skip: number[]) =>
      this.prisma.$queryRaw<{ id: number }[]>`
        WITH candidates AS (
          SELECT p.id, p."authorId", p."createdAt"
          FROM "Post" p
          WHERE p."deletedAt" IS NULL
            AND p."authorId" <> ${viewer}
            AND NOT (p.id = ANY(${skip}::int[]))
            AND ${followed ? Prisma.empty : Prisma.sql`NOT`} EXISTS (
              SELECT 1 FROM "Follow" f
              WHERE f."followerId" = ${viewer} AND f."followingId" = p."authorId"
            )
          ORDER BY p."createdAt" DESC
          LIMIT ${EXPLORE_CANDIDATES}
        )
        SELECT c.id FROM candidates c
        ORDER BY ${trendingScore(viewer)} DESC
        LIMIT ${take}
      `;

    const ids = (await pick(false, q.limit, q.exclude)).map((r) => r.id);
    if (viewerId && ids.length < q.limit) {
      const more = await pick(true, q.limit - ids.length, [
        ...q.exclude,
        ...ids,
      ]);
      ids.push(...more.map((r) => r.id));
    }
    return {
      data: await this.loadInOrder(ids, viewerId),
      meta: { limit: q.limit, hasMore: ids.length === q.limit },
    };
  }

  // Nạp bài theo đúng thứ tự id đã xếp hạng, cùng shape với 1 item của feed
  private async loadInOrder(ids: number[], viewerId?: number) {
    const posts = await this.prisma.post.findMany({
      where: { id: { in: ids } },
      include: postInclude(viewerId),
    });
    const byId = new Map(posts.map((p) => [p.id, p]));
    return ids.map((id) => toFeedPost(byId.get(id)!, viewerId));
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

function hashtagsOf(caption: string) {
  const tags = extractHashtags(caption);
  if (tags.length > MAX_HASHTAGS) {
    throw new BadRequestException(
      `Captions can have up to ${MAX_HASHTAGS} hashtags`,
    );
  }
  return tags;
}

// Nối bài với hashtag, chưa có thì tạo
function linkHashtag(name: string) {
  return {
    hashtag: { connectOrCreate: { where: { name }, create: { name } } },
  };
}

// Điểm "đang hot" của bài c (cột id, authorId, createdAt) - dùng cho Reels + Explore:
//   (1 + like + 2*comment + 0.1*view) / (số giờ từ lúc đăng + 2)^1.5
//   x1.5 nếu là người mình follow, x ngẫu nhiên 0.85..1.15 để mỗi lần mở không giống hệt nhau
function trendingScore(viewer: number) {
  return Prisma.sql`(
    (1 + (SELECT count(*) FROM "Like" l WHERE l."postId" = c.id)
       + 2 * (SELECT count(*) FROM "Comment" x WHERE x."postId" = c.id)
       + 0.1 * (SELECT count(*) FROM "ReelView" v WHERE v."postId" = c.id))
    / power(extract(epoch FROM now() - c."createdAt") / 3600 + 2, 1.5)
    * CASE WHEN EXISTS (
        SELECT 1 FROM "Follow" f
        WHERE f."followerId" = ${viewer} AND f."followingId" = c."authorId"
      ) THEN 1.5 ELSE 1 END
    * (0.85 + random() * 0.3)
  )`;
}
