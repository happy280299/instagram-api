import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { ReelsController } from './reels.controller';
import { PostsService } from './posts.service';
import { UploadsModule } from '../uploads/uploads.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [UploadsModule, NotificationsModule],
  controllers: [PostsController, ReelsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
