import { Controller, Get } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * État de la machine, pour l'en-tête de l'interface.
 *
 * Le disque est la ressource qui a manqué en pratique : une VOD de dix heures
 * pèse 17 Go, et son remux en demande autant pendant qu'il tourne. L'afficher
 * en permanence évite de le découvrir au milieu d'un téléchargement.
 */
@Controller('system')
export class SystemController {
  @Get('storage')
  async storage() {
    const dossier = path.join(process.cwd(), 'storage');
    const cible = fs.existsSync(dossier) ? dossier : process.cwd();
    const stats = await fs.promises.statfs(cible);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    return { totalBytes, freeBytes, usedBytes: totalBytes - freeBytes };
  }
}
