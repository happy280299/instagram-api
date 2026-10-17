import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { PostsService } from '../posts/posts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { toAvatarUrl } from '../common/public-url';
import { UserPostsQueryDto } from '../posts/dto/user-posts-query.dto';
import { FollowListQueryDto } from './dto/follow-list-query.dto';
import { SearchUsersQueryDto } from './dto/search-users-query.dto';
import { SuggestionsQueryDto } from './dto/suggestions-query.dto';
import { toSearchText } from '../common/search-text';

const listUserSelect = {
  id: true,
  username: true,
  name: true,
  avatarUrl: true,
  isVerified: true,
} satisfies Prisma.UserSelect;

// Số ứng viên tối đa lấy ra trước khi xếp hạng (đủ cho typeahead, tránh đếm follower cho cả bảng)
const CANDIDATE_LIMIT = 200;

type SearchRow = {
  id: number;
  username: string;
  name: string;
  avatarUrl: string;
  isVerified: boolean;
  isFollowing: boolean;
  followerCount: number;
};

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private posts: PostsService,
    private notifications: NotificationsService,
  ) {}

  // Trang profile công khai: không trả email / role như /auth/me
  async findByUsername(username: string, viewerId?: number) {
    const user = await this.prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      select: {
        id: true,
        username: true,
        name: true,
        avatarUrl: true,
        bio: true,
        isVerified: true,
        createdAt: true,
        followers: viewerId
          ? { where: { followerId: viewerId }, select: { followerId: true } }
          : false,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const [postCount, followerCount, followingCount] =
      await this.prisma.$transaction([
        this.prisma.post.count({
          where: { authorId: user.id, deletedAt: null },
        }),
        this.prisma.follow.count({ where: { followingId: user.id } }),
        this.prisma.follow.count({ where: { followerId: user.id } }),
      ]);

    const { followers, ...profile } = user;
    return {
      ...profile,
      avatarUrl: toAvatarUrl(profile.avatarUrl),
      postCount,
      followerCount,
      followingCount,
      isFollowing: !!followers?.length,
      isMe: user.id === viewerId,
    };
  }

  // Ô tìm kiếm (typeahead). Lấy ứng viên bằng index trigram, rồi xếp hạng giống Instagram:
  // trùng username > username bắt đầu bằng q > người mình follow > tên có từ bắt đầu bằng q
  // > độ giống (similarity) > nhiều follower hơn
  async search(q: SearchUsersQueryDto, viewerId?: number) {
    const term = toSearchText(q.q);
    if (!term) return [];
    // escape ký tự đặc biệt của LIKE để '%' / '_' trong từ khoá được hiểu là chữ thường
    const like = term.replace(/[\\%_]/g, '\\$&');
    const contains = `%${like}%`;
    const prefix = `${like}%`;
    const wordPrefix = `% ${like}%`;
    const viewer = viewerId ?? 0;

    const rows = await this.prisma.$queryRaw<SearchRow[]>`
      WITH candidates AS (
        -- B1: dùng GIN trigram index, giới hạn số ứng viên trước khi đếm follower
        SELECT u.id,
               u.username = ${term} AS exact,
               u.username LIKE ${prefix} AS "usernamePrefix",
               (u."nameSearch" LIKE ${prefix} OR u."nameSearch" LIKE ${wordPrefix}) AS "namePrefix",
               GREATEST(similarity(u.username, ${term}), similarity(u."nameSearch", ${term})) AS score
        FROM "User" u
        WHERE u.username LIKE ${contains} OR u."nameSearch" LIKE ${contains}
        ORDER BY exact DESC, "usernamePrefix" DESC, "namePrefix" DESC, score DESC
        LIMIT ${CANDIDATE_LIMIT}
      )
      -- B2: chỉ với ~200 ứng viên mới tính quan hệ follow + số follower để xếp hạng
      SELECT u.id, u.username, u.name, u."avatarUrl", u."isVerified",
             EXISTS (SELECT 1 FROM "Follow" f
                     WHERE f."followerId" = ${viewer} AND f."followingId" = u.id) AS "isFollowing",
             (SELECT COUNT(*)::int FROM "Follow" f WHERE f."followingId" = u.id) AS "followerCount"
      FROM candidates c
      JOIN "User" u ON u.id = c.id
      ORDER BY c.exact DESC, c."usernamePrefix" DESC, "isFollowing" DESC,
               c."namePrefix" DESC, c.score DESC, "followerCount" DESC, u.id
      LIMIT ${q.limit}
    `;

    return rows.map((u) => ({
      ...u,
      avatarUrl: toAvatarUrl(u.avatarUrl),
      isMe: u.id === viewerId,
    }));
  }

  // "Gợi ý cho bạn": người mình chưa follow, xếp theo
  //   5 nếu họ đang follow mình (gợi ý follow lại) + 3 x số bạn chung + ln(1 + số follower)
  // (bạn chung = người mình follow cũng đang follow họ). Khách: người nhiều follower nhất
  async suggestions(q: SuggestionsQueryDto, viewerId?: number) {
    const me = viewerId ?? 0;
    const rows = await this.prisma.$queryRaw<
      {
        id: number;
        mutualCount: number;
        followsYou: boolean;
        followerCount: number;
      }[]
    >`
      SELECT * FROM (
        SELECT u.id,
               (SELECT count(*)::int FROM "Follow" f
                JOIN "Follow" mine ON mine."followingId" = f."followerId"
                                  AND mine."followerId" = ${me}
                WHERE f."followingId" = u.id) AS "mutualCount",
               EXISTS (SELECT 1 FROM "Follow" f
                       WHERE f."followerId" = u.id AND f."followingId" = ${me}) AS "followsYou",
               (SELECT count(*)::int FROM "Follow" f WHERE f."followingId" = u.id) AS "followerCount"
        FROM "User" u
        WHERE u.id <> ${me}
          AND NOT EXISTS (SELECT 1 FROM "Follow" f
                          WHERE f."followerId" = ${me} AND f."followingId" = u.id)
      ) s
      ORDER BY (5 * s."followsYou"::int + 3 * s."mutualCount" + ln(1 + s."followerCount")) DESC,
               s.id DESC
      LIMIT ${q.limit}
    `;
    const ids = rows.map((r) => r.id);

    const [users, mutuals] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: listUserSelect,
      }),
      // tối đa 2 tên bạn chung cho mỗi người: "Có A, B + 3 người khác theo dõi"
      viewerId
        ? this.prisma.follow.findMany({
            where: {
              followingId: { in: ids },
              follower: { followers: { some: { followerId: viewerId } } },
            },
            orderBy: { createdAt: 'desc' },
            select: {
              followingId: true,
              follower: { select: { username: true } },
            },
          })
        : [],
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const mutualNames = new Map<number, string[]>();
    for (const m of mutuals) {
      const names = mutualNames.get(m.followingId) ?? [];
      if (names.length < 2) names.push(m.follower.username);
      mutualNames.set(m.followingId, names);
    }

    return rows.map((r) => {
      const u = userById.get(r.id)!;
      return {
        ...u,
        avatarUrl: toAvatarUrl(u.avatarUrl),
        followerCount: r.followerCount,
        // lý do gợi ý để FE hiện: followsYou -> "Đang theo dõi bạn";
        // mutualCount > 0 -> "Có <mutuals[0]> + N người khác theo dõi"; còn lại -> "Gợi ý cho bạn"
        followsYou: r.followsYou,
        mutualCount: r.mutualCount,
        mutuals: mutualNames.get(r.id) ?? [],
      };
    });
  }

  async findPosts(username: string, q: UserPostsQueryDto, viewerId?: number) {
    const userId = await this.findId(username);
    return this.posts.findByUser(userId, q, viewerId);
  }

  // Tab Reels trên profile
  async findReels(username: string, q: UserPostsQueryDto, viewerId?: number) {
    const userId = await this.findId(username);
    return this.posts.findByUser(userId, q, viewerId, true);
  }

  // Người đang follow :username
  async findFollowers(
    username: string,
    q: FollowListQueryDto,
    viewerId?: number,
  ) {
    return this.followList(
      'followers',
      await this.findId(username),
      q,
      viewerId,
    );
  }

  // Người mà :username đang follow
  async findFollowing(
    username: string,
    q: FollowListQueryDto,
    viewerId?: number,
  ) {
    return this.followList(
      'following',
      await this.findId(username),
      q,
      viewerId,
    );
  }

  // Follow / unfollow đều idempotent: bấm nhiều lần không lỗi, không tạo trùng
  async follow(username: string, viewerId: number) {
    const userId = await this.findId(username);
    if (userId === viewerId) {
      throw new BadRequestException('You cannot follow yourself');
    }
    const { count } = await this.prisma.follow.createMany({
      data: { followerId: viewerId, followingId: userId },
      skipDuplicates: true,
    });
    if (count) {
      await this.notifications.notify({
        type: 'FOLLOW',
        recipientId: userId,
        actorId: viewerId,
      });
    }
    return this.followState(userId, true);
  }

  async unfollow(username: string, viewerId: number) {
    const userId = await this.findId(username);
    const { count } = await this.prisma.follow.deleteMany({
      where: { followerId: viewerId, followingId: userId },
    });
    if (count) {
      await this.notifications.retract({
        type: 'FOLLOW',
        actorId: viewerId,
        recipientId: userId,
      });
    }
    return this.followState(userId, false);
  }

  // Trả followerCount mới để FE cập nhật số trên trang profile đang xem
  private async followState(userId: number, isFollowing: boolean) {
    const followerCount = await this.prisma.follow.count({
      where: { followingId: userId },
    });
    return { userId, isFollowing, followerCount };
  }

  // followers: các dòng Follow có followingId = userId, user cần hiện là follower
  // following: các dòng Follow có followerId = userId, user cần hiện là following
  // Cursor = id của user cuối trang, ghép với userId thành khoá chính (followerId, followingId)
  private async followList(
    kind: 'followers' | 'following',
    userId: number,
    q: FollowListQueryDto,
    viewerId?: number,
  ) {
    const [own, other] =
      kind === 'followers'
        ? (['followingId', 'followerId'] as const)
        : (['followerId', 'followingId'] as const);
    const userSelect = {
      ...listUserSelect,
      followers: viewerId
        ? { where: { followerId: viewerId }, select: { followerId: true } }
        : false,
    };

    // Mới follow gần đây nhất trước; lấy dư 1 bản ghi để biết còn trang sau không
    const rows = await this.prisma.follow.findMany({
      where: { [own]: userId },
      orderBy: [{ createdAt: 'desc' }, { [other]: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor
        ? {
            cursor: {
              followerId_followingId: {
                [own]: userId,
                [other]: q.cursor,
              } as { followerId: number; followingId: number },
            },
            skip: 1,
          }
        : {}),
      select: {
        follower: kind === 'followers' && { select: userSelect },
        following: kind === 'following' && { select: userSelect },
      },
    });
    const hasMore = rows.length > q.limit;
    const users = (hasMore ? rows.slice(0, q.limit) : rows).map(
      (r) => (r.follower ?? r.following)!,
    );

    return {
      data: users.map(({ followers, ...u }) => ({
        ...u,
        avatarUrl: toAvatarUrl(u.avatarUrl),
        isFollowing: !!followers?.length,
        isMe: u.id === viewerId,
      })),
      meta: {
        limit: q.limit,
        nextCursor: hasMore ? users[users.length - 1].id : null,
        hasMore,
      },
    };
  }

  private async findId(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user.id;
  }
}
