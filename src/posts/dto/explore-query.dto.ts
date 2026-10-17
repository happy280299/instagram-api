import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class ExploreQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  limit: number = 24; // lưới 3 cột x 8 hàng

  // id các bài FE đang hiện trên lưới (vd. '12,15,18') -> không trả lại khi tải thêm
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
