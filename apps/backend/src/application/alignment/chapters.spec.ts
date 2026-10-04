import { chapitresYoutube } from './chapters';

const game = (startSeconds: number, endSeconds: number) => ({
  startSeconds,
  endSeconds,
});

describe('chapitresYoutube', () => {
  it('produit une ligne par game, la première à 0:00', () => {
    // Shadee vs Elcarick, La Suite #9, après recoupe à 276-1390.
    const chapitres = chapitresYoutube(
      { startSeconds: 276, endSeconds: 1390 },
      [game(284, 636), game(686, 886), game(928, 1132), game(1188, 1370)],
    );

    expect(chapitres).toBe(
      '0:00 Game 1\n6:50 Game 2\n10:52 Game 3\n15:12 Game 4',
    );
  });

  it('ignore une game écartée par une recoupe', () => {
    // L'écran de configuration à 160 reste dans le rapport, hors du clip.
    const chapitres = chapitresYoutube(
      { startSeconds: 276, endSeconds: 1390 },
      [game(160, 224), game(284, 636), game(686, 886), game(928, 1132)],
    );

    expect(chapitres?.split('\n')).toHaveLength(3);
  });

  it('ne produit rien pour un set en deux games', () => {
    // YouTube exige trois chapitres : en dessous, ce ne serait que du texte.
    expect(
      chapitresYoutube({ startSeconds: 0, endSeconds: 600 }, [
        game(10, 250),
        game(300, 580),
      ]),
    ).toBeNull();
  });

  it('ne produit rien si un chapitre dure moins de dix secondes', () => {
    expect(
      chapitresYoutube({ startSeconds: 0, endSeconds: 600 }, [
        game(10, 200),
        game(250, 255),
        game(258, 580),
      ]),
    ).toBeNull();
  });

  it('passe aux heures pour un clip d une heure ou plus', () => {
    const chapitres = chapitresYoutube({ startSeconds: 0, endSeconds: 4000 }, [
      game(5, 1200),
      game(1300, 2500),
      game(2600, 3900),
    ]);

    expect(chapitres).toBe('0:00:00 Game 1\n0:21:40 Game 2\n0:43:20 Game 3');
  });
});
