-- CreateEnum
CREATE TYPE "VodStatus" AS ENUM ('PENDING', 'DOWNLOADING', 'DOWNLOADED', 'PROCESSING', 'PROCESSED', 'FAILED', 'COMPLETED');

-- CreateTable
CREATE TABLE "tournaments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "startGGId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT,
    "startGGId" TEXT,
    "country" TEXT,
    "region" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sets" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "roundName" TEXT,
    "bestOf" INTEGER NOT NULL DEFAULT 3,
    "winnerId" TEXT,
    "score" TEXT,
    "startGGId" TEXT,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "player1Id" TEXT,
    "player2Id" TEXT,

    CONSTRAINT "sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vods" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "tournamentId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "processedUrl" TEXT,
    "status" "VodStatus" NOT NULL DEFAULT 'PENDING',
    "duration" INTEGER,
    "fileSize" BIGINT,
    "resolution" TEXT,
    "fps" INTEGER,
    "startTime" INTEGER,
    "endTime" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tournaments_slug_key" ON "tournaments"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tournaments_startGGId_key" ON "tournaments"("startGGId");

-- CreateIndex
CREATE UNIQUE INDEX "players_startGGId_key" ON "players"("startGGId");

-- CreateIndex
CREATE UNIQUE INDEX "sets_startGGId_key" ON "sets"("startGGId");

-- AddForeignKey
ALTER TABLE "sets" ADD CONSTRAINT "sets_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sets" ADD CONSTRAINT "sets_player1Id_fkey" FOREIGN KEY ("player1Id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sets" ADD CONSTRAINT "sets_player2Id_fkey" FOREIGN KEY ("player2Id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vods" ADD CONSTRAINT "vods_setId_fkey" FOREIGN KEY ("setId") REFERENCES "sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
