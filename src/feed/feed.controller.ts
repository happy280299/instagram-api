import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { FeedService } from './feed.service';
import { FeedQueryDto } from './dto/feed-query.dto';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';

@Controller('feed')
export class FeedController {
  constructor(private feed: FeedService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  findAll(
    @Query() query: FeedQueryDto,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    return this.feed.findAll(query, user?.sub);
  }
}
