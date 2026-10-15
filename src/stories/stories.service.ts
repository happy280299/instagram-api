import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  toAvatarUrl,
  toPublicUrl,
  toVideoThumbnailUrl,
} from '../common/public-url';
import { UploadsService } from '../uploads/uploads.service';
import { CreateStoryDto } from './dto/create-story.dto';
import { StoryViewersQueryDto } from './dto/story-viewers-query.dto';
import { JwtPayload } from '../auth/jwt-payload';

const authorSelect = {
  id: true,
  username: true,
  name: true,
  avatarUrl: true,
  isVerified: true,
} satisfies Prisma.UserSelect;

// Story còn hạn = chưa quá 24h
const active = (): Prisma.StoryWhereInput => ({
  expiresAt: { gt: new Date() },
});

// Story tự hết hạn sau 24h
const STORY_TTL_MS = 24 * 60 * 60 * 1000;

// Story ảnh hiện 5s, story video chạy hết video (tối đa 60s)
const IMAGE_STORY_MS = 5000;
// Hết hạn + 12h thì xoá hẳn (file trên Cloudinary + dòng trong DB) để tiết kiệm dung lượng gói free.
// 12h này để chủ story vẫn xem được ai đã xem sau khi story biến khỏi tray
const PURGE_AFTER_EXPIRY_MS = 12 * 60 * 60 * 1000;
// Mỗi lần job chạy xoá tối đa chừng này story (Cloudinary Admin API giới hạn ~500 lần/giờ)
const PURGE_BATCH = 100;
const MAX_STORY_VIDEO_SECONDS = 60;

// Khách xem tray thì chỉ lấy tối đa chừng này user
const GUEST_TRAY_LIMIT = 30;

