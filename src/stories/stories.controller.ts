import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { StoriesService } from './stories.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { ResponseMessage } from '../common/response-message.decorator';

@Controller('stories')
export class StoriesController {
  constructor(private stories: StoriesService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  tray(@CurrentUser() user: JwtPayload | undefined) {
    return this.stories.tray(user?.sub);
  }

  @Get('users/:userId')
  @UseGuards(OptionalJwtAuthGuard)
  findByUser(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    return this.stories.findByUser(userId, user?.sub);
  }

  @Post(':id/view')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Story seen')
  markSeen(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.stories.markSeen(id, user.sub);
  }
}
