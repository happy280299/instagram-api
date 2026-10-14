import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { UserPostsQueryDto } from '../posts/dto/user-posts-query.dto';

// Profile công khai theo username (URL FE: /<username>), id số chỉ dùng nội bộ
@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get(':username')
  @UseGuards(OptionalJwtAuthGuard)
  findOne(
    @Param('username') username: string,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    return this.users.findByUsername(username, user?.sub);
  }

  @Get(':username/posts')
  @UseGuards(OptionalJwtAuthGuard)
  findPosts(
    @Param('username') username: string,
    @Query() query: UserPostsQueryDto,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    return this.users.findPosts(username, query, user?.sub);
  }
}
