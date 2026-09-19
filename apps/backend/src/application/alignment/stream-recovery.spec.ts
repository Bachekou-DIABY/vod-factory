import {
  RecoverableSet,
  recoverBracketResets,
} from './stream-recovery';

interface Faux extends RecoverableSet {
  nom: string;
}

const lire = (s: Faux): RecoverableSet => s;

function set(
  nom: string,
  entrantIds: string[],
  hasStream: boolean,
  startedAt: number | null,
  completedAt: number | null,
): Faux {
  return { nom, entrantIds, hasStream, startedAt, completedAt };
}

describe('recoverBracketResets', () => {
  const grandeFinale = set('GF', ['1', '2'], true, 1000, 2000);

  it('récupère le reset que le TO a oublié de rattacher', () => {
    const reset = set('reset', ['1', '2'], false, 2036, 3100);

    const repeches = recoverBracketResets([grandeFinale, reset], [grandeFinale], lire);

    expect(repeches.map((s) => s.nom)).toEqual(['reset']);
  });

  it('reconnaît les adversaires quel que soit leur ordre', () => {
    // Start.gg inverse les côtés sur le reset : le gagnant passe en premier.
    const reset = set('reset', ['2', '1'], false, 2036, 3100);

    expect(recoverBracketResets([grandeFinale, reset], [grandeFinale], lire)).toHaveLength(1);
  });

  it('ignore un set entre deux autres joueurs', () => {
    const autre = set('autre', ['3', '4'], false, 2036, 3100);

    expect(recoverBracketResets([grandeFinale, autre], [grandeFinale], lire)).toHaveLength(0);
  });

  it('ignore un set déjà rattaché à une chaîne', () => {
    // Rattaché mais à une autre chaîne : c'est un vrai set hors de cette VOD.
    const ailleurs = set('ailleurs', ['1', '2'], true, 2036, 3100);

    expect(recoverBracketResets([grandeFinale, ailleurs], [grandeFinale], lire)).toHaveLength(0);
  });

  it('ignore un rematch trop tardif pour être un reset', () => {
    // Les mêmes joueurs peuvent se recroiser plus tard dans le bracket.
    const tardif = set('tardif', ['1', '2'], false, 2000 + 3600, 9000);

    expect(recoverBracketResets([grandeFinale, tardif], [grandeFinale], lire)).toHaveLength(0);
  });

  it('ignore un set antérieur au set diffusé', () => {
    const avant = set('avant', ['1', '2'], false, 100, 500);

    expect(recoverBracketResets([grandeFinale, avant], [grandeFinale], lire)).toHaveLength(0);
  });

  it('ignore un set sans heure de début, qu on ne peut pas rattacher', () => {
    const sansHeure = set('sansHeure', ['1', '2'], false, null, 3100);

    expect(recoverBracketResets([grandeFinale, sansHeure], [grandeFinale], lire)).toHaveLength(0);
  });

  it('ne récupère rien quand aucun set n est retenu', () => {
    const reset = set('reset', ['1', '2'], false, 2036, 3100);

    expect(recoverBracketResets([grandeFinale, reset], [], lire)).toHaveLength(0);
  });

  it('ne renvoie jamais un set déjà retenu', () => {
    expect(
      recoverBracketResets([grandeFinale], [grandeFinale], lire),
    ).toHaveLength(0);
  });
});
