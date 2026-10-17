import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  toAvatarUrl,
  toPublicUrl,
  toVideoThumbnailUrl,
} from '../common/public-url';
import { FeedQueryDto } from './dto/feed-query.dto';

const authorSelect = {
  id: true,
  username: true,
  name: true,
  avatarUrl: true,
  isVerified: true,
} satisfies Prisma.UserSelect;

// viewerId = undefined (khách) thì không cần lấy isLiked / isSaved / isFollowing
export function postInclude(viewerId?: number) {
  const mine = viewerId ? { where: { userId: viewerId }, take: 1 } : false;
  return {
    author: {
      select: {
        ...authorSelect,
        followers: viewerId
          ? { where: { followerId: viewerId }, select: { followerId: true } }
          : false,
      },
    },
    media: {
      orderBy: { order: 'asc' },
      select: { id: true, url: true, type: true, width: true, height: true },
    },
    // 2 comment mới nhất để hiện dưới post, giống Instagram
    comments: {
      // chỉ comment gốc, không lấy câu trả lời
      where: { parentId: null },
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: {
        id: true,
        content: true,
        createdAt: true,
        author: { select: { id: true, username: true } },
      },
    },
    likes: mine && { ...mine, select: { userId: true } },
    savedBy: mine && { ...mine, select: { userId: true } },
    _count: { select: { likes: true, comments: true, reelViews: true } },
  } satisfies Prisma.PostInclude;
}

// Reel tắt "Cũng chia sẻ lên Feed" thì chỉ nằm ở tab Reels (không hiện ở feed / lưới bài chính)
export const FEED_VISIBLE = {
  NOT: { isReel: true, shareToFeed: false },
} satisfies Prisma.PostWhereInput;

type FeedPost = Prisma.PostGetPayload<{
  include: ReturnType<typeof postInclude>;
}>;

type LikerPreview = { id: number; username: string; avatarUrl: string };

@Injectable()
export class FeedService {
  constructor(private prisma: PrismaService) {}

  async findAll(q: FeedQueryDto, viewerId?: number) {
    // Feed gồm 2 phần nối tiếp nhau, giống Instagram:
    //   "f" (following): post của chính mình + người mình follow, mới nhất trước
    //   "s" (suggested): hết phần "f" thì nối tiếp bằng post của những người còn lại
    // Khách chỉ có phần "s" (= tất cả post). Phần đang xem + post cuối được mã hoá trong cursor
    const { phase, id } = parseCursor(q.cursor, viewerId);
    const authorIds = viewerId ? await this.feedAuthorIds(viewerId) : [];

    const rows: { post: FeedPost; suggested: boolean }[] = [];
    let nextCursor: string | null = null;

    if (phase === 'f') {
      const following = await this.findPage(
        { authorId: { in: authorIds } },
        q.limit + 1,
        id,
        viewerId,
      );
      rows.push(...following.map((post) => ({ post, suggested: false })));
      if (following.length > q.limit) {
        rows.length = q.limit;
        nextCursor = `f:${rows[q.limit - 1].post.id}`;
      }
    }

    if (phase === 's' || (phase === 'f' && !nextCursor)) {
      // Phần "f" vừa hết ở trang này: lấy thêm post gợi ý để lấp đầy trang
      // (vẫn lấy dư 1 bản ghi để biết còn trang sau không, kể cả khi trang đã đủ)
      const remaining = q.limit - rows.length;
      const suggested = await this.findPage(
        authorIds.length ? { authorId: { notIn: authorIds } } : {},
        remaining + 1,
        phase === 's' ? id : undefined,
        viewerId,
      );
      const page = suggested.slice(0, remaining);
      rows.push(...page.map((post) => ({ post, suggested: !!viewerId })));
      if (suggested.length > remaining) {
        nextCursor = page.length ? `s:${page[page.length - 1].id}` : 's';
      }
    }

    // "Liked by <username> and others": người like gần nhất của mỗi post
    const likers = await this.latestLikers(
      rows.map((r) => r.post.id),
      viewerId,
    );

    return {
      data: rows.map((r) => ({
        ...toFeedPost(r.post, viewerId, likers.get(r.post.id)),
        isSuggested: r.suggested,
      })),
      meta: {
        limit: q.limit,
        nextCursor,
        hasMore: nextCursor !== null,
      },
    };
  }

  // Cursor pagination cho infinite scroll, afterId = post cuối của trang trước
  private findPage(
    where: Prisma.PostWhereInput,
    take: number,
    afterId: number | undefined,
    viewerId?: number,
  ) {
    return this.prisma.post.findMany({
      where: { deletedAt: null, ...where, ...FEED_VISIBLE },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
      include: postInclude(viewerId),
    });
  }

  private async feedAuthorIds(viewerId: number) {
    const follows = await this.prisma.follow.findMany({
      where: { followerId: viewerId },
      select: { followingId: true },
    });
    return [viewerId, ...follows.map((f) => f.followingId)];
  }

  private async latestLikers(postIds: number[], viewerId?: number) {
    if (postIds.length === 0) return new Map<number, LikerPreview>();
    const likes = await this.prisma.like.findMany({
      where: {
        postId: { in: postIds },
        ...(viewerId ? { userId: { not: viewerId } } : {}),
      },
      distinct: ['postId'],
      orderBy: [{ postId: 'asc' }, { createdAt: 'desc' }],
      select: {
        postId: true,
        user: { select: { id: true, username: true, avatarUrl: true } },
      },
    });
    return new Map(
      likes.map((l) => [
        l.postId,
        { ...l.user, avatarUrl: toAvatarUrl(l.user.avatarUrl) },
      ]),
    );
  }
}

function parseCursor(cursor: string | undefined, viewerId?: number) {
  if (!cursor) return { phase: viewerId ? 'f' : 's', id: undefined };
  const [phase, id] = cursor.split(':');
  // Khách không có phần "f"
  return { phase: viewerId ? phase : 's', id: id ? Number(id) : undefined };
}

export function toFeedPost(
  p: FeedPost,
  viewerId?: number,
  likedBy?: LikerPreview,
) {
  const { followers, ...author } = p.author;
  return {
    id: p.id,
    caption: p.caption,
    location: p.location,
    createdAt: p.createdAt,
    // bài đúng 1 video = Reel; viewCount chỉ có với reel
    isReel: p.isReel,
    shareToFeed: p.shareToFeed,
    viewCount: p.isReel ? p._count.reelViews : null,
    author: {
      ...author,
      avatarUrl: toAvatarUrl(author.avatarUrl),
      isFollowing: !!followers?.length,
      isMe: author.id === viewerId,
    },
    media: p.media.map((m) => ({
      ...m,
      url: toPublicUrl(m.url),
      // video: ảnh bìa để hiện trên grid / trước khi video tải xong
      thumbnailUrl: m.type === 'VIDEO' ? toVideoThumbnailUrl(m.url) : null,
    })),
    likeCount: p._count.likes,
    commentCount: p._count.comments,
    isLiked: !!p.likes?.length,
    isSaved: !!p.savedBy?.length,
    likedBy: likedBy ?? null,
    // API lấy mới nhất trước, đảo lại để hiển thị theo thứ tự thời gian
    previewComments: [...p.comments].reverse(),
  };
}
