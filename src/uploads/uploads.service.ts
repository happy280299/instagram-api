import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { imageSize } from 'image-size';
import {
  v2 as cloudinary,
  UploadApiOptions,
  UploadApiResponse,
} from 'cloudinary';
import { toPublicUrl, toVideoThumbnailUrl } from '../common/public-url';

// Multer chặn ở mức lớn nhất (video), ảnh bị kiểm tra lại riêng bên dưới
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Post tối đa 90s; story còn bị giới hạn chặt hơn ở StoriesService
export const MAX_VIDEO_SECONDS = 90;

// public/uploads được ServeStatic phục vụ ở /static/uploads
const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads');
const UPLOAD_PREFIX = '/static/uploads/';
// đường dẫn do chính server sinh ra: /static/uploads/YYYY/MM/<uuid>.<ext>
const UPLOAD_PATH_RE =
  /^\/static\/uploads\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

// Có đủ 3 biến CLOUDINARY_* thì lưu lên Cloudinary, không thì lưu ảnh vào public/uploads
const useCloudinary = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);
if (useCloudinary) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}
const CLOUDINARY_FOLDER = 'instaclone/uploads';
// URL do chính server upload lên:
//   https://res.cloudinary.com/<cloud>/image/upload/v<version>/instaclone/uploads/<uuid>.(jpg|png|webp)
//   https://res.cloudinary.com/<cloud>/video/upload/v<version>/instaclone/uploads/<uuid>.mp4
const CLOUDINARY_URL_RE = new RegExp(
  `^https://res\\.cloudinary\\.com/${process.env.CLOUDINARY_CLOUD_NAME}/(?:image/upload/v\\d+/(${CLOUDINARY_FOLDER}/[0-9a-f-]{36})\\.(?:jpg|png|webp)|video/upload/v\\d+/(${CLOUDINARY_FOLDER}/[0-9a-f-]{36})\\.mp4)$`,
);

// Video luôn lưu thành mp4 (phát được trên mọi trình duyệt), thu về tối đa 720p để
// tiết kiệm băng thông - phần tốn credit nhất của video trên gói free
const VIDEO_UPLOAD_OPTIONS: UploadApiOptions = {
  resource_type: 'video',
  format: 'mp4',
  transformation: [
    { width: 1280, height: 1280, crop: 'limit', quality: 'auto' },
  ],
};

// type do image-size đọc từ nội dung file -> đuôi file lưu xuống
const ALLOWED_TYPES: Record<string, string> = {
  jpg: 'jpg',
  png: 'png',
  webp: 'webp',
};

// Brand trong hộp 'ftyp' của HEIC / AVIF (là ảnh, không phải video)
const IMAGE_FTYP_BRANDS = ['heic', 'heix', 'mif1', 'msf1', 'avif', 'avis'];

export type UploadedMedia = {
  path: string; // lưu vào DB: đường dẫn tương đối (local) hoặc URL đầy đủ (Cloudinary)
  type: 'IMAGE' | 'VIDEO';
  width: number;
  height: number;
  duration?: number; // giây, chỉ có với video
};

@Injectable()
export class UploadsService {
  async save(file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Please choose a photo or video to upload');
    }

    // Kiểm tra bằng nội dung file, không tin đuôi file / mimetype client gửi
    if (isVideo(file.buffer)) return this.saveVideo(file.buffer);

    const { ext, width, height } = readImage(file.buffer);
    if (file.buffer.length > MAX_IMAGE_BYTES) {
      throw new PayloadTooLargeException('Photos can be up to 10 MB');
    }

    if (useCloudinary) {
      const res = await uploadToCloudinary(file.buffer, {
        resource_type: 'image',
      });
      return { url: res.secure_url, width, height, type: 'IMAGE' as const };
    }

    const now = new Date();
    const dir = join(
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
    );
    const name = `${randomUUID()}.${ext}`;
    await mkdir(join(UPLOAD_DIR, dir), { recursive: true });
    await writeFile(join(UPLOAD_DIR, dir, name), file.buffer);

