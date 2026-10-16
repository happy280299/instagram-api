-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "isReel" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shareToFeed" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ReelView" (
    "userId" INTEGER NOT NULL,
    "postId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReelView_pkey" PRIMARY KEY ("userId","postId")
);

-- CreateIndex
CREATE INDEX "ReelView_postId_idx" ON "ReelView"("postId");

-- CreateIndex
CREATE INDEX "Post_isReel_createdAt_idx" ON "Post"("isReel", "createdAt");

-- AddForeignKey
ALTER TABLE "ReelView" ADD CONSTRAINT "ReelView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelView" ADD CONSTRAINT "ReelView_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bài đã đăng có đúng 1 media và là video -> Reel (giống Instagram)
UPDATE "Post" p SET "isReel" = true
WHERE (SELECT count(*) FROM "PostMedia" m WHERE m."postId" = p.id) = 1
  AND EXISTS (SELECT 1 FROM "PostMedia" m WHERE m."postId" = p.id AND m.type = 'VIDEO');
