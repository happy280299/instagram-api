import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { JwtPayload } from './jwt-payload';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ResponseMessage } from '../common/response-message.decorator';
import { RateLimit } from '../common/rate-limits';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { TokensService } from './tokens.service';

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private tokens: TokensService,
  ) {}

  @RateLimit.Auth
  @Post('register')
  @ResponseMessage('Register success')
  register(
    @Body() dto: RegisterDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.register(dto, userAgent);
  }

  @RateLimit.Auth
  @Post('login')
  @HttpCode(200)
  @ResponseMessage('Login success')
  login(@Body() dto: LoginDto, @Headers('user-agent') userAgent?: string) {
    return this.auth.login(dto, userAgent);
  }

  // Trả cặp token mới: các thiết bị khác bị đăng xuất, FE lưu lại token mới cho thiết bị này
  @RateLimit.Auth
  @Patch('password')
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Password changed')
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.changePassword(user.sub, dto, userAgent);
  }

  // accessToken hết hạn (401) -> đổi refreshToken lấy cặp token mới.
  // refreshToken cũ hết hiệu lực ngay, phải lưu lại cái mới
  @RateLimit.Refresh
  @Post('refresh')
  @HttpCode(200)
  refresh(
    @Body() dto: RefreshTokenDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.tokens.refresh(dto.refreshToken, userAgent);
  }

  // Đăng xuất thiết bị này (không cần accessToken còn hạn)
  @Post('logout')
  @HttpCode(200)
  @ResponseMessage('Logged out')
  async logout(@Body() dto: RefreshTokenDto) {
    await this.tokens.revoke(dto.refreshToken);
    return null;
  }

  // Đăng xuất tất cả thiết bị
  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Logged out from all devices')
  async logoutAll(@CurrentUser() user: JwtPayload) {
    return { revoked: await this.tokens.revokeAll(user.sub) };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtPayload) {
    return this.auth.me(user.sub);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Update profile success')
  updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(user.sub, dto);
  }
}
