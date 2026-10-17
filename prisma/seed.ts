import 'dotenv/config';
import { existsSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { slugify } from '../src/common/slugify';
import { toSearchText } from '../src/common/search-text';

// Mật khẩu tài khoản seed. ADMIN không bao giờ dùng mật khẩu cố định trong code:
// không đặt SEED_ADMIN_PASSWORD thì sinh ngẫu nhiên và in ra 1 lần
const ADMIN_PASSWORD =
  process.env.SEED_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url');
// Tài khoản demo (USER) - đổi bằng SEED_USER_PASSWORD nếu cần
const USER_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'user123';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const IMAGE_DIR = join(process.cwd(), 'public', 'products');
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];

/** Tìm file ảnh theo slug. Có thì trả đường dẫn tương đối, không có thì trả '' */
function findImage(slug: string): string {
  for (const ext of IMAGE_EXTS) {
    if (existsSync(join(IMAGE_DIR, `${slug}.${ext}`))) {
      return `/static/products/${slug}.${ext}`;
    }
  }
  return '';
}

const CATEGORIES = [
  'Điện thoại',
  'Laptop',
  'Tai nghe',
  'Đồng hồ',
  'Phụ kiện',
  'Máy ảnh',
];

// [tên, giá, giá gốc, tồn kho, index danh mục]
const PRODUCTS: [string, number, number | null, number, number][] = [
  ['iPhone 16 Pro 256GB', 28990000, 30990000, 15, 0],
  ['Samsung Galaxy S25 Ultra', 27490000, 33990000, 8, 0],
  ['Xiaomi 15', 17990000, null, 20, 0],
  ['MacBook Air M4 13"', 26990000, 28490000, 10, 1],
  ['Dell XPS 14', 42990000, null, 4, 1],
  ['AirPods Pro 2', 5490000, 6190000, 40, 2],
  ['Sony WH-1000XM6', 8990000, 9990000, 12, 2],
  ['Apple Watch Series 10', 10490000, 11990000, 9, 3],
  ['Xiaomi Smart Band 9', 890000, 1090000, 60, 3],
  ['Sạc nhanh Anker 65W', 790000, 990000, 100, 4],
  ['Chuột Logitech MX Master 3S', 2290000, 2590000, 30, 4],
  ['Bàn phím Keychron K8 Pro', 2690000, null, 0, 4],
  ['Sony Alpha A7 IV', 52990000, 57990000, 3, 5],
  ['Fujifilm X-T5', 41990000, null, 4, 5],
];

async function main() {
  // ---- Categories ----
  const categories = [];
  for (const name of CATEGORIES) {
    const slug = slugify(name);
    categories.push(
      await prisma.category.upsert({
        where: { slug },
        update: {},
        create: { name, slug },
      }),
    );
  }

  // ---- Products ----
  let withImage = 0;
  for (const [name, price, originalPrice, stock, catIndex] of PRODUCTS) {
    const slug = slugify(name);
    const imageUrl = findImage(slug);
    if (imageUrl) withImage++;
    else console.warn(`⚠️  Không có ảnh: public/products/${slug}.jpg`);

    await prisma.product.upsert({
      where: { slug },
      update: { imageUrl }, // sản phẩm đã có → chỉ cập nhật ảnh
      create: {
        name,
        slug,
        price,
        originalPrice,
        stock,
        imageUrl,
        sold: Math.floor(Math.random() * 300),
        description: `${name} chính hãng, bảo hành 12 tháng.`,
        categoryId: categories[catIndex].id,
      },
    });
  }

  // ---- Users ----
  const accounts = [
    {
      email: 'admin@shop.dev',
      username: 'admin',
      name: 'Admin',
      password: ADMIN_PASSWORD,
      role: 'ADMIN' as const,
    },
    {
      email: 'user@shop.dev',
      username: 'nguyenvana',
      name: 'Nguyễn Văn A',
      password: USER_PASSWORD,
      role: 'USER' as const,
    },
  ];
  for (const a of accounts) {
    const existed = await prisma.user.findUnique({
      where: { email: a.email },
      select: { id: true },
    });
    // tài khoản đã có thì giữ nguyên mật khẩu (không reset về giá trị seed)
    await prisma.user.upsert({
      where: { email: a.email },
      update: {
        username: a.username,
        nameSearch: toSearchText(a.name),
        avatarUrl: avatar(a.username),
      },
      create: {
        ...a,
        nameSearch: toSearchText(a.name),
        avatarUrl: avatar(a.username),
        password: await bcrypt.hash(a.password, 10),
      },
    });
    if (!existed && a.role === 'ADMIN' && !process.env.SEED_ADMIN_PASSWORD) {
      console.log(
        `Admin ${a.email} - mật khẩu (chỉ hiện 1 lần): ${a.password}`,
      );
    }
  }

  await seedFeed();
  await seedStories();

  console.log(
    `Seed xong ✅  (${withImage}/${PRODUCTS.length} sản phẩm có ảnh)`,
  );
}

