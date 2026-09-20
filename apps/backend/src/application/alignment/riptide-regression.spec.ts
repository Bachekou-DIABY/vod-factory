import { ExpectedSet, FrameSignal } from '../../domain/alignment/alignment.types';
import { DEFAULT_ALIGNER_OPTIONS, alignSets } from './set-aligner';
import { DEFAULT_SEGMENTER_OPTIONS, segment } from './segmenter';
import * as fs from 'fs';
import * as path from 'path';

// Lu au lieu d etre importe : activer resolveJsonModule pour un seul test
// changerait la compilation de tout le backend.
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '__fixtures__', 'riptide-vgbootcamp.json'),
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
 * Non-régression sur données réelles, seul échantillon conservé de l'habillage
 * VGBootCamp. La VOD a été supprimée du serveur, seul son signal subsiste.
 *
 * Ce diffuseur avait déclaré douze sets sur la même chaîne alors qu'un seul
 * était à l'antenne. C'est le cas qui condamne la méthode par horaires seuls :
 * elle produisait des clips pour des sets jamais diffusés, sous le nom de
 * joueurs qu'on ne voit pas à l'écran.
 */
describe('Riptide 2026, habillage VGBootCamp', () => {
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

  it('attribue les cinq games au seul set réellement diffusé', () => {
    const aligned = alignSets(sets, segment(signal, DEFAULT_SEGMENTER_OPTIONS), options);

    const diffuse = aligned.filter((a) => a.games.length > 0);

    expect(diffuse).toHaveLength(1);
    expect(diffuse[0].set.players).toContain('Gackt');
    expect(diffuse[0].games).toHaveLength(5);
  });

  it('n attribue aucune game aux onze sets jamais passés à l antenne', () => {
    const aligned = alignSets(sets, segment(signal, DEFAULT_SEGMENTER_OPTIONS), options);

    const vides = aligned.filter((a) => a.games.length === 0);

    expect(vides).toHaveLength(sets.length - 1);
    expect(vides.every((a) => a.source === 'api')).toBe(true);
  });

  it('détecte le signal malgré une noirceur qui ne descend jamais très bas', () => {
    // Sur cet habillage le cadre reste allumé pendant les fondus : un seuil de
    // noirceur fixe ne trouvait aucune transition. D'où le seuil adaptatif.
    const candidats = segment(signal, DEFAULT_SEGMENTER_OPTIONS);

    expect(candidats.length).toBeGreaterThanOrEqual(5);
    expect(candidats.every((c) => c.endSeconds > c.startSeconds)).toBe(true);
  });
});
