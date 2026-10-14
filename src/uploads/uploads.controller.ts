import {
  CallHandler,
  Controller,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { catchError, throwError } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ResponseMessage } from '../common/response-message.decorator';
import { MAX_UPLOAD_BYTES, UploadsService } from './uploads.service';

// Multer báo 'File too large' -> đổi sang message FE hiện được trong toast
@Injectable()
class FileTooLargeMessage implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    return next
      .handle()
      .pipe(
        catchError((err) =>
          throwError(() =>
            err instanceof PayloadTooLargeException
              ? new PayloadTooLargeException(
                  'This file is too large (max 10 MB)',
                )
              : err,
          ),
        ),
      );
  }
}

@Controller('uploads')
export class UploadsController {
  constructor(private uploads: UploadsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileTooLargeMessage,
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  @ResponseMessage('Uploaded')
  upload(@UploadedFile() file?: Express.Multer.File) {
    return this.uploads.saveImage(file);
  }
}
