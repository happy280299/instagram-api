import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';
import { map, Observable } from 'rxjs';
import { RESPONSE_MESSAGE } from './response-message.decorator';

export interface ApiResponse<T> {
  success: true;
  statusCode: number;
  message: string;
  data: T;
  meta?: unknown;
}

// Service phân trang trả { data, meta } -> đưa meta lên cùng cấp với data
// để FE không phải đọc res.data.data
function isPaginated(body: unknown): body is { data: unknown; meta: unknown } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'data' in body &&
    'meta' in body
  );
}

// Bọc mọi response thành công thành { success, statusCode, message, data, meta? }
@Injectable()
export class TransformResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<unknown>
> {
  constructor(private reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<unknown>> {
    const message =
      this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'Success';
    const res = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((body) => {
        // Nest đã set status (200/201/@HttpCode) trước khi chạy interceptor
        const statusCode = res.statusCode;
        if (isPaginated(body)) {
          return {
            success: true,
            statusCode,
            message,
            data: body.data,
            meta: body.meta,
          };
        }
        return { success: true, statusCode, message, data: body ?? null };
      }),
    );
  }
}
