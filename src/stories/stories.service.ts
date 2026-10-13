import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { toPublicUrl } from '../common/public-url';

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

// Khách xem tray thì chỉ lấy tối đa chừng này user
const GUEST_TRAY_LIMIT = 30;

@Injectable()
export class StoriesService {
  constructor(private prisma: PrismaService) {}

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
        avatarUrl: toPublicUrl(user.avatarUrl),
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
      isSeen: !!views?.length,
      // chỉ chủ story mới thấy số lượt xem
      viewCount: isMe ? _count.views : undefined,
    }));
    // Mở lại thì nhảy tới story đầu tiên chưa xem, xem hết rồi thì từ đầu
    const firstUnseen = items.findIndex((s) => !s.isSeen);

    return {
      user: { ...author, avatarUrl: toPublicUrl(author.avatarUrl), isMe },
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

  private async trayAuthorIds(viewerId: number) {
    const follows = await this.prisma.follow.findMany({
      where: { followerId: viewerId },
      select: { followingId: true },
    });
    return [viewerId, ...follows.map((f) => f.followingId)];
  }
}
