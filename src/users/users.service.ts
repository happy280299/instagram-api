import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { PostsService } from '../posts/posts.service';
import { toAvatarUrl } from '../common/public-url';
import { UserPostsQueryDto } from '../posts/dto/user-posts-query.dto';
import { FollowListQueryDto } from './dto/follow-list-query.dto';

const listUserSelect = {
  id: true,
  username: true,
  name: true,
  avatarUrl: true,
  isVerified: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private posts: PostsService,
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

  async findPosts(username: string, q: UserPostsQueryDto, viewerId?: number) {
    const userId = await this.findId(username);
    return this.posts.findByUser(userId, q, viewerId);
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
    await this.prisma.follow.createMany({
      data: { followerId: viewerId, followingId: userId },
      skipDuplicates: true,
    });
    return this.followState(userId, true);
  }

  async unfollow(username: string, viewerId: number) {
    const userId = await this.findId(username);
    await this.prisma.follow.deleteMany({
      where: { followerId: viewerId, followingId: userId },
    });
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
