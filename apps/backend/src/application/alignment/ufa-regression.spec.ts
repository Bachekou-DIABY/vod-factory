import * as fs from 'fs';
import * as path from 'path';
import { ExpectedSet, FrameSignal } from '../../domain/alignment/alignment.types';
import { DEFAULT_ALIGNER_OPTIONS } from './set-aligner';
import { DEFAULT_SEGMENTER_OPTIONS, segment } from './segmenter';
import { refineAlignment } from './refine';

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, '__fixtures__', 'ufa-etoiles.json'), 'utf8'),
) as {
  sampleRate: number;
  startSeconds: number;
  hud: number[];
  dark: number[];
  biasSeconds: number;
  recordedAt: string;
  durationSeconds: number;
  sets: unknown[];
  attendu: Array<{
    round: string;
    gameCount: number;
    startSeconds: number;
    endSeconds: number;
    games: Array<[number, number]>;
  }>;
};

/**
 * Non-régression sur données réelles : le top 8 d'UFA, validé 10/10 à l'oeil.
 *
 * Cas le plus propre des trois : chaque set est diffusé, dans l'ordre, sans
 * poules parallèles. Le moindre set mal compté ici signale une régression
 * générale, pas un cas limite.
 */
describe('Ultimate Fighting Arena 2026, stream Etoiles', () => {
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
    refineAlignment(signal, sets, segment(signal, DEFAULT_SEGMENTER_OPTIONS), options)
      .aligned;

  it('retrouve le compte de games annoncé par le score sur les dix sets', () => {
    const aligned = aligner();

    expect(aligned).toHaveLength(fixture.attendu.length);
    for (const a of aligned) {
      expect(a.games).toHaveLength(a.set.gameCount!);
    }
  });

  it('place chaque set à moins de 30 s des bornes validées', () => {
    const aligned = aligner();

    fixture.attendu.forEach((attendu, i) => {
      expect(aligned[i].set.roundName).toBe(attendu.round);
      expect(Math.abs(aligned[i].startSeconds - attendu.startSeconds)).toBeLessThanOrEqual(30);
      expect(Math.abs(aligned[i].endSeconds - attendu.endSeconds)).toBeLessThanOrEqual(30);
    });
  });

  it('ne produit aucun clip qui déborde sur le suivant', () => {
    const aligned = aligner();

    for (let i = 1; i < aligned.length; i++) {
      expect(aligned[i].startSeconds).toBeGreaterThanOrEqual(
        aligned[i - 1].games[aligned[i - 1].games.length - 1].endSeconds,
      );
    }
  });
});
