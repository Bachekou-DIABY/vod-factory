import { Test, TestingModule } from '@nestjs/testing';
import { ImportSetsUseCase } from './import-sets.use-case';
import { REPOSITORY_TOKENS } from '../../domain/repositories/injection-tokens';
import { STARTGG_SERVICE_TOKEN, IStartGGService, StartGGSetResponse } from '../../domain/services/startgg.service.interface';
import { ITournamentRepository } from '../../domain/repositories/tournament.repository.interface';
import { IPlayerRepository } from '../../domain/repositories/player.repository.interface';
import { ISetRepository } from '../../domain/repositories/set.repository.interface';
import { Tournament } from '../../domain/entities/tournament.entity';
import { Player } from '../../domain/entities/player.entity';
import { Set } from '../../domain/entities/set.entity';

describe('ImportSetsUseCase', () => {
  let useCase: ImportSetsUseCase;
  let tournamentRepo: jest.Mocked<ITournamentRepository>;
  let playerRepo: jest.Mocked<IPlayerRepository>;
  let setRepo: jest.Mocked<ISetRepository>;
  let startGGService: jest.Mocked<IStartGGService>;

  beforeEach(async () => {
    tournamentRepo = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<ITournamentRepository>;

    playerRepo = {
      findByStartGGId: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<IPlayerRepository>;

    setRepo = {
      findByStartGGId: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<ISetRepository>;

    startGGService = {
      getSetsByTournamentId: jest.fn(),
    } as unknown as jest.Mocked<IStartGGService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportSetsUseCase,
        { provide: REPOSITORY_TOKENS.TOURNAMENT, useValue: tournamentRepo },
        { provide: REPOSITORY_TOKENS.PLAYER, useValue: playerRepo },
        { provide: REPOSITORY_TOKENS.SET, useValue: setRepo },
        { provide: STARTGG_SERVICE_TOKEN, useValue: startGGService },
      ],
    }).compile();

    useCase = module.get<ImportSetsUseCase>(ImportSetsUseCase);
  });

  it('should import sets and players successfully', async () => {
    const tournamentId = 'internal-tourney-id';
    const mockTournament = { 
      id: tournamentId, 
      startGGId: 'sg-tourney-123',
      name: 'Genesis 8',
      slug: 'genesis-8',
      startAt: new Date(),
      endAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    } as Tournament;

    const mockSets: StartGGSetResponse[] = [
      {
        id: 'sg-set-1',
        roundName: 'Winners Finals',
        winnerId: 'sg-player-1',
        score: '3-0',
        player1: { id: 'sg-player-1', name: 'MkLeo', tag: 'T1' },
        player2: { id: 'sg-player-2', name: 'Glutonny', tag: 'Solary' },
      }
    ];

    tournamentRepo.findById.mockResolvedValue(mockTournament);
    startGGService.getSetsByTournamentId.mockResolvedValue(mockSets);
    
    // Simuler que les joueurs n'existent pas encore
    playerRepo.findByStartGGId.mockResolvedValue(null);
    playerRepo.create.mockImplementation((playerData) => Promise.resolve({ 
      id: 'internal-' + playerData.startGGId, 
      ...playerData,
      createdAt: new Date(),
      updatedAt: new Date()
    } as Player));
    
    // Simuler que le match n'existe pas encore
    setRepo.findByStartGGId.mockResolvedValue(null);
    setRepo.create.mockImplementation((setData) => Promise.resolve({ 
      id: 'internal-set-1', 
      ...setData,
      createdAt: new Date(),
      updatedAt: new Date()
    } as Set));

    await useCase.execute(tournamentId);

    expect(tournamentRepo.findById).toHaveBeenCalledWith(tournamentId);
    expect(startGGService.getSetsByTournamentId).toHaveBeenCalledWith(mockTournament.startGGId);
    expect(playerRepo.create).toHaveBeenCalledTimes(2); // MkLeo + Glutonny
    expect(setRepo.create).toHaveBeenCalled();
  });

  it('should throw error if tournament not found in database', async () => {
    tournamentRepo.findById.mockResolvedValue(null);
    await expect(useCase.execute('unknown')).rejects.toThrow('Tournament not found in database');
  });
});
