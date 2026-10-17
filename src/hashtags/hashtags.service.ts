import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { postInclude, toFeedPost } from '../feed/feed.service';
import { normalizeHashtag } from '../common/text-entities';
import { UserPostsQueryDto } from '../posts/dto/user-posts-query.dto';
import { SearchHashtagsQueryDto } from './dto/search-hashtags-query.dto';

// Bài còn hiển thị (chưa xoá) của 1 hashtag
const livePosts = { post: { deletedAt: null } };

@Injectable()
export class HashtagsService {
  constructor(private prisma: PrismaService) {}

  // Gợi ý khi gõ '#...': trùng khớp > bắt đầu bằng > chứa từ khoá, rồi nhiều bài hơn.
  // Hashtag không còn bài nào (bài đã xoá hết) thì không gợi ý
  async search(q: SearchHashtagsQueryDto) {
    // escape ký tự đặc biệt của LIKE ('_' có trong hashtag)
    const like = q.q.replace(/[\\%_]/g, '\\$&');
    return this.prisma.$queryRaw<{ name: string; postCount: number }[]>`
      WITH matched AS (
        SELECT h.id, h.name FROM "Hashtag" h
        WHERE h.name LIKE ${`%${like}%`}
        ORDER BY (h.name = ${q.q}) DESC, (h.name LIKE ${`${like}%`}) DESC
        LIMIT 200
      )
      SELECT m.name,
             (SELECT count(*)::int FROM "PostHashtag" ph
              JOIN "Post" p ON p.id = ph."postId" AND p."deletedAt" IS NULL
              WHERE ph."hashtagId" = m.id) AS "postCount"
      FROM matched m
      WHERE EXISTS (
        SELECT 1 FROM "PostHashtag" ph
        JOIN "Post" p ON p.id = ph."postId" AND p."deletedAt" IS NULL
        WHERE ph."hashtagId" = m.id
      )
      ORDER BY (m.name = ${q.q}) DESC, (m.name LIKE ${`${like}%`}) DESC,
               "postCount" DESC, m.name
      LIMIT ${q.limit}
    `;
  }

  // Đầu trang hashtag: tên + số bài
  async findOne(rawName: string) {
    const hashtag = await this.prisma.hashtag.findUnique({
      where: { name: normalizeHashtag(rawName) },
      select: {
        name: true,
        _count: { select: { posts: { where: livePosts } } },
      },
    });
    if (!hashtag) throw new NotFoundException('Hashtag not found');
    return { name: hashtag.name, postCount: hashtag._count.posts };
  }

  // Bài gắn hashtag, mới nhất trước (gồm cả reel); cùng shape với 1 item của feed
  async findPosts(rawName: string, q: UserPostsQueryDto, viewerId?: number) {
    const { name } = await this.findOne(rawName);
    const rows = await this.prisma.post.findMany({
      where: { deletedAt: null, hashtags: { some: { hashtag: { name } } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: postInclude(viewerId),
    });
    const hasMore = rows.length > q.limit;
    const posts = hasMore ? rows.slice(0, q.limit) : rows;
    return {
      data: posts.map((p) => toFeedPost(p, viewerId)),
      meta: {
        limit: q.limit,
        nextCursor: hasMore ? posts[posts.length - 1].id : null,
        hasMore,
      },
    };
  }
}
