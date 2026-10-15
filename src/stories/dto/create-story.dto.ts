import { IsString } from 'class-validator';

export class CreateStoryDto {
  // URL do POST /api/uploads trả về (ảnh hoặc video tối đa 60s)
  @IsString()
  mediaUrl!: string;
}
