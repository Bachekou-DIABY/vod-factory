import * as fs from 'fs';
import * as path from 'path';
import {
  ExpectedSet,
  FrameSignal,
} from '../../domain/alignment/alignment.types';
import { DEFAULT_ALIGNER_OPTIONS } from './set-aligner';
import { DEFAULT_SEGMENTER_OPTIONS, segment } from './segmenter';
import { refineAlignment } from './refine';

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '__fixtures__', 'la-suite-9-valetregis.json'),
    'utf8',
  ),
) as {
  sampleRate: number;
  startSeconds: number;
  hud: number[];
  dark: number[];
  biasSeconds: number;
  recordedAt: string;
  durationSeconds: number;
  sets: unknown[];
};

/**
 * Non-régression sur données réelles, première VOD en 1080p.
 *
 * Le TO a saisi certains scores après coup : Start.gg donne alors la même
 * heure en début et en fin, celle de la saisie. Pour le Losers Semi-Final,
 * cette heure tombe même après la fin de la VOD.
 */
describe('La Suite #9, chaîne ValEtRégis', () => {
  const signal: FrameSignal = {
    sampleRate: fixture.sampleRate,
    startSeconds: fixture.startSeconds,
    hud: Uint8Array.from(fixture.hud),
    dark: Uint8Array.from(fixture.dark),
  };

  const sets = fixture.sets as unknown as ExpectedSet[];

  const options = {
    ...DEFAULT_ALIGNER_OPTIONS,
    biasSeconds: fixture.biasSeconds,
    recordedAtUnix: Date.parse(fixture.recordedAt) / 1000,
    vodDurationSeconds: fixture.durationSeconds,
  };

  const aligner = () =>
    refineAlignment(
      signal,
      sets,
      segment(signal, DEFAULT_SEGMENTER_OPTIONS),
      options,
    ).aligned;

  const trouver = (round: string) =>
    aligner().find((a) => a.set.roundName === round)!;

  it('termine le Losers Semi-Final à la fin réelle du set, pas à la fin de la VOD', () => {
    // Relevé à l'oeil : la dernière game se termine vers 7:23:45. Le score a
    // été saisi à 7:33, après la fin de la VOD : prendre cette heure pour un
    // début attirait le set vers un bout de jeu sans rapport à 7:29.
    const semi = trouver('Losers Semi-Final');
    const derniere = semi.games[semi.games.length - 1];

    expect(semi.games).toHaveLength(5);
    expect(
      Math.abs(derniere.endSeconds - (7 * 3600 + 23 * 60 + 45)),
    ).toBeLessThanOrEqual(30);
  });

  it('écarte l écran de configuration des touches pris pour une game', () => {
    // 64 s de réglage des manettes à 0:02:40, une minute avant la première
    // vraie game : le set affichait 5 games pour un score en 4.
    const premier = aligner().find((a) =>
      a.set.players.startsWith('NES | Shadee'),
    )!;

    expect(premier.games).toHaveLength(4);
    expect(premier.source).toBe('video');
    expect(
      Math.abs(premier.games[0].startSeconds - (4 * 60 + 44)),
    ).toBeLessThanOrEqual(10);
    expect(premier.startSeconds).toBeGreaterThan(4 * 60);
  });

  it('garde le Losers Quarter-Final, saisi juste après sa fin', () => {
    const quart = trouver('Losers Quarter-Final');

    expect(quart.games).toHaveLength(3);
    expect(quart.endSeconds).toBeLessThanOrEqual(6 * 3600 + 43 * 60);
  });

  it('ne trouve aucune game pour les deux sets joués hors antenne', () => {
    const horsAntenne = aligner().filter(
      (a) =>
        a.set.players.startsWith('Koopario') ||
        a.set.players.startsWith('Mustinho'),
    );

    expect(horsAntenne).toHaveLength(2);
    expect(horsAntenne.every((a) => a.games.length === 0)).toBe(true);
  });

  it('ne produit aucun clip qui déborde sur le suivant', () => {
    const aligned = aligner()
      .filter((a) => a.games.length > 0)
      .sort((a, b) => a.startSeconds - b.startSeconds);

    for (let i = 1; i < aligned.length; i++) {
      expect(aligned[i].startSeconds).toBeGreaterThanOrEqual(
        aligned[i - 1].games[aligned[i - 1].games.length - 1].endSeconds,
      );
    }
  });
});
