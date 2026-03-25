import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  Res,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { Response } from 'express';
import { IClipRepository, CLIP_REPOSITORY_TOKEN } from '../../domain/repositories/clip.repository.interface';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { IVodClipper, VOD_CLIPPER_TOKEN } from '../../domain/interfaces/vod-clipper.interface';
import { ClipStatus } from '../../domain/entities/clip.entity';
import * as path from 'path';
import * as fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';

class UpdateClipDto {
  title?: string;
  roundName?: string;
  players?: string;
  score?: string;
  description?: string;
  privacyStatus?: string;
  status?: ClipStatus;
  startSeconds?: number;
  endSeconds?: number;
}

class RecutClipDto {
  startSeconds!: number;
  endSeconds!: number;
}

@Controller('clips')
export class ClipController {
  private readonly logger = new Logger(ClipController.name);

  constructor(
    @Inject(CLIP_REPOSITORY_TOKEN)
    private readonly clipRepository: IClipRepository,
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    @Inject(VOD_CLIPPER_TOKEN)
    private readonly vodClipper: IVodClipper,
  ) {}

  @Get(':id')
  async findById(@Param('id') id: string) {
    const clip = await this.clipRepository.findById(id);
    if (!clip) throw new NotFoundException(`Clip ${id} non trouvé`);
    return clip;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateClipDto) {
    const clip = await this.clipRepository.findById(id);
    if (!clip) throw new NotFoundException(`Clip ${id} non trouvé`);

    this.logger.log(`✏️ Mise à jour clip ${id}`);
    return this.clipRepository.update(id, dto);
  }

