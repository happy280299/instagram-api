import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Enter your current password' })
  currentPassword!: string;

  // bcrypt chỉ dùng 72 byte đầu -> chặn mật khẩu dài hơn để tránh hiểu nhầm
  @MaxLength(72, { message: 'Password can be up to 72 characters' })
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  @IsString()
  newPassword!: string;
}
