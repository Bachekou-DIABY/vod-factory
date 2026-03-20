-- DropForeignKey
ALTER TABLE "vods" DROP CONSTRAINT "vods_setId_fkey";

-- AlterTable
ALTER TABLE "vods" ADD COLUMN     "eventStartGGId" TEXT,
ADD COLUMN     "events" JSONB,
ADD COLUMN     "streamName" TEXT,
ALTER COLUMN "setId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "clips" (
    "id" TEXT NOT NULL,
    "vodId" TEXT NOT NULL,
    "setOrder" INTEGER NOT NULL,
    "setStartGGId" TEXT,
    "filePath" TEXT NOT NULL,
    "startSeconds" INTEGER NOT NULL,
    "endSeconds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clips_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "vods" ADD CONSTRAINT "vods_setId_fkey" FOREIGN KEY ("setId") REFERENCES "sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clips" ADD CONSTRAINT "clips_vodId_fkey" FOREIGN KEY ("vodId") REFERENCES "vods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
