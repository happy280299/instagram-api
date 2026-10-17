import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const required = { message: 'refreshToken is required' };

export class RefreshTokenDto {
  // decorator chạy từ dưới lên: lỗi "bắt buộc" đứng đầu danh sách lỗi
  @MaxLength(200, { message: 'Invalid refresh token' })
  @IsString(required)
  @IsNotEmpty(required)
  refreshToken!: string;
}
