import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { imageSize } from 'image-size';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { toPublicUrl } from '../common/public-url';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// public/uploads được ServeStatic phục vụ ở /static/uploads
const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads');
const UPLOAD_PREFIX = '/static/uploads/';
// đường dẫn do chính server sinh ra: /static/uploads/YYYY/MM/<uuid>.<ext>
const UPLOAD_PATH_RE =
  /^\/static\/uploads\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

// Có đủ 3 biến CLOUDINARY_* thì lưu ảnh lên Cloudinary, không thì lưu vào public/uploads
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
// URL do chính server upload lên: https://res.cloudinary.com/<cloud>/image/upload/v<version>/instaclone/uploads/<uuid>.<ext>
const CLOUDINARY_URL_RE = new RegExp(
  `^https://res\\.cloudinary\\.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/v\\d+/(${CLOUDINARY_FOLDER}/[0-9a-f-]{36})\\.(jpg|png|webp)$`,
);

// type do image-size đọc từ nội dung file -> đuôi file lưu xuống
const ALLOWED_TYPES: Record<string, string> = {
  jpg: 'jpg',
  png: 'png',
  webp: 'webp',
};

export type UploadedImage = {
  path: string; // lưu vào DB: đường dẫn tương đối (local) hoặc URL đầy đủ (Cloudinary)
  width: number;
  height: number;
};

@Injectable()
export class UploadsService {
  async saveImage(file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Please choose a photo to upload');

    // Kiểm tra bằng nội dung file, không tin đuôi file / mimetype client gửi
    const { ext, width, height } = readImage(file.buffer);

    if (useCloudinary) {
      const res = await uploadToCloudinary(file.buffer, randomUUID());
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

  // URL FE gửi lên khi tạo post -> phải là file do /uploads tạo và còn trên đĩa
  async resolve(url: string): Promise<UploadedImage> {
    const cloud = useCloudinary && CLOUDINARY_URL_RE.exec(url);
    if (cloud) return resolveCloudinary(url, cloud[1]);

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
    return { path, width, height };
  }
}

function uploadToCloudinary(buffer: Buffer, id: string) {
  return new Promise<UploadApiResponse>((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        { folder: CLOUDINARY_FOLDER, public_id: id, resource_type: 'image' },
        (err, res) => (err || !res ? reject(err) : resolve(res)),
      )
      .end(buffer);
  });
}

// Hỏi lại Cloudinary: ảnh còn tồn tại không + kích thước thật (không tin width/height FE gửi)
async function resolveCloudinary(
  url: string,
  publicId: string,
): Promise<UploadedImage> {
  try {
    const { width, height } = await cloudinary.api.resource(publicId);
    return { path: url, width, height };
  } catch {
    throw new BadRequestException('Photo not found, please upload it again');
  }
}

function readImage(buffer: Buffer) {
  try {
    const { type, width, height } = imageSize(buffer);
    const ext = type && ALLOWED_TYPES[type];
    if (ext && width && height) return { ext, width, height };
  } catch {
    // không đọc được -> không phải ảnh
  }
  throw new BadRequestException('Only JPEG, PNG or WebP photos are allowed');
}
