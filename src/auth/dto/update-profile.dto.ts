import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Chỉ gửi field nào muốn đổi
export class UpdateProfileDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsOptional()
  @Matches(/^[a-z0-9._]+$/, {
    message: 'username chỉ gồm chữ thường, số, dấu chấm và gạch dưới',
  })
  @MaxLength(30)
  username?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(150) // giới hạn bio của Instagram
  bio?: string;

  // '' = xoá avatar
  @Transform(trim)
  @IsOptional()
  @ValidateIf((_, v) => v !== '')
  @IsUrl({ require_protocol: true, require_tld: false })
  avatarUrl?: string;

  // Cài đặt "Hiển thị trạng thái hoạt động" (tắt thì 2 bên không thấy của nhau)
  @IsOptional()
  @IsBoolean()
  showActivityStatus?: boolean;
}
