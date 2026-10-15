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

export class SearchUsersQueryDto {
  // Gõ '@happy' cũng được, giống ô tìm kiếm của Instagram
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/^@+/, '') : value,
  )
  @IsString()
  @MinLength(1, { message: 'Enter something to search' })
  @MaxLength(30)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}
