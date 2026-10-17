import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Giống Instagram: sửa được chữ, không đổi được ảnh / video. Không gửi field nào = giữ nguyên
export class UpdatePostDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2200, { message: 'Caption can be up to 2,200 characters' })
  caption?: string;

  // '' hoặc null = xoá địa điểm
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100, { message: 'Location can be up to 100 characters' })
  location?: string | null;

  // Chỉ có tác dụng với Reel
  @IsOptional()
  @IsBoolean()
  shareToFeed?: boolean;
}
