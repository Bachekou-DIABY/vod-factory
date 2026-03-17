import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from '../infrastructure/persistence/prisma.service';
import { TournamentRepository } from '../infrastructure/persistence/tournament.repository';
import { PlayerRepository } from '../infrastructure/persistence/player.repository';
import { SetRepository } from '../infrastructure/persistence/set.repository';
import { VodRepository } from '../infrastructure/persistence/vod.repository';
import { REPOSITORY_TOKENS } from '../domain/repositories/injection-tokens';
import { ImportTournamentUseCase } from '../application/use-cases/import-tournament.use-case';
import { ImportSetsUseCase } from '../application/use-cases/import-sets.use-case';
import { STARTGG_SERVICE_TOKEN } from '../domain/services/startgg.service.interface';
import { StartGGService } from '../infrastructure/external-services/startgg.service';
import { TournamentController } from '../infrastructure/http/tournament.controller';
import { VodController } from '../infrastructure/http/vod.controller';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../domain/queues/queue-tokens';
import { VideoInfoService } from '../infrastructure/external-services/video-info.service';
import { AddVodUseCase } from '../application/use-cases/add-vod.use-case';
import { ConfigService } from '@nestjs/config';
import { VideoProcessingWorker } from '../infrastructure/workers/video-processing.worker';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get('REDIS_PORT', 6379),
        },
      }),
    }),
    BullModule.registerQueue({
      name: QUEUE_NAMES.VIDEO_PROCESSING,
    }),
  ],
  controllers: [AppController, TournamentController, VodController],
  providers: [
    AppService, 
    PrismaService,
    {
      provide: REPOSITORY_TOKENS.TOURNAMENT,
      useClass: TournamentRepository,
    },
    {
      provide: REPOSITORY_TOKENS.PLAYER,
      useClass: PlayerRepository,
    },
    {
      provide: REPOSITORY_TOKENS.SET,
      useClass: SetRepository,
    },
    {
      provide: REPOSITORY_TOKENS.VOD,
      useClass: VodRepository,
    },
    ImportTournamentUseCase,
    ImportSetsUseCase,
    AddVodUseCase,
    VideoInfoService,
    VideoProcessingWorker,
    {
      provide: STARTGG_SERVICE_TOKEN,
      useClass: StartGGService,
    },
  ],
})
export class AppModule {}
