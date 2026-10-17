-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'MENTION';

-- CreateTable
CREATE TABLE "Hashtag" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hashtag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostHashtag" (
    "postId" INTEGER NOT NULL,
    "hashtagId" INTEGER NOT NULL,

    CONSTRAINT "PostHashtag_pkey" PRIMARY KEY ("postId","hashtagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Hashtag_name_key" ON "Hashtag"("name");

-- CreateIndex
CREATE INDEX "Hashtag_name_trgm_idx" ON "Hashtag" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "PostHashtag_hashtagId_postId_idx" ON "PostHashtag"("hashtagId", "postId");

-- AddForeignKey
ALTER TABLE "PostHashtag" ADD CONSTRAINT "PostHashtag_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostHashtag" ADD CONSTRAINT "PostHashtag_hashtagId_fkey" FOREIGN KEY ("hashtagId") REFERENCES "Hashtag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tách hashtag từ caption của các bài đã có (cùng quy tắc với extractHashtags() bên app:
-- chữ / số / '_', chữ thường, chuẩn hoá NFC, tối đa 50 ký tự)
INSERT INTO "Hashtag" ("name")
SELECT DISTINCT normalize(lower(m[1]), NFC)
FROM "Post" p, regexp_matches(p.caption, '#([[:alnum:]_]{1,50})', 'g') AS m
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "PostHashtag" ("postId", "hashtagId")
SELECT DISTINCT p.id, h.id
FROM "Post" p, regexp_matches(p.caption, '#([[:alnum:]_]{1,50})', 'g') AS m
JOIN "Hashtag" h ON h."name" = normalize(lower(m[1]), NFC)
ON CONFLICT DO NOTHING;
