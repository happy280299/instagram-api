import { Injectable, Logger } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeEventName, userRoom } from './realtime.events';

// Các module khác (notifications, chat...) đẩy sự kiện qua đây, không đụng trực tiếp vào socket.
// Gửi lỗi chỉ ghi log: realtime là "best effort", dữ liệu thật vẫn lấy được qua REST
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(private gateway: RealtimeGateway) {}

  emitToUser(userId: number, event: RealtimeEventName, payload: unknown) {
    this.emitToUsers([userId], event, payload);
  }

  emitToUsers(userIds: number[], event: RealtimeEventName, payload: unknown) {
    if (!userIds.length || !this.gateway.server) return;
    try {
      this.gateway.server.to(userIds.map(userRoom)).emit(event, payload);
    } catch (err) {
      this.logger.warn(`emit ${event} failed: ${(err as Error).message}`);
    }
  }
}
