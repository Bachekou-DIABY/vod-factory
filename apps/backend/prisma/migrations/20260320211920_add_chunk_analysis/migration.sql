-- AlterTable
ALTER TABLE "vods" ADD COLUMN     "completedChunks" INTEGER DEFAULT 0,
ADD COLUMN     "totalChunks" INTEGER;

-- CreateTable
CREATE TABLE "vod_chunk_events" (
    "id" TEXT NOT NULL,
    "vodId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "events" JSONB NOT NULL,

    CONSTRAINT "vod_chunk_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vod_chunk_events_vodId_chunkIndex_key" ON "vod_chunk_events"("vodId", "chunkIndex");

-- AddForeignKey
ALTER TABLE "vod_chunk_events" ADD CONSTRAINT "vod_chunk_events_vodId_fkey" FOREIGN KEY ("vodId") REFERENCES "vods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
