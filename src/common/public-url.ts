// '/static/...' -> '<APP_URL>/static/...'; '' hoặc URL ngoài (https://...) giữ nguyên
export function toPublicUrl(path: string): string {
  if (!path || !path.startsWith('/')) return path;
  return `${process.env.APP_URL}${path}`;
}

// Avatar: ảnh Cloudinary -> cắt vuông 320px theo khuôn mặt, tự chọn webp/avif + chất lượng.
// Chỉ áp dụng cho URL gốc (ngay sau /upload/ là v<version>), link ngoài giữ nguyên
export function toAvatarUrl(path: string): string {
  return toPublicUrl(path).replace(
    /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(v\d+\/)/,
    '$1c_fill,g_face,w_320,h_320,f_auto,q_auto/$2',
  );
}

// Ảnh bìa của video Cloudinary: cùng đường dẫn, đổi đuôi .mp4 -> .jpg (Cloudinary tự lấy frame đầu)
export function toVideoThumbnailUrl(url: string): string {
  return url.replace(/\.mp4$/, '.jpg');
}
