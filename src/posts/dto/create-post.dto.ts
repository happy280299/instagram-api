import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreatePostMediaDto {
  // URL do POST /api/uploads trả về (ảnh hoặc video)
  @IsString()
  url!: string;

  // BE đọc lại kích thước thật từ file, 2 field này chỉ để FE gửi kèm
  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;
}

export class CreatePostDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2200, { message: 'Caption can be up to 2,200 characters' })
  caption: string = '';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100, { message: 'Location can be up to 100 characters' })
  location?: string | null;

  @IsArray({ message: 'Add between 1 and 10 photos or videos' })
  @ArrayMinSize(1, { message: 'Add between 1 and 10 photos or videos' })
  @ArrayMaxSize(10, { message: 'Add between 1 and 10 photos or videos' })
  @ValidateNested({ each: true })
  @Type(() => CreatePostMediaDto)
  media!: CreatePostMediaDto[];
}
