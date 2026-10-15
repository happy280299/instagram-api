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
import { ServeStaticModule } from '@nestjs/serve-static';
import { ScheduleModule } from '@nestjs/schedule';
import { join } from 'path';

@Module({
  imports: [
    // cron job: dọn story hết hạn (StoriesService.purgeExpired)
    ScheduleModule.forRoot(),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
