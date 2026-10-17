import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { UserPostsQueryDto } from './dto/user-posts-query.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { ResponseMessage } from '../common/response-message.decorator';
import { RateLimit } from '../common/rate-limits';

@Controller('posts')
export class PostsController {
  constructor(private posts: PostsService) {}

  @RateLimit.CreatePost
  @Post()
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Post created')
  create(@Body() dto: CreatePostDto, @CurrentUser() user: JwtPayload) {
    return this.posts.create(dto, user.sub);
  }

  // Phải khai báo trước ':id', không thì 'saved' bị coi là id
  @Get('saved')
  @UseGuards(JwtAuthGuard)
  findSaved(
    @Query() query: UserPostsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.posts.findSaved(user.sub, query);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    return this.posts.findOne(id, user?.sub);
  }

  @Post(':id/like')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Liked')
  like(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.posts.like(id, user.sub);
  }

  @Delete(':id/like')
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Unliked')
  unlike(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.posts.unlike(id, user.sub);
  }

  @Post(':id/save')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Saved')
  save(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.posts.save(id, user.sub);
  }

  @Delete(':id/save')
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Removed from saved')
  unsave(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.posts.unsave(id, user.sub);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Post updated')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePostDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.posts.update(id, dto, user.sub);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Post deleted')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.posts.remove(id, user);
  }
}
