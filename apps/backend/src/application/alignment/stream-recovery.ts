/**
 * Récupération des sets que le TO a oublié de rattacher à la chaîne.
 *
 * On ne retient normalement que les sets marqués on-stream, ce qui est la
 * bonne règle : c'est elle qui écarte les dizaines de sets joués en setup à
 * côté. Mais elle laisse tomber un cas précis et coûteux, le bracket reset.
 *
 * Quand le joueur venu des losers gagne la Grande Finale, Start.gg crée un
 * second set. Ce set naît après coup et hérite rarement du stream : sur
 * L'Oracle, « Grand Final Reset » avait `stream: null` alors que ses quatre
 * games sont bien dans la VOD. Le set le plus important du tournoi est donc
 * précisément celui qui a le plus de chances de manquer, et son absence ne se
 * contente pas de le perdre : l'aligneur, ayant sept games pour un seul set,
 * en attribue trois au hasard à la Grande Finale et produit un clip faux.
 *
 * La reconnaissance est structurelle plutôt que basée sur le libellé du round :
 * deux mêmes adversaires qui rejouent immédiatement après un set diffusé, c'est
 * un reset et rien d'autre. Aucune autre situation de bracket ne reproduit ça.
 */

export interface RecoverableSet {
  /** Identifiants des deux participants. */
  entrantIds: string[];
  /** Le set porte-t-il une chaîne dans Start.gg ? */
  hasStream: boolean;
  startedAt?: number | null;
  completedAt?: number | null;
}

/** Délai maximal entre la fin du set diffusé et le début du reset, en secondes. */
export const DEFAULT_RESET_DELAY_SECONDS = 900;

function memesAdversaires(a: string[], b: string[]): boolean {
  if (a.length !== 2 || b.length !== 2) return false;
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

/**
 * Parmi `tous`, renvoie les sets sans chaîne qui prolongent immédiatement un
 * set de `retenus` entre les deux mêmes joueurs.
 *
 * `lire` extrait la forme utile, pour que la fonction reste testable sans
 * dépendre du schéma Start.gg.
 */
export function recoverBracketResets<T>(
  tous: T[],
  retenus: T[],
  lire: (set: T) => RecoverableSet,
  maxDelaySeconds: number = DEFAULT_RESET_DELAY_SECONDS,
): T[] {
  if (retenus.length === 0) return [];

  const dejaRetenus = new Set(retenus);
  const precedents = retenus.map(lire).filter((s) => s.completedAt != null);
  if (precedents.length === 0) return [];

  return tous.filter((candidat) => {
    if (dejaRetenus.has(candidat)) return false;
    const c = lire(candidat);
    if (c.hasStream) return false;

    // Un reset commence là où le set diffusé s'est terminé. Sans heure de
    // début, on ne peut pas l'affirmer, et on préfère ne pas l'inventer.
    const debut = c.startedAt;
    if (debut == null) return false;

    return precedents.some((p) => {
      const ecart = debut - (p.completedAt as number);
      return (
        ecart >= 0 &&
        ecart <= maxDelaySeconds &&
        memesAdversaires(p.entrantIds, c.entrantIds)
      );
    });
  });
}
