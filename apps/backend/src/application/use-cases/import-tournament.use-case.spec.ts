import { Test, TestingModule } from '@nestjs/testing';
import { ImportTournamentUseCase } from './import-tournament.use-case';
import { REPOSITORY_TOKENS } from '../../domain/repositories/injection-tokens';
import { STARTGG_SERVICE_TOKEN, IStartGGService } from '../../domain/services/startgg.service.interface';
import { ITournamentRepository } from '../../domain/repositories/tournament.repository.interface';

describe('ImportTournamentUseCase', () => {
  let useCase: ImportTournamentUseCase;
  let tournamentRepo: jest.Mocked<ITournamentRepository>;
  let startGGService: jest.Mocked<IStartGGService>;

  beforeEach(async () => {
    // Mocks des dépendances
    tournamentRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      findBySlug: jest.fn(),
      findByStartGGId: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findAll: jest.fn(),
    } as unknown as jest.Mocked<ITournamentRepository>;

    startGGService = {
      getTournamentBySlug: jest.fn(),
    } as unknown as jest.Mocked<IStartGGService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportTournamentUseCase,
        {
          provide: REPOSITORY_TOKENS.TOURNAMENT,
          useValue: tournamentRepo,
        },
        {
          provide: STARTGG_SERVICE_TOKEN,
          useValue: startGGService,
        },
      ],
    }).compile();

    useCase = module.get<ImportTournamentUseCase>(ImportTournamentUseCase);
  });

  it('should be defined', () => {
    expect(useCase).toBeDefined();
  });

  it('should import a tournament if it does not exist', async () => {
    const slug = 'genesis-8';
    const now = new Date();
    const mockTournamentData = {
      name: 'Genesis 8',
      slug: 'genesis-8',
      startAt: now,
      endAt: now,
      startGGId: '12345',
    };

    const mockSavedTournament = {
      id: 'uuid-123',
      ...mockTournamentData,
      createdAt: now,
      updatedAt: now,
    };

    // 1. Start.gg retourne les infos du tournoi
    startGGService.getTournamentBySlug.mockResolvedValue(mockTournamentData);
    // 2. Le repo dit que ce tournoi n'est pas encore en base
    tournamentRepo.findByStartGGId.mockResolvedValue(null);
    // 3. On simule la création
    tournamentRepo.create.mockResolvedValue(mockSavedTournament);

    const result = await useCase.execute(slug);

    expect(startGGService.getTournamentBySlug).toHaveBeenCalledWith(slug);
    expect(tournamentRepo.findByStartGGId).toHaveBeenCalledWith(mockTournamentData.startGGId);
    expect(tournamentRepo.create).toHaveBeenCalledWith(mockTournamentData);
    expect(result.id).toBe('uuid-123');
  });

  it('should throw an error if tournament is not found on Start.gg', async () => {
    startGGService.getTournamentBySlug.mockResolvedValue(null);

    await expect(useCase.execute('unknown-slug')).rejects.toThrow('Tournament not found on Start.gg');
  });
});
