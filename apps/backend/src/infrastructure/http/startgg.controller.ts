import { Controller, Get, Post, Body, Param, Query, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { IStartGGService, STARTGG_SERVICE_TOKEN } from '../../domain/services/startgg.service.interface';
import { GenerateClipsFromTimestampsUseCase } from '../../application/use-cases/generate-clips-from-timestamps.usecase';

class GenerateClipsDto {
  eventStartGGId?: string;
  streamName?: string;
  vodRecordedAtUnix?: number;
  preBufferSeconds?: number;
  postBufferSeconds?: number;
}

@Controller('startgg')
export class StartGGController {
  constructor(
    @Inject(STARTGG_SERVICE_TOKEN)
    private readonly startGGService: IStartGGService,
    private readonly generateClipsUseCase: GenerateClipsFromTimestampsUseCase,
    private readonly configService: ConfigService,
  ) {}

  /** Debug: réponse brute Start.gg pour un event */
  @Get('events/:eventId/debug')
  async debugEvent(@Param('eventId') eventId: string) {
    const token = this.configService.get<string>('STARTGG_API_TOKEN');
    const query = `query { event(id: ${eventId}) { id name sets(page: 1, perPage: 5) { pageInfo { totalPages total } nodes { id state startedAt completedAt fullRoundText slots { entrant { id name } } } } } }`;
    const response = await axios.post(
      'https://api.start.gg/gql/alpha',
      { query },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return response.data;
  }

  /** Recherche des tournois par nom */
  @Get('search')
  async searchTournaments(@Query('q') query: string) {
    if (!query?.trim()) throw new BadRequestException('Paramètre q requis');
    return this.startGGService.searchTournaments(query.trim());
  }

  /** Récupère les events d'un tournoi (par slug ou startGGId) */
  @Get('tournaments/:slug/events')
  async getEvents(@Param('slug') slug: string) {
    const tournament = await this.startGGService.getTournamentBySlug(slug);
    if (!tournament?.startGGId) throw new NotFoundException(`Tournoi non trouvé: ${slug}`);
    const events = await this.startGGService.getEventsByTournamentId(tournament.startGGId);
    return { tournament, events };
  }

  /** Récupère tous les sets d'un event avec leurs timestamps */
  @Get('events/:eventId/sets')
  async getSets(
    @Param('eventId') eventId: string,
    @Query('streamName') streamName?: string,
  ) {
    const sets = await this.startGGService.getAllSetsByEventId(eventId, streamName);
    const withTimestamps = sets.filter((s) => s.startTime && s.endTime).length;
    return { total: sets.length, withTimestamps, sets };
  }

  /** Génère les clips d'une VOD depuis les timestamps Start.gg */
  @Post('vods/:vodId/generate-clips')
  async generateClips(
    @Param('vodId') vodId: string,
    @Body() dto: GenerateClipsDto,
  ) {
    return this.generateClipsUseCase.execute({ vodId, ...dto });
  }
}
