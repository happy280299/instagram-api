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
import { ChatService } from './chat.service';
import { OpenConversationDto } from './dto/open-conversation.dto';
import { ConversationQueryDto } from './dto/conversation-query.dto';
import { MessageQueryDto } from './dto/message-query.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { ResponseMessage } from '../common/response-message.decorator';

// Gửi tin nhắn qua REST (có validate + lưu DB), nhận tin mới qua socket 'message:new'
@Controller()
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private chat: ChatService) {}

  @Post('conversations')
  @HttpCode(200)
  open(@Body() dto: OpenConversationDto, @CurrentUser() user: JwtPayload) {
    return this.chat.openDirect(dto.username, user.sub);
  }

  @Get('conversations')
  findAll(
    @Query() query: ConversationQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.chat.findAll(user.sub, query);
  }

  // Phải khai báo trước ':id'
  @Get('conversations/unread-count')
  unreadCount(@CurrentUser() user: JwtPayload) {
    return this.chat.unreadCount(user.sub);
  }

  @Get('conversations/:id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.chat.findOne(id, user.sub);
  }

  @Get('conversations/:id/messages')
  findMessages(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: MessageQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.chat.findMessages(id, user.sub, query);
  }

  @Post('conversations/:id/messages')
  @ResponseMessage('Message sent')
  send(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.chat.send(id, dto, user.sub);
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  markRead(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.chat.markRead(id, user.sub);
  }

  @Delete('messages/:id')
  @ResponseMessage('Message unsent')
  unsend(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.chat.unsend(id, user.sub);
  }
}
