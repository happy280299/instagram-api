import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { CategoriesModule } from './categories/categories.module';
import { FeedModule } from './feed/feed.module';
import { CommentsModule } from './comments/comments.module';
import { StoriesModule } from './stories/stories.module';
import { UploadsModule } from './uploads/uploads.module';
import { PostsModule } from './posts/posts.module';
import { UsersModule } from './users/users.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ChatModule } from './chat/chat.module';
import { HashtagsModule } from './hashtags/hashtags.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ScheduleModule } from '@nestjs/schedule';
import { SentryModule } from '@sentry/nestjs/setup';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppThrottlerGuard } from './common/app-throttler.guard';
import { join } from 'path';

@Module({
  imports: [
    // Sentry: gắn thông tin request vào lỗi gửi lên (chỉ hoạt động khi có SENTRY_DSN)
    SentryModule.forRoot(),
    // cron job: dọn story hết hạn (StoriesService.purgeExpired)
    ScheduleModule.forRoot(),
    // rate limit mặc định: 120 request / phút / user (hoặc IP nếu chưa đăng nhập)
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
      errorMessage: 'Too many requests, please try again later',
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      serveRoot: '/static',
    }),
    PrismaModule,
    AuthModule,
    CategoriesModule,
    FeedModule,
    CommentsModule,
    StoriesModule,
    UploadsModule,
    PostsModule,
    UsersModule,
    NotificationsModule,
    RealtimeModule,
    ChatModule,
    HashtagsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}
