import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeEvent, userRoom } from './realtime.events';

// Mất kết nối quá chừng này mới coi là offline (F5 / đổi mạng thì không bị nhấp nháy)
const OFFLINE_GRACE_MS = 5000;

export type Presence = {
  isOnline: boolean | null; // null = bị ẩn (1 trong 2 bên tắt trạng thái hoạt động)
  lastActiveAt: Date | null;
};

// Theo dõi ai đang mở app (có ít nhất 1 kết nối socket).
// Lưu trong RAM của process -> chạy nhiều instance thì cần chuyển sang Redis
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private connections = new Map<number, number>(); // userId -> số kết nối đang mở
  private offlineTimers = new Map<number, NodeJS.Timeout>();
  private server?: Server;

  constructor(private prisma: PrismaService) {}

  // RealtimeGateway gắn server vào (tránh vòng phụ thuộc gateway <-> service)
  attach(server: Server) {
    this.server = server;
  }

  isOnline(userId: number) {
    return (this.connections.get(userId) ?? 0) > 0;
  }

  // Trạng thái `userId` mà `viewer` được thấy (2 bên đều phải bật trạng thái hoạt động)
  presenceFor(
    user: {
      id: number;
      lastActiveAt: Date | null;
      showActivityStatus: boolean;
    },
    viewerShows: boolean,
  ): Presence {
    if (!user.showActivityStatus || !viewerShows) {
      return { isOnline: null, lastActiveAt: null };
    }
    return {
      isOnline: this.isOnline(user.id),
      lastActiveAt: user.lastActiveAt,
    };
  }

  async onConnect(userId: number) {
    const timer = this.offlineTimers.get(userId);
    if (timer) {
      // kết nối lại trong thời gian chờ -> coi như chưa từng offline
      clearTimeout(timer);
      this.offlineTimers.delete(userId);
    }
    const count = (this.connections.get(userId) ?? 0) + 1;
    this.connections.set(userId, count);
    if (count === 1 && !timer) {
      await this.touch(userId);
      await this.broadcast(userId);
    }
  }

  onDisconnect(userId: number) {
    const count = (this.connections.get(userId) ?? 1) - 1;
    if (count > 0) {
      this.connections.set(userId, count);
      return;
    }
    this.connections.delete(userId);
    // đóng tab cuối cùng: chờ một chút rồi mới báo offline
    this.offlineTimers.set(
      userId,
      setTimeout(() => {
        this.offlineTimers.delete(userId);
        if (this.isOnline(userId)) return;
        void this.touch(userId).then(() => this.broadcast(userId));
      }, OFFLINE_GRACE_MS),
    );
  }

  // Báo trạng thái hiện tại của `userId` cho những người đang chat với họ.
  // Gọi thêm khi user bật / tắt "Hiển thị trạng thái hoạt động"
  async broadcast(userId: number) {
    if (!this.server) return;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, lastActiveAt: true, showActivityStatus: true },
      });
      if (!user) return;
      const contacts = await this.prisma.conversationMember.findMany({
        where: {
          userId: { not: userId },
          conversation: { members: { some: { userId } } },
        },
        distinct: ['userId'],
        select: {
          userId: true,
          user: { select: { showActivityStatus: true } },
        },
      });
      // người xem tắt trạng thái hoạt động thì cũng không thấy của người khác
      const visible = contacts.filter((c) => c.user.showActivityStatus);
      const hidden = contacts.filter((c) => !c.user.showActivityStatus);
      const emit = (ids: number[], presence: Presence) => {
        if (ids.length) {
          this.server!.to(ids.map(userRoom)).emit(
            RealtimeEvent.PresenceUpdate,
            {
              userId,
              ...presence,
            },
          );
        }
      };
      emit(
        visible.map((c) => c.userId),
        this.presenceFor(user, true),
      );
      emit(
        hidden.map((c) => c.userId),
        { isOnline: null, lastActiveAt: null },
      );
    } catch (err) {
      this.logger.warn(`presence broadcast failed: ${(err as Error).message}`);
    }
  }

  // Gửi cho chính `userId` trạng thái của mọi người đang chat cùng (vd. vừa bật / tắt
  // trạng thái hoạt động của mình -> giờ thấy / không thấy người khác)
  async refreshFor(userId: number) {
    if (!this.server) return;
    try {
      const me = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { showActivityStatus: true },
      });
      if (!me) return;
      const contacts = await this.prisma.conversationMember.findMany({
        where: {
          userId: { not: userId },
          conversation: { members: { some: { userId } } },
        },
        distinct: ['userId'],
        select: {
          user: {
            select: { id: true, lastActiveAt: true, showActivityStatus: true },
          },
        },
      });
      const socket = this.server.to(userRoom(userId));
      for (const { user } of contacts) {
        socket.emit(RealtimeEvent.PresenceUpdate, {
          userId: user.id,
          ...this.presenceFor(user, me.showActivityStatus),
        });
      }
    } catch (err) {
      this.logger.warn(`presence refresh failed: ${(err as Error).message}`);
    }
  }

  private async touch(userId: number) {
    await this.prisma.user
      .update({ where: { id: userId }, data: { lastActiveAt: new Date() } })
      .catch((err: Error) =>
        this.logger.warn(`update lastActiveAt failed: ${err.message}`),
      );
  }
}
