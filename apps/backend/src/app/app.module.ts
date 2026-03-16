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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
  ],
  controllers: [AppController],
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
  ],
})
export class AppModule {}
