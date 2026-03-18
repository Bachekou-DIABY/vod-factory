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
import { VOD_REPOSITORY_TOKEN } from '../domain/repositories/vod.repository.interface';
import { SET_REPOSITORY_TOKEN } from '../domain/repositories/set.repository.interface';
import { ImportTournamentUseCase } from '../application/use-cases/import-tournament.use-case';
import { ImportSetsUseCase } from '../application/use-cases/import-sets.use-case';
import { AddVodToTournamentUseCase } from '../application/use-cases/add-vod-to-tournament.usecase';
import { AnalyzeVodUseCase } from '../application/use-cases/analyze-vod.usecase';
import { STARTGG_SERVICE_TOKEN } from '../domain/services/startgg.service.interface';
import { GAME_SCREEN_DETECTOR_TOKEN } from '../domain/interfaces/game-screen-detector.interface';
import { VOD_DOWNLOAD_SERVICE_TOKEN } from '../domain/interfaces/vod-download-service.interface';
import { YtDlpDownloadService } from '../infrastructure/external-services/yt-dlp-download.service';
import { StartGGService } from '../infrastructure/external-services/startgg.service';
import { OcrGameScreenDetector } from '../infrastructure/external-services/ocr-game-screen-detector.service';
import { TournamentController } from '../infrastructure/http/tournament.controller';
import { VodController } from '../infrastructure/http/vod.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
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
      provide: VOD_REPOSITORY_TOKEN,
      useClass: VodRepository,
    },
    {
      provide: SET_REPOSITORY_TOKEN,
      useClass: SetRepository,
    },
    ImportTournamentUseCase,
    ImportSetsUseCase,
    AddVodToTournamentUseCase,
    AnalyzeVodUseCase,
    {
      provide: STARTGG_SERVICE_TOKEN,
      useClass: StartGGService,
    },
    {
      provide: GAME_SCREEN_DETECTOR_TOKEN,
      useClass: OcrGameScreenDetector,
    },
    {
      provide: VOD_DOWNLOAD_SERVICE_TOKEN,
      useClass: YtDlpDownloadService,
    },
  ],
})
export class AppModule {}
