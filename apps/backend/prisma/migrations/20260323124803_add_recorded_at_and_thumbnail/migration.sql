-- AlterTable
ALTER TABLE "clips" ADD COLUMN     "thumbnailPath" TEXT,
ADD COLUMN     "youtubeVideoId" TEXT;

-- AlterTable
ALTER TABLE "vods" ADD COLUMN     "recordedAt" TIMESTAMP(3);
