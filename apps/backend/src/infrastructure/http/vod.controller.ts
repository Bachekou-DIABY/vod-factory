import { Controller, Post, Patch, Body, Get, Param, Inject, Logger, Res, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AddVodToTournamentUseCase, AddVodToTournamentInput } from '../../application/use-cases/add-vod-to-tournament.usecase';
import { AnalyzeVodUseCase } from '../../application/use-cases/analyze-vod.usecase';
import { ClipVodUseCase } from '../../application/use-cases/clip-vod.usecase';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { IClipRepository, CLIP_REPOSITORY_TOKEN } from '../../domain/repositories/clip.repository.interface';

class CreateVodDto implements AddVodToTournamentInput {
  setId?: string;
  eventStartGGId?: string;
  streamName?: string;
  tournamentId?: string;
  sourceUrl!: string;
  metadata?: Record<string, any>;
}

@Controller('vods')
export class VodController {
  private readonly logger = new Logger(VodController.name);

  constructor(
    private readonly addVodUseCase: AddVodToTournamentUseCase,
    private readonly analyzeVodUseCase: AnalyzeVodUseCase,
    private readonly clipVodUseCase: ClipVodUseCase,
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    @Inject(CLIP_REPOSITORY_TOKEN)
    private readonly clipRepository: IClipRepository,
  ) {}

  @Post()
  async create(@Body() dto: CreateVodDto) {
    this.logger.log(`📝 Création VOD (set: ${dto.setId ?? '-'}, event: ${dto.eventStartGGId ?? '-'})`);
    return this.addVodUseCase.execute(dto);
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    this.logger.log(`🔍 Recherche VOD ${id}`);
    const vod = await this.vodRepository.findById(id);
    if (!vod) {
      return { error: 'VOD non trouvée' };
    }
    return vod;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: Partial<CreateVodDto>) {
    this.logger.log(`✏️ Mise à jour VOD ${id}`);
    return this.vodRepository.update(id, dto as any);
  }

  @Post(':id/analyze')
  async analyze(@Param('id') id: string) {
    this.logger.log(`🔬 Analyse VOD ${id}`);
    return this.analyzeVodUseCase.execute(id);
  }

  @Post(':id/clip')
  async clip(@Param('id') id: string) {
    this.logger.log(`✂️ Clipping VOD ${id}`);
    return this.clipVodUseCase.execute(id);
  }

  @Get(':id/clip-plan')
  async getClipPlan(@Param('id') id: string) {
    this.logger.log(`📋 Clip plan VOD ${id}`);
    return this.clipVodUseCase.getClipPlan(id);
  }

  @Get(':id/clips')
  async getClips(@Param('id') id: string) {
    return this.clipRepository.findByVodId(id);
  }

  @Get(':id/stream')
  async stream(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const vod = await this.vodRepository.findById(id);
    if (!vod?.filePath || !fs.existsSync(vod.filePath)) {
      res.status(404).json({ message: 'Fichier VOD non trouvé' });
      return;
    }

    const filePath = path.resolve(vod.filePath);
    res.sendFile(filePath, (err) => {
      if (err) {
        this.logger.error(`Erreur streaming VOD ${id}: ${err.message}`);
      }
    });
  }
}