    return {
      url: toPublicUrl(`${UPLOAD_PREFIX}${dir}/${name}`),
      width,
      height,
      type: 'IMAGE' as const,
    };
  }

  // URL FE gửi lên khi tạo post / story / đổi avatar -> phải là file do /uploads tạo và còn tồn tại
  async resolve(url: string): Promise<UploadedMedia> {
    const cloud = useCloudinary && CLOUDINARY_URL_RE.exec(url);
    if (cloud) {
      return cloud[1]
        ? resolveCloudinary(url, cloud[1], 'image')
        : resolveCloudinary(url, cloud[2], 'video');
    }

    const path = url.startsWith(`${process.env.APP_URL}/`)
      ? url.slice(process.env.APP_URL!.length)
      : url;
    if (!UPLOAD_PATH_RE.test(path)) {
      throw new BadRequestException('Photos must be uploaded first');
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(
        join(UPLOAD_DIR, path.slice(UPLOAD_PREFIX.length)),
      );
    } catch {
      throw new BadRequestException('Photo not found, please upload it again');
    }
    // Lấy kích thước thật của file thay vì tin width/height FE gửi
    const { width, height } = readImage(buffer);
    return { path, type: 'IMAGE', width, height };
  }

  // Video chỉ hỗ trợ khi có Cloudinary: cần chuyển định dạng + đọc độ dài (local không có ffmpeg)
  private async saveVideo(buffer: Buffer) {
    if (!useCloudinary) {
      throw new BadRequestException('Video uploads are not available yet');
    }

    let res: UploadApiResponse;
    try {
      res = await uploadToCloudinary(buffer, VIDEO_UPLOAD_OPTIONS);
    } catch {
      throw new BadRequestException('Could not process this video');
    }

    // Chỉ biết độ dài sau khi Cloudinary đọc xong file -> quá dài thì xoá luôn
    if (res.duration > MAX_VIDEO_SECONDS) {
      await cloudinary.uploader
        .destroy(res.public_id, { resource_type: 'video', invalidate: true })
        .catch(() => undefined);
      throw new BadRequestException(
        `Videos can be up to ${MAX_VIDEO_SECONDS} seconds`,
      );
    }

    return {
      url: res.secure_url,
      width: res.width,
      height: res.height,
      type: 'VIDEO' as const,
      duration: res.duration as number,
      thumbnailUrl: toVideoThumbnailUrl(res.secure_url),
    };
  }
}

function uploadToCloudinary(buffer: Buffer, options: UploadApiOptions) {
  return new Promise<UploadApiResponse>((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        { ...options, folder: CLOUDINARY_FOLDER, public_id: randomUUID() },
        (err, res) => (err || !res ? reject(err) : resolve(res)),
      )
      .end(buffer);
  });
}

// Hỏi lại Cloudinary: file còn tồn tại không + kích thước / độ dài thật (không tin số FE gửi)
async function resolveCloudinary(
  url: string,
  publicId: string,
  resourceType: 'image' | 'video',
): Promise<UploadedMedia> {
  try {
    const res = await cloudinary.api.resource(publicId, {
      resource_type: resourceType,
      media_metadata: resourceType === 'video',
    });
    return resourceType === 'video'
      ? {
          path: url,
          type: 'VIDEO',
          width: res.width,
          height: res.height,
          duration: res.duration,
        }
      : { path: url, type: 'IMAGE', width: res.width, height: res.height };
  } catch {
    throw new BadRequestException('File not found, please upload it again');
  }
}

// MP4 / MOV: hộp 'ftyp' ở byte 4-8 (trừ HEIC/AVIF). WebM / MKV: mã EBML 1A 45 DF A3
function isVideo(buffer: Buffer) {
  if (buffer.length < 12) return false;
  if (buffer.toString('latin1', 4, 8) === 'ftyp') {
    return !IMAGE_FTYP_BRANDS.includes(buffer.toString('latin1', 8, 12));
  }
  return buffer.readUInt32BE(0) === 0x1a45dfa3;
}

function readImage(buffer: Buffer) {
  try {
    const { type, width, height } = imageSize(buffer);
    const ext = type && ALLOWED_TYPES[type];
    if (ext && width && height) return { ext, width, height };
  } catch {
    // không đọc được -> không phải ảnh
  }
  throw new BadRequestException(
    'Only JPEG, PNG, WebP photos or MP4, MOV, WebM videos are allowed',
  );
}
