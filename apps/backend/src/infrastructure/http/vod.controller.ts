import { Controller, Post, Patch, Body, Get, Param, Inject, Logger, Res, NotFoundException, Delete, BadRequestException, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { AddVodToTournamentUseCase, AddVodToTournamentInput } from '../../application/use-cases/add-vod-to-tournament.usecase';
import { AnalyzeVodUseCase } from '../../application/use-cases/analyze-vod.usecase';
import { ClipVodUseCase } from '../../application/use-cases/clip-vod.usecase';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { IClipRepository, CLIP_REPOSITORY_TOKEN } from '../../domain/repositories/clip.repository.interface';
import { TournamentRepository } from '../persistence/tournament.repository';
import { CLIP_SET_QUEUE, CLIP_SET_JOB } from '../queues/queue.constants';

class CreateVodDto implements AddVodToTournamentInput {
  setId?: string;
  eventStartGGId?: string;
  streamName?: string;
  tournamentId?: string;
  name?: string;
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
    @Inject('ITournamentRepository')
    private readonly tournamentRepository: TournamentRepository,
    @InjectQueue(CLIP_SET_QUEUE)
    private readonly clipQueue: Queue,
  ) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const dir = path.join(process.cwd(), 'storage', 'vods');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
        cb(null, `${base}_${Date.now()}${ext}`);
      },
    }),
    fileFilter: (_req, file, cb) => {
      cb(null, file.mimetype.startsWith('video/'));
    },
    limits: { fileSize: 50 * 1024 * 1024 * 1024 }, // 50 GB max
  }))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { tournamentId?: string; eventStartGGId?: string; streamName?: string; name?: string },
  ) {
    if (!file) throw new BadRequestException('Aucun fichier vidéo fourni');
    this.logger.log(`📁 VOD uploadée: ${file.filename} (${(file.size / 1024 / 1024).toFixed(0)} MB)`);

    const name = body.name || path.basename(file.originalname, path.extname(file.originalname));
    return this.vodRepository.create({
      sourceUrl: `local:${file.originalname}`,
      filePath: file.path,
      tournamentId: body.tournamentId,
      eventStartGGId: body.eventStartGGId,
      streamName: body.streamName,
      name,
      status: 'DOWNLOADED',
      fileSize: file.size,
    } as any);
  }

  @Post()
  async create(@Body() dto: CreateVodDto) {
    this.logger.log(`📝 Création VOD (set: ${dto.setId ?? '-'}, event: ${dto.eventStartGGId ?? '-'})`);
    return this.addVodUseCase.execute(dto);
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    this.logger.log(`🔍 Recherche VOD ${id}`);
    const vod = await this.vodRepository.findById(id);
    if (!vod) return { error: 'VOD non trouvée' };
    let tournamentSlug: string | undefined;
    if (vod.tournamentId) {
      const t = await this.tournamentRepository.findById(vod.tournamentId);
      tournamentSlug = t?.slug;
    }
    return { ...vod, tournamentSlug };
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
      if (err && err.message !== 'Request aborted') {
        this.logger.error(`Erreur streaming VOD ${id}: ${err.message}`);
      }
    });
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    const vod = await this.vodRepository.findById(id);
    if (!vod) throw new NotFoundException(`VOD ${id} non trouvée`);
    await this.vodRepository.delete(id);
    return { message: 'VOD supprimée' };
  }

  @Post(':id/remux')
  async remux(@Param('id') id: string) {
    const vod = await this.vodRepository.findById(id);
    if (!vod?.filePath) throw new NotFoundException(`VOD ${id} non trouvée ou pas téléchargée`);
    if (!fs.existsSync(vod.filePath)) throw new NotFoundException(`Fichier VOD introuvable: ${vod.filePath}`);

    await this.vodRepository.update(id, { status: 'PROCESSING' } as any);

    const dir = path.dirname(vod.filePath);
    const ext = path.extname(vod.filePath);
    const base = path.basename(vod.filePath, ext);
    const newPath = path.join(dir, `${base}_faststart${ext}`);

    this.logger.log(`🔄 Remux VOD ${id}: ${path.basename(vod.filePath)} → ${path.basename(newPath)}`);
    this.runRemux(id, vod.filePath, newPath);

    return { message: 'Remux en cours...' };
  }

  private runRemux(vodId: string, inputPath: string, outputPath: string) {
    const proc = spawn('ffmpeg', [
      '-i', inputPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ]);

    proc.on('close', async (code) => {
      if (code === 0) {
        // Replace old file with remuxed version
        fs.unlinkSync(inputPath);
        await this.vodRepository.update(vodId, { filePath: outputPath, status: 'DOWNLOADED' } as any);
        this.logger.log(`✅ Remux terminé: ${path.basename(outputPath)}`);
      } else {
        await this.vodRepository.update(vodId, { status: 'DOWNLOADED' } as any);
        this.logger.error(`❌ Remux échoué pour VOD ${vodId} (code ${code})`);
      }
    });
  }

  @Post(':id/manual-clip')
  async manualClip(
    @Param('id') id: string,
    @Body() dto: { startSeconds: number; endSeconds: number; title?: string; roundName?: string },
  ) {
    const vod = await this.vodRepository.findById(id);
    if (!vod?.filePath) throw new NotFoundException(`VOD ${id} non trouvée ou pas téléchargée`);

    const { startSeconds, endSeconds, title, roundName } = dto;
    if (endSeconds <= startSeconds) {
      throw new BadRequestException('endSeconds doit être > startSeconds');
    }

    const storageDir = path.join(process.cwd(), 'storage', 'clips');
    const outputPath = path.join(storageDir, `${id}_manual_${Date.now()}.mp4`);

    const clips = await this.clipRepository.findByVodId(id);
    const setOrder = clips.length + 1;

    await this.clipQueue.add(CLIP_SET_JOB, {
      vodId: id,
      setOrder,
      inputPath: vod.filePath,
      outputPath,
      startSeconds,
      endSeconds,
      totalSets: 1,
      title: title ?? `Clip manuel ${setOrder}`,
      roundName: roundName ?? 'Manuel',
    });

    return { message: 'Clip en cours de génération', setOrder };
  }
}
