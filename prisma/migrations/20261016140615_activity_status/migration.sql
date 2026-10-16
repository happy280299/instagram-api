-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastActiveAt" TIMESTAMP(3),
ADD COLUMN     "showActivityStatus" BOOLEAN NOT NULL DEFAULT true;
