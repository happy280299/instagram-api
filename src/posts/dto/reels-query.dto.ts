import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class ReelsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = 10;

  // id các reel FE đang có trong phiên lướt hiện tại (vd. '12,15,18') -> không trả lại.
  // Cần vì reel lướt qua nhanh (< 3s) không được tính là đã xem
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.split(',').filter(Boolean).map(Number)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  exclude: number[] = [];
}
