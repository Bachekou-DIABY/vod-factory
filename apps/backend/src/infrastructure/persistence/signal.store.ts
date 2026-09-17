import { Injectable } from '@nestjs/common';
import { FrameSignal } from '../../domain/alignment/alignment.types';

/**
 * Sérialisation du signal HUD pour la base.
 *
 * Le signal est conservé pour pouvoir rejouer la segmentation avec d'autres
 * seuils sans redécoder la VOD : c'est ce qui rend la passe de rattrapage et
 * le réglage des seuils quasi instantanés. Une journée de tournoi de huit
 * heures échantillonnée à 1 Hz tient dans une soixantaine de kilooctets.
 *
 * Format : un octet d'en-tête de version, puis les deux canaux quantifiés
 * concaténés, de même longueur.
 */

const FORMAT_VERSION = 1;
const HEADER_BYTES = 1;

@Injectable()
export class SignalStore {
  encode(signal: FrameSignal): Buffer {
    const length = signal.hud.length;
    const buffer = Buffer.allocUnsafe(HEADER_BYTES + length * 2);
    buffer[0] = FORMAT_VERSION;
    Buffer.from(signal.hud.buffer, signal.hud.byteOffset, length).copy(
      buffer,
      HEADER_BYTES,
    );
    Buffer.from(signal.dark.buffer, signal.dark.byteOffset, signal.dark.length).copy(
      buffer,
      HEADER_BYTES + length,
    );
    return buffer;
  }

  decode(
    stored: Buffer | Uint8Array | null | undefined,
    sampleRate: number | null | undefined,
    startSeconds = 0,
  ): FrameSignal | null {
    if (!stored || stored.length <= HEADER_BYTES) return null;

    const buffer = Buffer.isBuffer(stored) ? stored : Buffer.from(stored);
    if (buffer[0] !== FORMAT_VERSION) return null;

    const payload = buffer.length - HEADER_BYTES;
    if (payload <= 0 || payload % 2 !== 0) return null;

    const length = payload / 2;
    return {
      sampleRate: sampleRate && sampleRate > 0 ? sampleRate : 1,
      startSeconds,
      hud: new Uint8Array(buffer.subarray(HEADER_BYTES, HEADER_BYTES + length)),
      dark: new Uint8Array(buffer.subarray(HEADER_BYTES + length)),
    };
  }
}
