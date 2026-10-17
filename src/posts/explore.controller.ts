import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PostsService } from './posts.service';
import { ExploreQueryDto } from './dto/explore-query.dto';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';

@Controller('explore')
export class ExploreController {
  constructor(private posts: PostsService) {}

  // Tải thêm: gửi `exclude` = id các bài đang có trên lưới (không có cursor)
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  findAll(
    @Query() query: ExploreQueryDto,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    return this.posts.explore(query, user?.sub);
  }
}
