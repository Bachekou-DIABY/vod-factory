import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from '../infrastructure/app.controller';
import { AppService } from '../infrastructure/app.service';
import { PrismaService } from '../infrastructure/persistence/prisma.service';
import { TournamentRepository } from '../infrastructure/persistence/tournament.repository';
import { PlayerRepository } from '../infrastructure/persistence/player.repository';
import { SetRepository } from '../infrastructure/persistence/set.repository';
import { VodRepository } from '../infrastructure/persistence/vod.repository';

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
    TournamentRepository,
    PlayerRepository,
    SetRepository,
    VodRepository,
  ],
})
export class AppModule {}
