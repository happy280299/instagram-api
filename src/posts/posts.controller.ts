import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { ResponseMessage } from '../common/response-message.decorator';

@Controller('posts')
export class PostsController {
  constructor(private posts: PostsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Post created')
  create(@Body() dto: CreatePostDto, @CurrentUser() user: JwtPayload) {
    return this.posts.create(dto, user.sub);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    return this.posts.findOne(id, user?.sub);
  }
}
