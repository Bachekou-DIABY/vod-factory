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
import { VOD_PROCESSING_QUEUE, CLIP_SET_QUEUE } from './infrastructure/queues/queue.constants';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
    ],
    serverAdapter,
  });
  app.use('/queues', serverAdapter.getRouter());

  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
  Logger.log(`📋 Bull Board: http://localhost:${port}/queues`);
}

bootstrap();
