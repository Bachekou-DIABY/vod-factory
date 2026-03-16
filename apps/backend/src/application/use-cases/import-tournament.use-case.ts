import { Inject, Injectable } from '@nestjs/common';
import { REPOSITORY_TOKENS } from '../../domain/repositories/injection-tokens';
import { ITournamentRepository } from '../../domain/repositories/tournament.repository.interface';
import { IStartGGService, STARTGG_SERVICE_TOKEN } from '../../domain/services/startgg.service.interface';
import { Tournament } from '../../domain/entities/tournament.entity';

@Injectable()
export class ImportTournamentUseCase {
  constructor(
    @Inject(REPOSITORY_TOKENS.TOURNAMENT)
    private readonly tournamentRepository: ITournamentRepository,
    
    @Inject(STARTGG_SERVICE_TOKEN)
    private readonly startGGService: IStartGGService,
  ) {}

  async execute(slug: string): Promise<Tournament> {
    // 1. Récupérer les données depuis Start.gg
    const externalData = await this.startGGService.getTournamentBySlug(slug);
    
    if (!externalData) {
      throw new Error('Tournament not found on Start.gg');
    }

    // 2. Vérifier si le tournoi existe déjà (via son StartGG ID)
    if (externalData.startGGId) {
      const existing = await this.tournamentRepository.findByStartGGId(externalData.startGGId);
      if (existing) {
        // Optionnel : on pourrait le mettre à jour ici
        return existing;
      }
    }

    // 3. Créer le tournoi en base
    return this.tournamentRepository.create(externalData);
  }
}