@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);
  private purging = false;

  constructor(
    private prisma: PrismaService,
    private uploads: UploadsService,
  ) {}

  // Đăng story: ảnh phải upload qua POST /uploads trước (giống tạo post)
  async create(dto: CreateStoryDto, userId: number) {
    const media = await this.uploads.resolve(dto.mediaUrl);
    if (media.type === 'VIDEO' && media.duration! > MAX_STORY_VIDEO_SECONDS) {
      throw new BadRequestException(
        `Story videos can be up to ${MAX_STORY_VIDEO_SECONDS} seconds`,
      );
    }
    const story = await this.prisma.story.create({
      data: {
        authorId: userId,
        mediaUrl: media.path,
        type: media.type,
        duration:
          media.type === 'VIDEO'
            ? Math.ceil(media.duration! * 1000)
            : IMAGE_STORY_MS,
        expiresAt: new Date(Date.now() + STORY_TTL_MS),
      },
      select: {
        id: true,
        mediaUrl: true,
        type: true,
        duration: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    // Cùng shape với 1 phần tử stories của GET /stories/users/:userId
    return {
      ...story,
      mediaUrl: toPublicUrl(story.mediaUrl),
      thumbnailUrl: thumbnailOf(story),
      isSeen: false,
      viewCount: 0,
    };
  }

  // Thanh story trên đầu feed: mỗi phần tử là 1 user có story còn hạn
  async tray(viewerId?: number) {
    // Đã đăng nhập: chính mình + người mình follow. Khách: bất kỳ ai có story
    const authorIds = viewerId ? await this.trayAuthorIds(viewerId) : null;

    const users = await this.prisma.user.findMany({
      where: {
        ...(authorIds ? { id: { in: authorIds } } : {}),
        stories: { some: active() },
      },
      ...(viewerId ? {} : { take: GUEST_TRAY_LIMIT }),
      select: {
        ...authorSelect,
        stories: {
          where: active(),
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            createdAt: true,
            views: viewerId
              ? { where: { viewerId }, select: { viewerId: true } }
              : false,
          },
        },
      },
    });

    const items = users.map(({ stories, ...user }) => ({
      user: {
        ...user,
        avatarUrl: toAvatarUrl(user.avatarUrl),
        isMe: user.id === viewerId,
      },
      storyCount: stories.length,
      // vòng gradient: còn story chưa xem; vòng xám: đã xem hết
      hasUnseen: stories.some((s) => !s.views?.length),
      latestAt: stories[stories.length - 1].createdAt,
    }));

    // Giống Instagram: mình đầu tiên -> chưa xem -> đã xem, trong nhóm thì mới nhất trước
    items.sort(
      (a, b) =>
        Number(b.user.isMe) - Number(a.user.isMe) ||
        Number(b.hasUnseen) - Number(a.hasUnseen) ||
        b.latestAt.getTime() - a.latestAt.getTime(),
    );
    return items;
  }

  // Mở story của 1 user (bấm vào avatar trong tray)
  async findByUser(userId: number, viewerId?: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...authorSelect,
        stories: {
          where: active(),
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            mediaUrl: true,
            type: true,
            duration: true,
            createdAt: true,
            expiresAt: true,
            views: viewerId
              ? { where: { viewerId }, select: { viewerId: true } }
              : false,
            _count: { select: { views: true } },
          },
        },
      },
    });
    if (!user || user.stories.length === 0) {
      throw new NotFoundException('User has no active stories');
    }

    const { stories, ...author } = user;
    const isMe = author.id === viewerId;
    const items = stories.map(({ views, _count, ...s }) => ({
      ...s,
      mediaUrl: toPublicUrl(s.mediaUrl),
      thumbnailUrl: thumbnailOf(s),
      isSeen: !!views?.length,
      // chỉ chủ story mới thấy số lượt xem
      viewCount: isMe ? _count.views : undefined,
    }));
    // Mở lại thì nhảy tới story đầu tiên chưa xem, xem hết rồi thì từ đầu
    const firstUnseen = items.findIndex((s) => !s.isSeen);

    return {
      user: { ...author, avatarUrl: toAvatarUrl(author.avatarUrl), isMe },
      stories: items,
      startIndex: firstUnseen === -1 ? 0 : firstUnseen,
    };
  }

  async markSeen(storyId: number, viewerId: number) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, ...active() },
      select: { id: true },
    });
    if (!story) throw new NotFoundException('Story not found');

    // Xem lại nhiều lần vẫn chỉ tính 1 view
    await this.prisma.storyView.createMany({
      data: [{ storyId, viewerId }],
      skipDuplicates: true,
    });
    return null;
  }

  // Chỉ chủ story mới xem được ai đã xem (kể cả story đã hết hạn nhưng còn trong DB)
  async findViewers(
    storyId: number,
    q: StoryViewersQueryDto,
    viewerId: number,
  ) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { authorId: true, _count: { select: { views: true } } },
    });
    if (!story) throw new NotFoundException('Story not found');
    if (story.authorId !== viewerId) {
      throw new ForbiddenException('Only the owner can see story viewers');
    }

    // Xem gần đây nhất trước; lấy dư 1 bản ghi để biết còn trang sau không
    const rows = await this.prisma.storyView.findMany({
      where: { storyId },
      orderBy: [{ createdAt: 'desc' }, { viewerId: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor
        ? {
            cursor: { storyId_viewerId: { storyId, viewerId: q.cursor } },
            skip: 1,
          }
        : {}),
      select: {
        createdAt: true,
        viewer: {
          select: {
            ...authorSelect,
            // để hiện nút Follow / Following cạnh từng người
            followers: {
              where: { followerId: viewerId },
              select: { followerId: true },
            },
          },
        },
      },
    });
    const hasMore = rows.length > q.limit;
    const views = hasMore ? rows.slice(0, q.limit) : rows;

    return {
      data: views.map(({ createdAt, viewer: { followers, ...user } }) => ({
        ...user,
        avatarUrl: toAvatarUrl(user.avatarUrl),
        isFollowing: followers.length > 0,
        viewedAt: createdAt,
      })),
      meta: {
        limit: q.limit,
        total: story._count.views,
        nextCursor: hasMore ? views[views.length - 1].viewer.id : null,
        hasMore,
      },
    };
  }

  // Được xoá: chủ story hoặc ADMIN. Lượt xem bị xoá theo (onDelete: Cascade)
  async remove(storyId: number, user: JwtPayload) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { authorId: true },
    });
    if (!story) throw new NotFoundException('Story not found');
    if (story.authorId !== user.sub && user.role !== 'ADMIN') {
      throw new ForbiddenException('You cannot delete this story');
    }

    const { mediaUrl } = await this.prisma.story.delete({
      where: { id: storyId },
    });
    // Xoá file không được làm hỏng request: lỗi thì ghi log, story vẫn coi như đã xoá
    await this.deleteMediaIfUnused(mediaUrl).catch((err: Error) =>
      this.logger.warn(
        `Story ${storyId}: could not delete media: ${err.message}`,
      ),
    );
    return null;
  }

  // Chạy mỗi giờ: story hết hạn quá 12h -> xoá file rồi xoá dòng trong DB (lượt xem xoá theo).
  // Xoá file lỗi thì giữ lại dòng trong DB để lần chạy sau thử lại
  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired() {
    if (this.purging) return; // lần trước chưa xong thì bỏ qua
    this.purging = true;
    try {
      const stories = await this.prisma.story.findMany({
        where: {
          expiresAt: { lt: new Date(Date.now() - PURGE_AFTER_EXPIRY_MS) },
        },
        orderBy: { expiresAt: 'asc' },
        take: PURGE_BATCH,
        select: { id: true, mediaUrl: true },
      });

      let purged = 0;
      for (const story of stories) {
        try {
          // Xoá dòng trước khi kiểm tra "còn ai dùng file không", để 2 story chung file
          // thì story cuối cùng sẽ xoá được file; lỗi xoá file -> rollback giữ lại dòng
          await this.prisma.$transaction(
            async (tx) => {
              await tx.story.delete({ where: { id: story.id } });
              await this.deleteMediaIfUnused(story.mediaUrl, tx);
              // có gọi Cloudinary bên trong -> nới timeout mặc định 5s của Prisma
            },
            { timeout: 15_000 },
          );
          purged++;
        } catch (err) {
          this.logger.warn(
            `Story ${story.id}: purge failed, will retry: ${(err as Error).message}`,
          );
        }
      }
      if (stories.length) {
        this.logger.log(`Purged ${purged}/${stories.length} expired stories`);
      }
      return { found: stories.length, purged };
    } finally {
      this.purging = false;
    }
  }

  // Cùng 1 URL upload có thể đã được dùng cho post / avatar / story khác -> còn dùng thì giữ file
  private async deleteMediaIfUnused(
    url: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const [posts, avatars, stories] = await Promise.all([
      db.postMedia.count({ where: { url } }),
      db.user.count({ where: { avatarUrl: url } }),
      db.story.count({ where: { mediaUrl: url } }),
    ]);
    if (posts + avatars + stories === 0) await this.uploads.remove(url);
  }

  private async trayAuthorIds(viewerId: number) {
    const follows = await this.prisma.follow.findMany({
      where: { followerId: viewerId },
      select: { followingId: true },
    });
    return [viewerId, ...follows.map((f) => f.followingId)];
  }
}

// Story video: ảnh bìa để hiện lúc đang tải
function thumbnailOf(s: { type: string; mediaUrl: string }) {
  return s.type === 'VIDEO' ? toVideoThumbnailUrl(s.mediaUrl) : null;
}
