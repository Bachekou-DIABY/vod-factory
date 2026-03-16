/**
 * Injection tokens for repository interfaces.
 *
 * Using string tokens (rather than the concrete classes) ensures
 * that the application layer depends only on the domain interfaces,
 * not on Prisma or any other infrastructure detail.
 *
 * Usage in a use case:
 *   @Inject(REPOSITORY_TOKENS.TOURNAMENT) private repo: ITournamentRepository
 */
export const REPOSITORY_TOKENS = {
  TOURNAMENT: 'ITournamentRepository',
  PLAYER: 'IPlayerRepository',
  SET: 'ISetRepository',
  VOD: 'IVodRepository',
} as const;
