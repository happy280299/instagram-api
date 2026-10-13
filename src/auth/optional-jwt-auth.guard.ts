import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { JwtPayload } from './jwt-payload';

// Giống JwtAuthGuard nhưng không bắt buộc đăng nhập:
// token hợp lệ thì gắn req.user, không có / sai token thì vẫn cho đi tiếp
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();

    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    if (type === 'Bearer' && token) {
      try {
        req.user = await this.jwt.verifyAsync<JwtPayload>(token);
      } catch {
        // bỏ qua, coi như khách
      }
    }
    return true;
  }
}
