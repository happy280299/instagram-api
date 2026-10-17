import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';
import { UploadsModule } from '../uploads/uploads.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    UploadsModule,
    RealtimeModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      // access token ngắn hạn, hết hạn thì FE gọi POST /auth/refresh
      signOptions: {
        expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? '15m') as '15m',
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokensService],
})
export class AuthModule {}
