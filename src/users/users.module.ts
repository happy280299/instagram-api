import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PostsModule } from '../posts/posts.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PostsModule, NotificationsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
