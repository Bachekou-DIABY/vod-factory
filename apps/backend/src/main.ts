/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';
import { VOD_PROCESSING_QUEUE, CLIP_SET_QUEUE, VOD_DOWNLOAD_QUEUE, VOD_ALIGN_QUEUE } from './infrastructure/queues/queue.constants';

/**
 * Délais HTTP, indispensables pour l'upload de VOD.
 *
 * Depuis Node 18, `requestTimeout` vaut cinq minutes par défaut et coupe toute
 * requête plus longue. Un fichier de plusieurs gigaoctets dépasse forcément ce
 * seuil, et le symptôme côté serveur est un `Error: Request aborted` de multer,
 * avec un fichier partiel abandonné sur le disque. On désactive donc la limite
 * de durée, tout en gardant celle sur les en-têtes, qui protège encore contre
 * les connexions inactives.
 */
const HEADERS_TIMEOUT_MS = 120_000;
const KEEP_ALIVE_TIMEOUT_MS = 65_000;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const allowedOrigins = ['http://localhost:4200'];
  if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL);
  app.enableCors({ origin: allowedOrigins });
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  // Bull Board — monté directement sur Express, hors du globalPrefix
  const redisConnection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  };
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/queues');
  createBullBoard({
    queues: [
      new BullMQAdapter(new Queue(VOD_PROCESSING_QUEUE, { connection: redisConnection })),
      new BullMQAdapter(new Queue(CLIP_SET_QUEUE, { connection: redisConnection })),
      new BullMQAdapter(new Queue(VOD_DOWNLOAD_QUEUE, { connection: redisConnection })),
      new BullMQAdapter(new Queue(VOD_ALIGN_QUEUE, { connection: redisConnection })),
    ],
    serverAdapter,
  });
  app.use('/queues', serverAdapter.getRouter());

  const server = app.getHttpServer();
  server.requestTimeout = 0;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;

  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
  Logger.log(`📋 Bull Board: http://localhost:${port}/queues`);
}

bootstrap();
