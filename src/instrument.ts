import * as Sentry from '@sentry/nestjs';

// Theo dõi lỗi production bằng Sentry. Phải được import TRƯỚC mọi module khác (xem main.ts).
// Không có SENTRY_DSN (vd. chạy local) thì không gửi gì
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment:
      process.env.SENTRY_ENVIRONMENT ??
      (process.env.RENDER ? 'production' : 'development'),
    // Render tự đặt biến này = commit đang chạy -> biết lỗi xuất hiện từ bản deploy nào
    release: process.env.RENDER_GIT_COMMIT,
    // Đo hiệu năng tốn quota gói free -> mặc định tắt, bật bằng env khi cần (vd. 0.1)
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
}
