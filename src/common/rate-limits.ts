import { Throttle } from '@nestjs/throttler';

// Giới hạn riêng cho API dễ bị lạm dụng (mặc định: 120 request / phút, xem AppModule)
const perMinute = (limit: number) =>
  Throttle({ default: { limit, ttl: 60_000 } });

export const RateLimit = {
  Auth: perMinute(10), // đăng nhập / đăng ký: chống dò mật khẩu
  Refresh: perMinute(30),
  Upload: perMinute(30),
  CreatePost: perMinute(10),
  Comment: perMinute(30),
  Message: perMinute(60),
  Follow: perMinute(60),
  Search: perMinute(60),
};
