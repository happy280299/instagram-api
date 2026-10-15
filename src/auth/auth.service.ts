import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { User } from '../generated/prisma/client';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { toAvatarUrl, toPublicUrl } from '../common/public-url';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private uploads: UploadsService,
  ) {}

  async register(dto: RegisterDto) {
    // 1. Email đã tồn tại chưa?
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email đã được sử dụng');
    }

    // 2. Username đã tồn tại chưa? (không gửi thì tự sinh)
    const username = dto.username ?? (await this.generateUsername(dto.email));
    if (
      dto.username &&
      (await this.prisma.user.findUnique({ where: { username } }))
    ) {
      throw new ConflictException('Username đã được sử dụng');
    }

    // 3. Hash mật khẩu
    const password = await bcrypt.hash(dto.password, 10);

    // 4. Lưu vào DB
    const user = await this.prisma.user.create({
      data: { name: dto.name, email: dto.email, username, password },
    });

    // 5. Trả về token + user (không kèm password)
    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Sai email hay sai mật khẩu đều trả CÙNG một thông báo,
    // để kẻ xấu không dò được email nào đã đăng ký
    const ok = user && (await bcrypt.compare(dto.password, user.password));
    if (!user || !ok)
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');

    return this.buildAuthResponse(user);
  }

  async me(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // Token vẫn hợp lệ nhưng user đã bị xoá khỏi DB
    if (!user) throw new UnauthorizedException();
    return this.toProfile(user);
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    if (dto.username) {
      const taken = await this.prisma.user.findUnique({
        where: { username: dto.username },
      });
      if (taken && taken.id !== userId) {
        throw new ConflictException('Username đã được sử dụng');
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name,
        username: dto.username,
        bio: dto.bio,
        avatarUrl: await this.resolveAvatar(userId, dto.avatarUrl),
      },
    });
    return this.toProfile(user);
  }

  // User + số liệu cho trang profile: bài viết / người theo dõi / đang theo dõi
  private async toProfile(user: User) {
    const [postCount, followerCount, followingCount] =
      await this.prisma.$transaction([
        this.prisma.post.count({
          where: { authorId: user.id, deletedAt: null },
        }),
        this.prisma.follow.count({ where: { followingId: user.id } }),
        this.prisma.follow.count({ where: { followerId: user.id } }),
      ]);
    return {
      ...this.toSafeUser(user),
      postCount,
      followerCount,
      followingCount,
    };
  }

  // Avatar mới phải là ảnh do POST /uploads tạo (giống ảnh post), không nhận link ngoài.
  // undefined = không đổi, '' = xoá avatar
  private async resolveAvatar(userId: number, avatarUrl?: string) {
    if (!avatarUrl) return avatarUrl;
    const { avatarUrl: current } = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { avatarUrl: true },
    });
    // FE gửi lại avatar đang có (kể cả link ngoài cũ, hoặc URL thumbnail) -> giữ nguyên
    if (
      avatarUrl === toPublicUrl(current) ||
      avatarUrl === toAvatarUrl(current)
    ) {
      return current;
    }
    const { path, type } = await this.uploads.resolve(avatarUrl);
    if (type !== 'IMAGE') {
      throw new BadRequestException('Profile photo must be an image');
    }
    return path;
  }

  // 'nguyen.van-a@gmail.com' -> 'nguyen.vana', trùng thì thêm số: 'nguyen.vana1234'
  private async generateUsername(email: string) {
    const base =
      email
        .split('@')[0]
        .replace(/[^a-z0-9._]/g, '')
        .slice(0, 24) || 'user';
    let username = base;
    while (await this.prisma.user.findUnique({ where: { username } })) {
      username = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    }
    return username;
  }

  private toSafeUser(user: User) {
    const { password: _password, updatedAt: _updatedAt, ...safeUser } = user;
    return { ...safeUser, avatarUrl: toAvatarUrl(safeUser.avatarUrl) };
  }

  private buildAuthResponse(user: User) {
    const accessToken = this.jwt.sign({ sub: user.id, role: user.role });
    return { accessToken, user: this.toSafeUser(user) };
  }
}
