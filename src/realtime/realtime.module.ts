import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { PresenceService } from './presence.service';

// JwtService lấy từ JwtModule global (đăng ký ở AuthModule)
@Module({
  providers: [RealtimeGateway, RealtimeService, PresenceService],
  exports: [RealtimeService, PresenceService],
})
export class RealtimeModule {}
