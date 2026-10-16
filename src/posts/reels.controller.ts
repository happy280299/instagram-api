import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PostsService } from './posts.service';
import { ReelsQueryDto } from './dto/reels-query.dto';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';

// Reel là bài post có đúng 1 video: like / comment / lưu / xoá dùng chung API của /posts
@Controller('reels')
@UseGuards(OptionalJwtAuthGuard)
export class ReelsController {
  constructor(private posts: PostsService) {}

  @Get()
  findAll(
    @Query() query: ReelsQueryDto,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    return this.posts.findReels(query, user?.sub);
  }

  @Post(':id/view')
  @HttpCode(200)
  view(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    return this.posts.recordReelView(id, user?.sub);
  }
}
