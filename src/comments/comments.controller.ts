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
import { CommentsService } from './comments.service';
import { CommentQueryDto } from './dto/comment-query.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { ResponseMessage } from '../common/response-message.decorator';
import { RateLimit } from '../common/rate-limits';

@Controller()
export class CommentsController {
  constructor(private comments: CommentsService) {}

  @Get('posts/:postId/comments')
  @UseGuards(OptionalJwtAuthGuard)
  findAll(
    @Param('postId', ParseIntPipe) postId: number,
    @Query() query: CommentQueryDto,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    return this.comments.findAll(postId, query, user?.sub);
  }

  @RateLimit.Comment
  @Post('posts/:postId/comments')
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Comment success')
  create(
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.comments.create(postId, dto, user.sub);
  }

  @Delete('comments/:id')
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Delete comment success')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.comments.remove(id, user);
  }

  @Get('comments/:id/replies')
  @UseGuards(OptionalJwtAuthGuard)
  findReplies(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: CommentQueryDto,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    return this.comments.findReplies(id, query, user?.sub);
  }

  @Post('comments/:id/like')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Liked')
  like(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.comments.like(id, user.sub);
  }

  @Delete('comments/:id/like')
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Unliked')
  unlike(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.comments.unlike(id, user.sub);
  }
}
