import { estimateGameCount } from './score-parser';

/**
 * Les chaînes ci-dessous viennent de vrais sets Start.gg (Ultimate Fighting
 * Arena 2026). Le format réel place le second score à la fin, après le nom du
 * second joueur, et les pseudos contiennent chiffres et séparateurs.
 */
describe('estimateGameCount, format réel Start.gg', () => {
  it('lit un score dont les pseudos contiennent des chiffres', () => {
    expect(estimateGameCount('KID 3 - DLT/CS3 | MKBigBoss 0', 5).gameCount).toBe(3);
  });

  it('lit un score dont les pseudos contiennent des barres verticales', () => {
    expect(estimateGameCount('OPC | Raflow 3 - FLY | Riddles 2', 5).gameCount).toBe(5);
  });

  it('ne confond pas un chiffre de pseudo avec un score', () => {
    // "Player2" finit par un chiffre, mais il n'est pas précédé d'une espace.
    expect(estimateGameCount('Player1 3 - 1 Player2', 5).gameCount).toBe(4);
  });

  it('accepte la forme compacte sans pseudo', () => {
    expect(estimateGameCount('3 - 1', 5).gameCount).toBe(4);
    expect(estimateGameCount('2-0', 3).gameCount).toBe(2);
  });

  it('traite les DQ et scores négatifs comme zéro game jouée', () => {
    expect(estimateGameCount('DQ', 3).gameCount).toBe(0);
    expect(estimateGameCount('Tag -1 - Autre 0', 3).gameCount).toBe(0);
  });

  it('retombe sur les bornes du best-of quand le score est absent', () => {
    const estimate = estimateGameCount(null, 5);
    expect(estimate.gameCount).toBeNull();
    expect(estimate.minGames).toBe(3);
    expect(estimate.maxGames).toBe(5);
  });

  it('renvoie des bornes exactes quand le score est lisible', () => {
    const estimate = estimateGameCount('KID 3 - DLT/CS3 | MKBigBoss 0', 5);
    expect(estimate.minGames).toBe(3);
    expect(estimate.maxGames).toBe(3);
  });
});
