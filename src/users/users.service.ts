import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PostsService } from '../posts/posts.service';
import { toPublicUrl } from '../common/public-url';
import { UserPostsQueryDto } from '../posts/dto/user-posts-query.dto';

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
      avatarUrl: toPublicUrl(profile.avatarUrl),
      postCount,
      followerCount,
      followingCount,
      isFollowing: !!followers?.length,
      isMe: user.id === viewerId,
    };
  }

  async findPosts(username: string, q: UserPostsQueryDto, viewerId?: number) {
    const user = await this.prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.posts.findByUser(user.id, q, viewerId);
  }
}
