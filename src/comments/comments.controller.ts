import {
  Body,
  Controller,
  Delete,
  Get,
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
}