// ---- Feed (Instagram) ----
const avatar = (username: string) => `https://i.pravatar.cc/150?u=${username}`;
const photo = (seed: string, w = 1080, h = 1080) =>
  `https://picsum.photos/seed/${seed}/${w}/${h}`;

// [username, tên, bio, tick xanh]
const CREATORS: [string, string, string, boolean][] = [
  ['saigon.foodie', 'Sài Gòn Foodie', 'Ăn khắp Sài Gòn 🍜', true],
  ['hanoi.travel', 'Hà Nội Travel', 'Phố cổ & cà phê ☕', false],
  ['minh.photography', 'Minh Nguyễn', '📷 Sony A7 IV | Đà Lạt', false],
  ['techreview.vn', 'Tech Review VN', 'Review đồ công nghệ', true],
  ['linh.fitness', 'Linh Trần', 'Gym • Yoga • Healthy', false],
];

// [username, caption, location, số ảnh]
const POSTS: [string, string, string | null, number][] = [
  [
    'saigon.foodie',
    'Bún bò chuẩn vị Huế giữa lòng Sài Gòn 🔥 #bunbo #saigon',
    'Quận 3, TP.HCM',
    3,
  ],
  ['hanoi.travel', 'Sáng thứ 7 ở Hồ Gươm 🌿', 'Hồ Hoàn Kiếm', 1],
  ['minh.photography', 'Bình minh trên đồi chè Cầu Đất', 'Đà Lạt', 4],
  [
    'techreview.vn',
    'Unbox iPhone 16 Pro — có đáng nâng cấp? Xem hết carousel 👉',
    null,
    5,
  ],
  ['linh.fitness', 'Leg day không bao giờ skip 💪', 'California Fitness', 1],
  [
    'saigon.foodie',
    'Cơm tấm sườn bì chả 35k, ngon bá cháy',
    'Quận 10, TP.HCM',
    2,
  ],
  ['minh.photography', 'Film vibes 🎞️', 'Hội An', 3],
  ['hanoi.travel', 'Cà phê trứng ở phố cổ, ai đi chưa?', 'Phố Hàng Gai', 2],
  ['techreview.vn', 'Setup góc làm việc 2026 của mình', null, 1],
  ['nguyenvana', 'Cuối tuần chill ✨', 'Vũng Tàu', 1],
  ['linh.fitness', 'Meal prep cho cả tuần 🥗', null, 3],
  ['minh.photography', 'Mùa hoa dã quỳ', 'Đà Lạt', 2],
];

const COMMENTS = [
  'Đẹp quá 😍',
  'Xin địa chỉ với ạ!',
  'Tuyệt vời 🔥',
  'Lưu lại liền',
  'Nhìn thèm ghê',
  'Chụp bằng máy gì vậy bạn?',
  '❤️❤️❤️',
  'Hóng phần 2',
];

