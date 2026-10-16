import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { ResponseMessage } from '../common/response-message.decorator';
import { UserPostsQueryDto } from '../posts/dto/user-posts-query.dto';
import { FollowListQueryDto } from './dto/follow-list-query.dto';
import { SearchUsersQueryDto } from './dto/search-users-query.dto';

// Profile công khai theo username (URL FE: /<username>), id số chỉ dùng nội bộ
@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  // Phải khai báo trước ':username', không thì 'search' bị hiểu là username
  @Get('search')
  @UseGuards(OptionalJwtAuthGuard)
  search(
    @Query() query: SearchUsersQueryDto,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    return this.users.search(query, user?.sub);
  }

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

  @Get(':username/reels')
  @UseGuards(OptionalJwtAuthGuard)
  findReels(
    @Param('username') username: string,
    @Query() query: UserPostsQueryDto,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    return this.users.findReels(username, query, user?.sub);
  }

  @Get(':username/followers')
  @UseGuards(OptionalJwtAuthGuard)
  findFollowers(
    @Param('username') username: string,
    @Query() query: FollowListQueryDto,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    return this.users.findFollowers(username, query, user?.sub);
  }

  @Get(':username/following')
  @UseGuards(OptionalJwtAuthGuard)
  findFollowing(
    @Param('username') username: string,
    @Query() query: FollowListQueryDto,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    return this.users.findFollowing(username, query, user?.sub);
  }

  @Post(':username/follow')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Followed')
  follow(@Param('username') username: string, @CurrentUser() user: JwtPayload) {
    return this.users.follow(username, user.sub);
  }

  @Delete(':username/follow')
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Unfollowed')
  unfollow(
    @Param('username') username: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.users.unfollow(username, user.sub);
  }
}
