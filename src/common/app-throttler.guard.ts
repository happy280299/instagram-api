import { ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtPayload } from '../auth/jwt-payload';

// Rate limit cho mọi API HTTP (đăng ký global ở AppModule).
// Đếm theo user nếu có accessToken hợp lệ, không thì theo IP.
// Token phải verify được: token giả không lách được giới hạn bằng cách đổi "user"
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly jwt = new JwtService({ secret: process.env.JWT_SECRET });

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // chỉ HTTP; sự kiện socket (typing...) không đi qua đây
    if (context.getType() !== 'http') return true;
    return super.canActivate(context);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const [type, token] = String(req.headers?.authorization ?? '').split(' ');
    if (type === 'Bearer' && token) {
      try {
        return `user:${this.jwt.verify<JwtPayload>(token).sub}`;
      } catch {
        // token sai / hết hạn -> tính theo IP
      }
    }
    return `ip:${req.ips?.length ? req.ips[0] : req.ip}`;
  }
}
