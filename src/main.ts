import 'dotenv/config';
// Sentry phải khởi tạo trước khi nạp các module khác
import './instrument';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { TransformResponseInterceptor } from './common/transform-response.interceptor';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { CORS_ORIGINS } from './common/cors-origins';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Chạy sau proxy (Render, Railway, nginx...): lấy IP thật của client từ X-Forwarded-For
  // cho rate limit. Chỉ bật khi có proxy, không thì client tự giả IP được
  if (process.env.TRUST_PROXY) {
    app.set(
      'trust proxy',
      Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY,
    );
  }
  app.setGlobalPrefix('api');
  app.enableCors({ origin: CORS_ORIGINS, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(
    new TransformResponseInterceptor(app.get(Reflector)),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
