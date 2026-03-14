import { Module } from '@nestjs/common';
import { AppController } from '../infrastructure/app.controller';
import { AppService } from '../infrastructure/app.service';
import { PrismaService } from '../infrastructure/persistence/prisma.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
