import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { normalizeHashtag } from '../../common/text-entities';

export class SearchHashtagsQueryDto {
  // gõ '#đà' hay 'Đà' đều được
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeHashtag(value) : value,
  )
  @IsString()
  @MinLength(1, { message: 'Enter a hashtag to search' })
  @MaxLength(50)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit: number = 10;
}
