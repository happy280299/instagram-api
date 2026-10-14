import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class FeedQueryDto {
  // Lấy nguyên từ meta.nextCursor của trang trước:
  // "f:<postId>" = đang ở phần bài của người mình follow,
  // "s" | "s:<postId>" = đang ở phần bài gợi ý
  @IsOptional()
  @Matches(/^(f:\d+|s(:\d+)?)$/, { message: 'Invalid cursor' })
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}
