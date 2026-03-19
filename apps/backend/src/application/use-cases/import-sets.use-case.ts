import { Inject, Injectable, Logger } from '@nestjs/common';
import { REPOSITORY_TOKENS } from '../../domain/repositories/injection-tokens';
import { ITournamentRepository } from '../../domain/repositories/tournament.repository.interface';
import { IPlayerRepository } from '../../domain/repositories/player.repository.interface';
import { ISetRepository } from '../../domain/repositories/set.repository.interface';
import { IStartGGService, STARTGG_SERVICE_TOKEN } from '../../domain/services/startgg.service.interface';

@Injectable()
export class ImportSetsUseCase {
  private readonly logger = new Logger(ImportSetsUseCase.name);

  constructor(
    @Inject(REPOSITORY_TOKENS.TOURNAMENT)
    private readonly tournamentRepository: ITournamentRepository,

    @Inject(REPOSITORY_TOKENS.PLAYER)
    private readonly playerRepository: IPlayerRepository,

    @Inject(REPOSITORY_TOKENS.SET)
    private readonly setRepository: ISetRepository,

    @Inject(STARTGG_SERVICE_TOKEN)
    private readonly startGGService: IStartGGService,
  ) {}

  async execute(tournamentId: string): Promise<void> {
    // 1. Récupérer le tournoi local pour avoir son ID Start.gg
    const tournament = await this.tournamentRepository.findById(tournamentId);
    if (!tournament || !tournament.startGGId) {
      throw new Error('Tournament not found in database or has no StartGG ID');
    }

    // 2. Récupérer les sets depuis Start.gg
    const externalSets = await this.startGGService.getSetsByTournamentId(tournament.startGGId);
    this.logger.log(`Found ${externalSets.length} sets to process for tournament ${tournament.name}`);

    for (const externalSet of externalSets) {
      // 3. Gérer les joueurs (Player 1 et Player 2)
      const p1 = await this.getOrCreatePlayer(externalSet.player1);
      const p2 = await this.getOrCreatePlayer(externalSet.player2);

      // 4. Vérifier si le set existe déjà
      const existingSet = await this.setRepository.findByStartGGId(externalSet.id);
      if (!existingSet) {
        // 5. Créer le set
        await this.setRepository.create({
          tournamentId: tournament.id,
          roundName: externalSet.roundName,
          bestOf: externalSet.bestOf,
          winnerId: externalSet.winnerId === externalSet.player1.id ? p1.id : p2.id,
          score: externalSet.score,
          startGGId: externalSet.id,
          player1Id: p1.id,
          player2Id: p2.id,
          startTime: externalSet.startTime ? new Date(externalSet.startTime) : undefined,
          endTime: externalSet.endTime ? new Date(externalSet.endTime) : undefined,
        });
      }
    }
  }

  private async getOrCreatePlayer(externalPlayer: { id: string; name: string; tag?: string }) {
    let player = await this.playerRepository.findByStartGGId(externalPlayer.id);
    
    if (!player) {
      player = await this.playerRepository.create({
        name: externalPlayer.name,
        tag: externalPlayer.tag,
        startGGId: externalPlayer.id,
      });
    }
    
    return player;
  }
}
