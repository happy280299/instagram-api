import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { CORS_ORIGINS } from '../common/cors-origins';
import { AuthedSocket } from '../realtime/realtime.gateway';
import { RealtimeClientEvent } from '../realtime/realtime.events';
import { ChatService } from './chat.service';

// Sự kiện chat client gửi lên qua socket (dùng chung kết nối + xác thực của RealtimeGateway)
@WebSocketGateway({ cors: { origin: CORS_ORIGINS, credentials: true } })
export class ChatGateway {
  constructor(private chat: ChatService) {}

  // FE: socket.emit('conversation:typing', { conversationId, isTyping: true })
  // khi bắt đầu gõ, và isTyping: false khi ngừng gõ ~3s / gửi tin / rời màn hình
  @SubscribeMessage(RealtimeClientEvent.ConversationTyping)
  async typing(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: unknown,
  ) {
    const { conversationId, isTyping } = (body ?? {}) as {
      conversationId?: unknown;
      isTyping?: unknown;
    };
    if (!Number.isInteger(conversationId) || typeof isTyping !== 'boolean') {
      return;
    }
    await this.chat.typing(
      conversationId as number,
      socket.data.userId,
      isTyping,
    );
  }
}
