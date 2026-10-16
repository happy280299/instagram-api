import {
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { ResponseMessage } from '../common/response-message.decorator';

// Thông báo chỉ của chính mình -> mọi route đều bắt buộc đăng nhập
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  findAll(
    @Query() query: NotificationQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notifications.findAll(user.sub, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: JwtPayload) {
    return this.notifications.unreadCount(user.sub);
  }

  @Post('read')
  @HttpCode(200)
  @ResponseMessage('Marked as read')
  markAllRead(@CurrentUser() user: JwtPayload) {
    return this.notifications.markAllRead(user.sub);
  }
}
