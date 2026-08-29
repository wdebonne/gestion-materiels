import { db } from '../database';

/**
 * Charge en une requête les lignes liées à plusieurs parents, puis les regroupe.
 *
 * Remplace le motif « une requête par parent », qui multiplie les allers-retours
 * en base : sur un espace vert de 50 entretiens, 100 requêtes deviennent 1.
 *
 * `construireSql` reçoit les marqueurs `?` à insérer dans le `IN (...)`. La liste
 * d'identifiants est découpée en tranches pour rester sous la limite de
 * paramètres liés de SQLite.
 */
export async function grouperEnfants<T = any>(
  construireSql: (marqueurs: string) => string,
  ids: Array<number | string>,
  cleParent: string,
  parametres: (tranche: Array<number | string>) => any[] = (tranche) => tranche
): Promise<Map<any, T[]>> {
  const parParent = new Map<any, T[]>();
  const uniques = [...new Set(ids)];
  if (uniques.length === 0) return parParent;

  const TAILLE_TRANCHE = 400;
  for (let i = 0; i < uniques.length; i += TAILLE_TRANCHE) {
    const tranche = uniques.slice(i, i + TAILLE_TRANCHE);
    const marqueurs = tranche.map(() => '?').join(', ');
    const lignes = await db.query<any>(construireSql(marqueurs), parametres(tranche));

    for (const ligne of lignes) {
      const parent = ligne[cleParent];
      const liste = parParent.get(parent);
      if (liste) liste.push(ligne);
      else parParent.set(parent, [ligne]);
    }
  }

  return parParent;
}

/** Lignes rattachées à un parent, liste vide si le parent n'en a aucune. */
export function enfantsDe<T>(parParent: Map<any, T[]>, id: number | string): T[] {
  return parParent.get(id) ?? [];
}