async function seedFeed() {
  const password = await bcrypt.hash(USER_PASSWORD, 10);
  for (const [username, name, bio, isVerified] of CREATORS) {
    await prisma.user.upsert({
      where: { email: `${username}@shop.dev` },
      update: {},
      create: {
        email: `${username}@shop.dev`,
        username,
        name,
        nameSearch: toSearchText(name),
        bio,
        isVerified,
        password,
        avatarUrl: avatar(username),
      },
    });
  }

  // Post không có khoá unique -> chỉ seed khi chưa có post nào
  if ((await prisma.post.count()) > 0) return;

  const users = await prisma.user.findMany({
    select: { id: true, username: true },
  });
  const idOf = new Map(users.map((u) => [u.username, u.id]));
  const me = idOf.get('nguyenvana')!;

  // nguyenvana follow mọi creator, creator follow lẫn nhau một phần
  const follows = CREATORS.flatMap(([u], i) => [
    { followerId: me, followingId: idOf.get(u)! },
    {
      followerId: idOf.get(u)!,
      followingId: idOf.get(CREATORS[(i + 1) % CREATORS.length][0])!,
    },
  ]);
  await prisma.follow.createMany({ data: follows, skipDuplicates: true });

  const now = Date.now();
  for (const [
    i,
    [username, caption, location, mediaCount],
  ] of POSTS.entries()) {
    const post = await prisma.post.create({
      data: {
        authorId: idOf.get(username)!,
        caption,
        location,
        // cách nhau vài giờ để feed có thứ tự thời gian
        createdAt: new Date(now - i * 5 * 3600 * 1000),
        media: {
          create: Array.from({ length: mediaCount }, (_, order) => ({
            url: photo(`post${i}-${order}`),
            width: 1080,
            height: 1080,
            order,
          })),
        },
      },
    });

    const likers = users.filter(() => Math.random() < 0.6);
    await prisma.like.createMany({
      data: likers.map((u) => ({ userId: u.id, postId: post.id })),
    });

    const commenters = users.filter(() => Math.random() < 0.4);
    await prisma.comment.createMany({
      data: commenters.map((u, k) => ({
        postId: post.id,
        authorId: u.id,
        content: COMMENTS[(i + k) % COMMENTS.length],
        createdAt: new Date(now - i * 5 * 3600 * 1000 + (k + 1) * 60_000),
      })),
    });
  }
}

// ---- Stories ----
// [username, số story]; story hết hạn sau 24h nên mỗi lần seed lại tạo mới nếu đã hết
const STORIES: [string, number][] = [
  ['saigon.foodie', 3],
  ['hanoi.travel', 1],
  ['minh.photography', 4],
  ['techreview.vn', 2],
  ['linh.fitness', 2],
  ['nguyenvana', 1],
];

async function seedStories() {
  const now = Date.now();
  await prisma.story.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  if ((await prisma.story.count()) > 0) return;

  const users = await prisma.user.findMany({
    select: { id: true, username: true },
  });
  const idOf = new Map(users.map((u) => [u.username, u.id]));
  const me = idOf.get('nguyenvana')!;

  for (const [i, [username, count]] of STORIES.entries()) {
    for (let k = 0; k < count; k++) {
      // đăng rải rác trong vài giờ gần đây
      const createdAt = new Date(now - (i * 3 + (count - k)) * 30 * 60_000);
      const story = await prisma.story.create({
        data: {
          authorId: idOf.get(username)!,
          mediaUrl: photo(`story-${username}-${k}`, 1080, 1920),
          createdAt,
          expiresAt: new Date(createdAt.getTime() + 24 * 3600 * 1000),
        },
      });
      // nguyenvana đã xem hết story của hanoi.travel và story đầu của saigon.foodie
      const seen =
        username === 'hanoi.travel' ||
        (username === 'saigon.foodie' && k === 0);
      if (seen) {
        await prisma.storyView.create({
          data: { storyId: story.id, viewerId: me },
        });
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
