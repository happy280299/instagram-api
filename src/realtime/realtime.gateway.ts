import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { CORS_ORIGINS } from '../common/cors-origins';
import { JwtPayload } from '../auth/jwt-payload';
import { userRoom } from './realtime.events';
import { PresenceService } from './presence.service';

export type AuthedSocket = Socket & { data: { userId: number } };

// 1 kết nối Socket.IO dùng chung cho cả app (thông báo, chat sau này...).
// FE: io(API_URL, { path: '/socket.io', auth: { token } })
@WebSocketGateway({ cors: { origin: CORS_ORIGINS, credentials: true } })
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private jwt: JwtService,
    private presence: PresenceService,
  ) {}

  // Xác thực ngay lúc bắt tay: token sai -> client nhận connect_error, không vào được
  afterInit(server: Server) {
    this.presence.attach(server);
    server.use((socket, next) => {
      const userId = this.authenticate(socket);
      if (!userId) return next(new Error('Unauthorized'));
      (socket as AuthedSocket).data.userId = userId;
      next();
    });
  }

  async handleConnection(socket: AuthedSocket) {
    await socket.join(userRoom(socket.data.userId));
    await this.presence.onConnect(socket.data.userId);
  }

  handleDisconnect(socket: AuthedSocket) {
    this.presence.onDisconnect(socket.data.userId);
  }

  // Token lấy từ handshake auth.token (khuyên dùng) hoặc header Authorization: Bearer ...
  private authenticate(socket: Socket): number | null {
    const auth = socket.handshake.auth as { token?: unknown };
    const header = socket.handshake.headers.authorization;
    const token =
      (typeof auth?.token === 'string' && auth.token) ||
      (header?.startsWith('Bearer ') && header.slice(7));
    if (!token) return null;
    try {
      return this.jwt.verify<JwtPayload>(token).sub;
    } catch {
      return null;
    }
  }
}
