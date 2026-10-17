import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { HashtagsService } from './hashtags.service';
import { SearchHashtagsQueryDto } from './dto/search-hashtags-query.dto';
import { UserPostsQueryDto } from '../posts/dto/user-posts-query.dto';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { RateLimit } from '../common/rate-limits';

// URL FE: /explore/tags/<name>. Tên có dấu thì encodeURIComponent('đàlạt')
@Controller('hashtags')
export class HashtagsController {
  constructor(private hashtags: HashtagsService) {}

  // Phải khai báo trước ':name'
  @RateLimit.Search
  @Get('search')
  search(@Query() query: SearchHashtagsQueryDto) {
    return this.hashtags.search(query);
  }

  @Get(':name')
  findOne(@Param('name') name: string) {
    return this.hashtags.findOne(name);
  }

  @Get(':name/posts')
  @UseGuards(OptionalJwtAuthGuard)
  findPosts(
    @Param('name') name: string,
    @Query() query: UserPostsQueryDto,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    return this.hashtags.findPosts(name, query, user?.sub);
  }
}
