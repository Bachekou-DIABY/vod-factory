-- AlterTable
ALTER TABLE "vods" ADD COLUMN "alignment" JSONB;
ALTER TABLE "vods" ADD COLUMN "hudSignal" BYTEA;
ALTER TABLE "vods" ADD COLUMN "signalSampleRate" INTEGER;
