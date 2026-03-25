-- CreateEnum
CREATE TYPE "ClipStatus" AS ENUM ('PENDING', 'APPROVED', 'UPLOADING', 'UPLOADED', 'FAILED');

-- AlterTable
ALTER TABLE "clips" ADD COLUMN     "players" TEXT,
ADD COLUMN     "roundName" TEXT,
ADD COLUMN     "score" TEXT,
ADD COLUMN     "status" "ClipStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "title" TEXT;
