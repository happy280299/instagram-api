import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { toPublicUrl } from '../common/public-url';
import { FeedQueryDto } from './dto/feed-query.dto';

const authorSelect = {
  id: true,
  username: true,
  name: true,
  avatarUrl: true,
  isVerified: true,
} satisfies Prisma.UserSelect;

// viewerId = undefined (khách) thì không cần lấy isLiked / isSaved / isFollowing
function postInclude(viewerId?: number) {
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
    _count: { select: { likes: true, comments: true } },
  } satisfies Prisma.PostInclude;
}

type FeedPost = Prisma.PostGetPayload<{
  include: ReturnType<typeof postInclude>;
}>;

type LikerPreview = { id: number; username: string; avatarUrl: string };

@Injectable()
export class FeedService {
  constructor(private prisma: PrismaService) {}

  async findAll(q: FeedQueryDto, viewerId?: number) {
    // 1. Đã đăng nhập: post của người mình follow + của chính mình.
    //    Chưa follow ai hoặc là khách: hiện tất cả post (giống trang gợi ý)
    const authorIds = viewerId ? await this.feedAuthorIds(viewerId) : null;
    const where: Prisma.PostWhereInput = {
      deletedAt: null,
      ...(authorIds ? { authorId: { in: authorIds } } : {}),
    };

    // 2. Cursor pagination cho infinite scroll: lấy dư 1 bản ghi để biết còn trang sau không
    const rows = await this.prisma.post.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: postInclude(viewerId),
    });
    const hasMore = rows.length > q.limit;
    const posts = hasMore ? rows.slice(0, q.limit) : rows;

    // 3. "Liked by <username> and others": người like gần nhất của mỗi post
    const likers = await this.latestLikers(
      posts.map((p) => p.id),
      viewerId,
    );

    return {
      data: posts.map((p) => toFeedPost(p, viewerId, likers.get(p.id))),
      meta: {
        limit: q.limit,
        nextCursor: hasMore ? posts[posts.length - 1].id : null,
        hasMore,
      },
    };
  }

  private async feedAuthorIds(viewerId: number): Promise<number[] | null> {
    const follows = await this.prisma.follow.findMany({
      where: { followerId: viewerId },
      select: { followingId: true },
    });
    if (follows.length === 0) return null;
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
        { ...l.user, avatarUrl: toPublicUrl(l.user.avatarUrl) },
      ]),
    );
  }
}

function toFeedPost(p: FeedPost, viewerId?: number, likedBy?: LikerPreview) {
  const { followers, ...author } = p.author;
  return {
    id: p.id,
    caption: p.caption,
    location: p.location,
    createdAt: p.createdAt,
    author: {
      ...author,
      avatarUrl: toPublicUrl(author.avatarUrl),
      isFollowing: !!followers?.length,
      isMe: author.id === viewerId,
    },
    media: p.media.map((m) => ({ ...m, url: toPublicUrl(m.url) })),
    likeCount: p._count.likes,
    commentCount: p._count.comments,
    isLiked: !!p.likes?.length,
    isSaved: !!p.savedBy?.length,
    likedBy: likedBy ?? null,
    // API lấy mới nhất trước, đảo lại để hiển thị theo thứ tự thời gian
    previewComments: [...p.comments].reverse(),
  };
}
