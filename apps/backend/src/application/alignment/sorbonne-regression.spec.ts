import * as fs from 'fs';
import * as path from 'path';
import { ExpectedSet, FrameSignal } from '../../domain/alignment/alignment.types';
import { DEFAULT_ALIGNER_OPTIONS } from './set-aligner';
import { DEFAULT_SEGMENTER_OPTIONS, segment } from './segmenter';
import { refineAlignment } from './refine';

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '__fixtures__', 'sorbonne-naubody.json'),
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
 * Non-régression sur données réelles, seul échantillon de l'habillage NauBody
 * et seule VOD téléchargée directement depuis Twitch par le serveur.
 *
 * Six heures de diffusion pour huit sets rattachés à la chaîne, tous en fin de
 * bracket : les trois premières heures sont des poules jouées en parallèle sur
 * des dizaines de setups, que Start.gg ne rattache à rien. Les candidats
 * détectés là sont donc légitimement orphelins, et doivent le rester.
 */
describe('Play Sorbonne 2026, habillage NauBody', () => {
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

  // La chaine complete, rattrapages compris : c'est ce que le serveur execute.
  const aligner = () =>
    refineAlignment(signal, sets, segment(signal, DEFAULT_SEGMENTER_OPTIONS), options)
      .aligned;

  it('retrouve le compte de games annoncé par le score sur les huit sets', () => {
    const aligned = aligner();

    const exacts = aligned.filter((a) => a.games.length === a.set.gameCount);

    expect(exacts).toHaveLength(sets.length);
  });

  it('découpe le bracket reset que le TO n avait pas rattaché à la chaîne', () => {
    // Start.gg le donne avec stream: null. Sans sa récupération, la Grande
    // Finale héritait de games appartenant au reset et partait sous un faux
    // titre. Ce tournoi est le second cas réel qui valide la règle.
    const aligned = aligner();

    const reset = aligned.find((a) => a.set.roundName.includes('Reset'));

    expect(reset).toBeDefined();
    expect(reset!.games).toHaveLength(reset!.set.gameCount!);
    expect(reset!.startSeconds).toBeGreaterThan(
      aligned.find((a) => a.set.roundName === 'Grand Final')!.startSeconds,
    );
  });

  it('place le set dépourvu d heure de début', () => {
    // Un des sets n'a que completedAt. Sans repli sur ce champ il se retrouvait
    // en tête de séquence et absorbait les premières games de la VOD.
    const aligned = aligner();
    const sansDebut = aligned.filter((a) => a.set.apiStartUnix == null);

    expect(sansDebut.length).toBeGreaterThan(0);
    expect(sansDebut.every((a) => a.games.length === a.set.gameCount)).toBe(true);
  });

  it('laisse orphelines les games des poules, que Start.gg ne rattache pas', () => {
    const candidats = segment(signal, DEFAULT_SEGMENTER_OPTIONS);
    const assignees = aligner().reduce((n, a) => n + a.games.length, 0);

    // Beaucoup de jeu diffusé hors des sets déclarés : c'est attendu ici.
    expect(candidats.length - assignees).toBeGreaterThan(20);
  });

  it('ne produit aucun clip qui déborde sur le suivant', () => {
    const aligned = aligner().filter((a) => a.games.length > 0);

    for (let i = 1; i < aligned.length; i++) {
      expect(aligned[i].startSeconds).toBeGreaterThanOrEqual(
        aligned[i - 1].games[aligned[i - 1].games.length - 1].endSeconds,
      );
    }
  });
});
