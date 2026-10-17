import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './jwt-payload';

const REFRESH_TTL_DAYS = Number(process.env.JWT_REFRESH_EXPIRES_DAYS ?? 30);
const DAY_MS = 24 * 60 * 60 * 1000;
// 2 tab cùng refresh 1 lúc bằng cùng 1 token: tab chậm hơn gặp token vừa bị thu hồi.
// Trong khoảng này coi là trùng lặp bình thường (chỉ báo 401), không phải bị đánh cắp
const CONCURRENT_REFRESH_GRACE_MS = 10_000;

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  // Đăng nhập / đăng ký: mở 1 phiên mới (family mới)
  async issue(
    user: Pick<JwtPayload, 'role'> & { id: number },
    userAgent?: string,
  ) {
    return this.createPair(user, randomUUID(), userAgent);
  }

  // Đổi refresh token lấy cặp token mới (rotation)
  async refresh(refreshToken: string, userAgent?: string) {
    const current = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash(refreshToken) },
      select: {
        id: true,
        family: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: { id: true, role: true } },
      },
    });
    if (!current) throw new UnauthorizedException('Invalid refresh token');

    if (current.revokedAt) {
      const sinceRevoked = Date.now() - current.revokedAt.getTime();
      if (sinceRevoked > CONCURRENT_REFRESH_GRACE_MS) {
        // token cũ bị dùng lại -> có thể đã bị lộ: khoá luôn phiên đăng nhập này
        await this.revokeFamily(current.family);
        this.logger.warn(
          `Refresh token reuse detected, revoked family of user ${current.user.id}`,
        );
      }
      throw new UnauthorizedException('Refresh token has been revoked');
    }
    if (current.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    // Thu hồi có điều kiện: 2 request cùng lúc thì chỉ 1 request thắng
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: current.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!count)
      throw new UnauthorizedException('Refresh token has been revoked');

    return this.createPair(current.user, current.family, userAgent);
  }

  // Đăng xuất thiết bị hiện tại: thu hồi cả phiên (family) của token này
  async revoke(refreshToken: string) {
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash(refreshToken) },
      select: { family: true },
    });
    if (token) await this.revokeFamily(token.family);
  }

  // Đăng xuất mọi thiết bị
  async revokeAll(userId: number) {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  // Mỗi ngày lúc 5h sáng: xoá token đã hết hạn / đã thu hồi quá 7 ngày
  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async purge() {
    const before = new Date(Date.now() - 7 * DAY_MS);
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: before } }, { revokedAt: { lt: before } }],
      },
    });
    if (count) this.logger.log(`Purged ${count} refresh tokens`);
    return { purged: count };
  }

  private async createPair(
    user: { id: number; role: JwtPayload['role'] },
    family: string,
    userAgent?: string,
  ) {
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hash(refreshToken),
        family,
        userAgent: userAgent?.slice(0, 255),
        expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * DAY_MS),
      },
    });
    const payload: JwtPayload = { sub: user.id, role: user.role };
    return { accessToken: this.jwt.sign(payload), refreshToken };
  }

  private async revokeFamily(family: string) {
    await this.prisma.refreshToken.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