  private generateThumbnail(clipPath: string, thumbPath: string, seekSeconds: number): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(clipPath)
        .seekInput(seekSeconds)
        .outputOptions(['-vframes', '1', '-q:v', '5'])
        .output(thumbPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .run();
    });
  }

  @Post(':id/thumbnail')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const dir = path.join(process.cwd(), 'storage', 'thumbnails');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${(req as any).params['id']}_custom${ext}`);
      },
    }),
    fileFilter: (_req, file, cb) => {
      cb(null, file.mimetype.startsWith('image/'));
    },
  }))
  async uploadThumbnail(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier image fourni');
    const clip = await this.clipRepository.findById(id);
    if (!clip) throw new NotFoundException(`Clip ${id} non trouvé`);

    // Remove old auto-generated thumbnail if it exists and differs
    if (clip.thumbnailPath && clip.thumbnailPath !== file.path && fs.existsSync(clip.thumbnailPath)) {
      fs.unlinkSync(clip.thumbnailPath);
    }

    this.logger.log(`🖼️ Thumbnail custom uploadé pour clip ${id}: ${file.filename}`);
    return this.clipRepository.update(id, { thumbnailPath: file.path } as any);
  }

  @Get(':id/thumbnail')
  async thumbnail(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const clip = await this.clipRepository.findById(id);
    if (!clip?.filePath || !fs.existsSync(clip.filePath)) {
      res.status(404).json({ message: 'Clip non trouvé' });
      return;
    }

    const thumbPath = clip.filePath.replace(/\.[^.]+$/, '_thumb.jpg');

    if (!fs.existsSync(thumbPath)) {
      const duration = clip.endSeconds - clip.startSeconds;
      const seekAt = Math.max(1, duration * 0.1);
      try {
        await this.generateThumbnail(clip.filePath, thumbPath, seekAt);
        this.clipRepository.update(id, { thumbnailPath: thumbPath } as any).catch((e) => { this.logger.warn(`Thumb DB update failed: ${e}`); });
      } catch (err) {
        this.logger.warn(`Thumbnail generation failed for clip ${id}: ${(err as Error).message}`);
        res.status(404).json({ message: 'Thumbnail non disponible' });
        return;
      }
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(path.resolve(thumbPath));
  }

  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const clip = await this.clipRepository.findById(id);
    if (!clip?.filePath || !fs.existsSync(clip.filePath)) {
      res.status(404).json({ message: 'Fichier clip non trouvé' });
      return;
    }
    const title = clip.title ?? clip.roundName ?? `clip_${id}`;
    const safeTitle = title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);
    res.setHeader('Content-Type', 'video/mp4');
    res.sendFile(path.resolve(clip.filePath));
  }

  @Get(':id/stream')
  async stream(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const clip = await this.clipRepository.findById(id);
    if (!clip?.filePath || !fs.existsSync(clip.filePath)) {
      res.status(404).json({ message: 'Fichier clip non trouvé' });
      return;
    }

    const filePath = path.resolve(clip.filePath);
    res.sendFile(filePath, (err) => {
      if (err && err.message !== 'Request aborted') {
        this.logger.error(`Erreur streaming clip ${id}: ${err.message}`);
      }
    });
  }

  @Post(':id/retry')
  async retry(@Param('id') id: string) {
    const clip = await this.clipRepository.findById(id);
    if (!clip) throw new NotFoundException(`Clip ${id} non trouvé`);
    if (clip.status !== 'FAILED') throw new BadRequestException('Le clip doit être en FAILED pour être relancé');

    const vod = await this.vodRepository.findById(clip.vodId);
    if (!vod?.filePath) throw new NotFoundException(`VOD ${clip.vodId} sans fichier`);

    const dir = path.join(process.cwd(), 'storage', 'clips');
    const newFilePath = path.join(dir, `${id}_retry_${Date.now()}.mp4`);

    await this.clipRepository.update(id, { status: 'PENDING' });

    this.vodClipper.clip({
      inputPath: vod.filePath,
      outputPath: newFilePath,
      startSeconds: clip.startSeconds,
      endSeconds: clip.endSeconds,
    }).then(async (result) => {
      await this.clipRepository.update(id, { filePath: result.outputPath });
      this.logger.log(`✅ Retry clip ${id} OK: ${result.outputPath}`);
    }).catch(async () => {
      await this.clipRepository.update(id, { status: 'FAILED' });
      this.logger.error(`❌ Retry clip ${id} échoué`);
    });

    return { message: 'Clip en cours de re-génération...' };
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    const clip = await this.clipRepository.findById(id);
    if (!clip) throw new NotFoundException(`Clip ${id} non trouvé`);
    await this.clipRepository.delete(id);
    return { message: 'Clip supprimé' };
  }

  @Post(':id/recut')
  async recut(@Param('id') id: string, @Body() dto: RecutClipDto) {
    const { startSeconds, endSeconds } = dto;
    if (startSeconds === undefined || endSeconds === undefined) {
      throw new BadRequestException('startSeconds et endSeconds sont requis');
    }
    if (endSeconds <= startSeconds) {
      throw new BadRequestException('endSeconds doit être > startSeconds');
    }

    const clip = await this.clipRepository.findById(id);
    if (!clip) throw new NotFoundException(`Clip ${id} non trouvé`);

    const vod = await this.vodRepository.findById(clip.vodId);
    if (!vod?.filePath) throw new NotFoundException(`VOD ${clip.vodId} non trouvée ou pas téléchargée`);

    // Generate new output path
    const dir = path.dirname(clip.filePath);
    const ext = path.extname(clip.filePath);
    const base = path.basename(clip.filePath, ext);
    const newFilePath = path.join(dir, `${base}_recut_${Date.now()}${ext}`);

    this.logger.log(`✂️ Recut clip ${id}: [${startSeconds}s → ${endSeconds}s]`);

    const result = await this.vodClipper.clip({
      inputPath: vod.filePath,
      outputPath: newFilePath,
      startSeconds,
      endSeconds,
    });

    // Remove old clip file + thumbnail
    const oldPath = path.resolve(clip.filePath);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    const oldThumb = oldPath.replace(/\.[^.]+$/, '_thumb.jpg');
    if (fs.existsSync(oldThumb)) fs.unlinkSync(oldThumb);

    return this.clipRepository.update(id, {
      startSeconds,
      endSeconds,
      filePath: result.outputPath,
      status: 'PENDING',
    });
  }
}
