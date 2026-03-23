import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { IClipRepository, CLIP_REPOSITORY_TOKEN } from '../../domain/repositories/clip.repository.interface';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { IVodClipper, VOD_CLIPPER_TOKEN } from '../../domain/interfaces/vod-clipper.interface';
import { ClipStatus } from '../../domain/entities/clip.entity';
import * as path from 'path';
import * as fs from 'fs';

class UpdateClipDto {
  title?: string;
  roundName?: string;
  players?: string;
  score?: string;
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
      if (err) {
        this.logger.error(`Erreur streaming clip ${id}: ${err.message}`);
      }
    });
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

    // Remove old file if it exists and is different
    if (clip.filePath !== newFilePath && fs.existsSync(clip.filePath)) {
      fs.unlinkSync(clip.filePath);
    }

    return this.clipRepository.update(id, {
      startSeconds,
      endSeconds,
      filePath: result.outputPath,
      status: 'PENDING',
    });
  }
}
