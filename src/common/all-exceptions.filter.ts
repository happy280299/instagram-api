import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

// Đưa mọi lỗi về cùng format với response thành công:
// { success: false, statusCode, message, errors? }
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: string[] | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      const raw =
        typeof body === 'string'
          ? body
          : (body as { message?: string | string[] }).message;

      // ValidationPipe trả message là mảng -> message lấy lỗi đầu, errors giữ đủ
      if (Array.isArray(raw)) {
        errors = raw;
        message = raw[0] ?? exception.message;
      } else {
        message = raw ?? exception.message;
      }
    } else {
      // Lỗi không lường trước: log đầy đủ, không lộ chi tiết ra ngoài
      this.logger.error(exception);
    }

    res.status(statusCode).json({
      success: false,
      statusCode,
      message,
      ...(errors && { errors }),
    });
  }
}
