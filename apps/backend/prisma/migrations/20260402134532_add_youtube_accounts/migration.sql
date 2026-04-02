-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN     "youtubeAccountId" TEXT;

-- CreateTable
CREATE TABLE "youtube_accounts" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "tokens" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youtube_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "youtube_accounts_channelId_key" ON "youtube_accounts"("channelId");

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_youtubeAccountId_fkey" FOREIGN KEY ("youtubeAccountId") REFERENCES "youtube_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
