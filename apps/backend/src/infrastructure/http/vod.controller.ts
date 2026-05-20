import { Controller, Post, Patch, Body, Get, Param, Query, Inject, Logger, Res, Req, NotFoundException, Delete, BadRequestException, UseInterceptors, UploadedFile, InternalServerErrorException, Header } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Response, Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { AddVodToTournamentUseCase, AddVodToTournamentInput } from '../../application/use-cases/add-vod-to-tournament.usecase';
import { FfprobeService } from '../external-services/ffprobe.service';
import { AnalyzeVodUseCase } from '../../application/use-cases/analyze-vod.usecase';
import { ClipVodUseCase } from '../../application/use-cases/clip-vod.usecase';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { IClipRepository, CLIP_REPOSITORY_TOKEN } from '../../domain/repositories/clip.repository.interface';
import { TournamentRepository } from '../persistence/tournament.repository';
import { CLIP_SET_QUEUE, CLIP_SET_JOB, VOD_DOWNLOAD_QUEUE, VOD_DOWNLOAD_JOB } from '../queues/queue.constants';
import { DownloadProgressService } from '../queues/download-progress.service';

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
    private readonly ffprobe: FfprobeService,
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    @Inject(CLIP_REPOSITORY_TOKEN)
    private readonly clipRepository: IClipRepository,
    @Inject('ITournamentRepository')
    private readonly tournamentRepository: TournamentRepository,
    @InjectQueue(CLIP_SET_QUEUE)
    private readonly clipQueue: Queue,
    @InjectQueue(VOD_DOWNLOAD_QUEUE)
    private readonly downloadQueue: Queue,
    private readonly downloadProgress: DownloadProgressService,
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
    @Body() body: { tournamentId?: string; eventStartGGId?: string; streamName?: string; name?: string; sourceStreamUrl?: string },
  ) {
    if (!file) throw new BadRequestException('Aucun fichier vidéo fourni');
    this.logger.log(`📁 VOD uploadée: ${file.filename} (${(file.size / 1024 / 1024).toFixed(0)} MB)`);

    const name = body.name || path.basename(file.originalname, path.extname(file.originalname));
    const probe = await this.ffprobe.probe(file.path).catch(() => ({ duration: 0, resolution: '1920x1080', fps: 30, recordedAt: undefined }));

    if (probe.recordedAt) {
      this.logger.log(`📅 recordedAt extrait du fichier: ${probe.recordedAt.toISOString()}`);
    }

    const vod = await this.vodRepository.create({
      sourceUrl: `local:${file.originalname}`,
      filePath: file.path,
      tournamentId: body.tournamentId,
      eventStartGGId: body.eventStartGGId,
      streamName: body.streamName,
      name,
      status: 'PROCESSING',
      fileSize: file.size,
      duration: probe.duration,
      resolution: probe.resolution,
      fps: probe.fps,
      recordedAt: probe.recordedAt,
    } as any);

    // Auto-remux pour faststart (fire and forget, runRemux repassera à DOWNLOADED)
    const ext = path.extname(file.path);
    const base = path.basename(file.path, ext);
    const remuxedPath = path.join(path.dirname(file.path), `${base}_fs${ext}`);
    this.runRemux(vod.id, file.path, remuxedPath);

    // Si pas de recordedAt extrait du fichier, tenter depuis l'URL source fournie
    if (!probe.recordedAt && body.sourceStreamUrl?.trim()) {
      this.fetchAndSaveTimestamp(vod.id, body.sourceStreamUrl.trim());
    }

    return vod;
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
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const vod = await this.vodRepository.findById(id);
    if (!vod?.filePath || !fs.existsSync(vod.filePath)) {
      res.status(404).json({ message: 'Fichier VOD non trouvé' });
      return;
    }

    const filePath = path.resolve(vod.filePath);
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  }

  @Delete(':id/file')
  async deleteSourceFile(@Param('id') id: string) {
    const vod = await this.vodRepository.findById(id);
    if (!vod) throw new NotFoundException(`VOD ${id} non trouvée`);
    if (!vod.filePath) return { message: 'Pas de fichier source' };

    const filePath = path.resolve(vod.filePath);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        this.logger.log(`🗑️ Fichier source supprimé: ${filePath}`);
      } catch (err) {
        throw new InternalServerErrorException(`Impossible de supprimer le fichier: ${err.message}`);
      }
    }
    await this.vodRepository.update(id, { filePath: null } as any);
    return { message: 'Fichier source supprimé' };
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    const vod = await this.vodRepository.findById(id);
    if (!vod) throw new NotFoundException(`VOD ${id} non trouvée`);
    // Supprimer le fichier source VOD
    if ((vod as any).filePath) {
      const filePath = path.resolve((vod as any).filePath);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (_e) { /* ignore */ }
      }
    }
    // Supprimer les fichiers physiques des clips
    const clips = await this.clipRepository.findByVodId(id);
    for (const clip of clips) {
      if ((clip as any).filePath) {
        const clipPath = path.resolve((clip as any).filePath);
        if (fs.existsSync(clipPath)) {
          try { fs.unlinkSync(clipPath); } catch (_e) { /* ignore */ }
        }
      }
    }
    await this.vodRepository.delete(id);
    return { message: 'VOD supprimée' };
  }

  @Get(':id/download-progress')
  @Header('Cache-Control', 'no-store')
  async getDownloadProgress(@Param('id') id: string) {
    const progress = this.downloadProgress.get(id);
    if (progress !== null) return { progress, status: 'active' };
    const waiting = await this.downloadQueue.getWaiting();
    if (waiting.find(j => j.data.vodId === id)) return { progress: 0, status: 'waiting' };
    return { progress: null, status: 'unknown' };
  }

  @Post(':id/retry-download')
  async retryDownload(@Param('id') id: string) {
    const vod = await this.vodRepository.findById(id);
    if (!vod) throw new NotFoundException(`VOD ${id} non trouvée`);

    // Clean stalled jobs for this vod in the queue
    const [active, waiting, failed, delayed] = await Promise.all([
      this.downloadQueue.getActive(),
      this.downloadQueue.getWaiting(),
      this.downloadQueue.getFailed(),
      this.downloadQueue.getDelayed(),
    ]);
    const existing = [...active, ...waiting, ...failed, ...delayed].filter(j => j.data.vodId === id);
    await Promise.all(existing.map(j => j.remove()));

    await this.vodRepository.update(id, { status: 'DOWNLOADING' } as any);
    await this.downloadQueue.add(VOD_DOWNLOAD_JOB, { vodId: id, sourceUrl: vod.sourceUrl }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10000 },
    });
    this.logger.log(`🔁 Retry download enqueued pour VOD ${id}`);
    return { message: 'Téléchargement relancé' };
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

  private fetchAndSaveTimestamp(vodId: string, url: string): void {
    const proc = spawn('yt-dlp', [
      '--print', '%(release_timestamp)s',
      '--print', '%(timestamp)s',
      '--no-playlist', url,
    ]);
    let output = '';
    proc.stdout.on('data', (d: Buffer) => { output += d.toString(); });
    proc.on('close', () => {
      const [releaseTimestamp, timestamp] = output.trim().split('\n');
      const releaseTs = parseInt(releaseTimestamp);
      const ts = parseInt(timestamp);
      const finalTs = (isFinite(releaseTs) && releaseTs > 0) ? releaseTs
        : (isFinite(ts) && ts > 0) ? ts : NaN;
      if (isFinite(finalTs) && finalTs > 0) {
        this.vodRepository.update(vodId, { recordedAt: new Date(finalTs * 1000) } as any)
          .then(() => this.logger.log(`📅 recordedAt sauvegardé depuis URL pour VOD ${vodId}`))
          .catch((_e: unknown) => { /* ignore */ });
      }
    });
    proc.on('error', (_e: unknown) => { /* ignore */ });
  }

  private runRemux(vodId: string, inputPath: string, outputPath: string): void {
    const mp4Output = outputPath.replace(/\.[^.]+$/, '.mp4');
    this.runRemuxAttempt(vodId, inputPath, mp4Output, false);
  }

  private runRemuxAttempt(vodId: string, inputPath: string, mp4Output: string, forceMpegTs: boolean): void {
    const args = [
      ...(forceMpegTs ? ['-f', 'mpegts'] : []),
      '-i', inputPath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      '-f', 'mp4',
      '-y', mp4Output,
    ];

    const proc = spawn('ffmpeg', args);

    proc.stderr.on('data', (data) => {
      this.logger.debug(`ffmpeg remux: ${data.toString().trim()}`);
    });

    proc.on('close', async (code) => {
      if (code === 0 && fs.existsSync(mp4Output)) {
        try { fs.unlinkSync(inputPath); } catch (_e) { /* ignore */ }
        await this.vodRepository.update(vodId, { filePath: mp4Output, status: 'DOWNLOADED' } as any);
        this.logger.log(`✅ Remux terminé: ${path.basename(mp4Output)}`);
      } else if (!forceMpegTs) {
        this.logger.warn(`⚠️ Remux standard échoué (code ${code}), retry en forçant MPEG-TS...`);
        this.runRemuxAttempt(vodId, inputPath, mp4Output, true);
      } else {
        await this.vodRepository.update(vodId, { status: 'DOWNLOADED' } as any);
        this.logger.error(`❌ Remux échoué pour VOD ${vodId} (code ${code})`);
      }
    });

    proc.on('error', async () => {
      await this.vodRepository.update(vodId, { status: 'DOWNLOADED' } as any);
      this.logger.error(`❌ ffmpeg introuvable pour remux VOD ${vodId}`);
    });
  }

  @Get(':id/fetch-timestamp')
  async fetchTimestamp(@Param('id') id: string, @Query('url') overrideUrl?: string) {
    const vod = await this.vodRepository.findById(id);
    if (!vod) throw new NotFoundException(`VOD ${id} non trouvée`);
    const url = overrideUrl?.trim() || (
      (vod.sourceUrl.startsWith('local:') || vod.sourceUrl.startsWith('/'))
        ? null
        : vod.sourceUrl
    );
    if (!url) throw new BadRequestException('Fournis l\'URL du stream pour récupérer le timestamp');
    return new Promise((resolve, reject) => {
      const proc = spawn('yt-dlp', [
        '--print', '%(release_timestamp)s',
        '--print', '%(timestamp)s',
        '--no-playlist', url,
      ]);
      let output = '';
      proc.stdout.on('data', (d: Buffer) => { output += d.toString(); });
      proc.on('close', () => {
        const [releaseTimestamp, timestamp] = output.trim().split('\n');
        const releaseTs = parseInt(releaseTimestamp);
        const ts = parseInt(timestamp);
        // Prefer release_timestamp (actual stream start for YouTube live) over timestamp (upload date)
        const finalTs = (isFinite(releaseTs) && releaseTs > 0) ? releaseTs
          : (isFinite(ts) && ts > 0) ? ts : NaN;
        if (isFinite(finalTs) && finalTs > 0) {
          this.vodRepository.update(id, { recordedAt: new Date(finalTs * 1000) } as any).catch((_e: unknown) => { /* ignore */ });
          resolve({ timestamp: finalTs });
        } else reject(new BadRequestException('Impossible de récupérer le timestamp depuis l\'URL'));
      });
      proc.on('error', () => reject(new BadRequestException('yt-dlp non disponible')));
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
