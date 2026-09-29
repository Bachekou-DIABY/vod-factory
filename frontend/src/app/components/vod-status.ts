/**
 * Libellé et style d'un statut de VOD, communs à toutes les pages.
 *
 * Trois familles seulement, comme dans la maquette : en cours (cyan au
 * contour), terminé (plein), échec (rouge). Les autres statuts restent neutres.
 */
export interface StatutAffiche {
  label: string;
  classes: string;
}

const STATUTS: Record<string, StatutAffiche> = {
  PENDING: { label: 'En attente', classes: 'border border-gray-700 text-gray-300' },
  DOWNLOADING: { label: 'Téléchargement', classes: 'border border-accent-deep text-accent' },
  DOWNLOADED: { label: 'Téléchargée', classes: 'border border-gray-700 text-gray-100' },
  ANALYZING: { label: 'Analyse', classes: 'border border-accent-deep text-accent' },
  ANALYZED: { label: 'Analysée', classes: 'bg-accent text-accent-ink' },
  PROCESSING: { label: 'Traitement', classes: 'border border-accent-deep text-accent' },
  PROCESSED: { label: 'Analysée', classes: 'bg-accent text-accent-ink' },
  COMPLETED: { label: 'Clips prêts', classes: 'bg-accent text-accent-ink' },
  FAILED: { label: 'Échec', classes: 'border border-alert-line text-alert-text' },
};

export function statutVod(status: string): StatutAffiche {
  return STATUTS[status] ?? { label: status, classes: 'border border-gray-700 text-gray-300' };
}

const STATUTS_CLIP: Record<string, StatutAffiche> = {
  PENDING: { label: 'À relire', classes: 'text-gray-300' },
  APPROVED: { label: 'Approuvé', classes: 'text-accent' },
  UPLOADING: { label: 'Envoi…', classes: 'text-accent' },
  UPLOADED: { label: 'En ligne', classes: 'text-accent' },
  FAILED: { label: 'Échec', classes: 'text-alert-text' },
};

export function statutClip(status: string): StatutAffiche {
  return STATUTS_CLIP[status] ?? { label: status, classes: 'text-gray-300' };
}
