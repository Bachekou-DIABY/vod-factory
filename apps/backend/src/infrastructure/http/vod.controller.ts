import { Controller, Post, Body, Get, Param, Inject, Logger } from '@nestjs/common';
import { AddVodToTournamentUseCase, AddVodToTournamentInput } from '../../application/use-cases/add-vod-to-tournament.usecase';
import { AnalyzeVodUseCase } from '../../application/use-cases/analyze-vod.usecase';
import { ClipVodUseCase } from '../../application/use-cases/clip-vod.usecase';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';

class CreateVodDto implements AddVodToTournamentInput {
  setId!: string;
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
    private readonly vodRepository: IVodRepository
  ) {}

  @Post()
  async create(@Body() dto: CreateVodDto) {
    this.logger.log(`📝 Création VOD pour set ${dto.setId}`);
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
}
