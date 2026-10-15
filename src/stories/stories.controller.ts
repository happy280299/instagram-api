import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StoriesService } from './stories.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { ResponseMessage } from '../common/response-message.decorator';
import { CreateStoryDto } from './dto/create-story.dto';
import { StoryViewersQueryDto } from './dto/story-viewers-query.dto';

@Controller('stories')
export class StoriesController {
  constructor(private stories: StoriesService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  tray(@CurrentUser() user: JwtPayload | undefined) {
    return this.stories.tray(user?.sub);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Story posted')
  create(@Body() dto: CreateStoryDto, @CurrentUser() user: JwtPayload) {
    return this.stories.create(dto, user.sub);
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

  @Get(':id/viewers')
  @UseGuards(JwtAuthGuard)
  findViewers(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: StoryViewersQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.stories.findViewers(id, query, user.sub);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Story deleted')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.stories.remove(id, user);
  }
}
