/**
 * Ce qu'on accepte d'écrire comme géométrie de plan.
 *
 * Les positions et les polygones du plan annoté partaient en base sans le
 * moindre contrôle : `pos_x` était inséré tel quel, `zone_points` était
 * `JSON.stringify` d'un corps de requête. Une coordonnée hors du plan y reste —
 * le repère devient invisible, et on ne peut plus cliquer dessus pour le
 * rattraper. Un polygone de dix mille points, lui, fige l'affichage à chaque
 * ouverture de la fiche.
 *
 * Les coordonnées sont des **pourcentages** de la largeur et de la hauteur du
 * plan : elles vont de 0 à 100, quelle que soit l'image, et c'est ce qui permet
 * de remplacer un plan sans déplacer ce qui est posé dessus.
 */

export interface PointPlan {
  x: number;
  y: number;
}

/** Un polygone en dessous de trois sommets n'a pas de surface. */
const SOMMETS_MIN = 3;

/**
 * Au-delà, ce n'est plus un massif mais un tracé importé par erreur : le rendu
 * SVG et l'export PDF ralentissent bien avant, et personne ne clique cinq cents
 * fois à la souris.
 */
const SOMMETS_MAX = 500;

/** Message unique, pour que le refus se lise pareil partout. */
export const REFUS_POSITION =
  'La position doit être exprimée en pourcentages du plan, entre 0 et 100';

/** Message unique pour un polygone refusé. */
export const REFUS_ZONE =
  `Une zone demande entre ${SOMMETS_MIN} et ${SOMMETS_MAX} points, en pourcentages du plan`;

/** Un pourcentage lisible et dans les bornes du plan, ou `null`. */
function pourcentValide(brut: unknown): number | null {
  const nombre = Number(brut);
  if (!Number.isFinite(nombre)) return null;
  if (nombre < 0 || nombre > 100) return null;
  return nombre;
}

/** Le couple de coordonnées s'il tient sur le plan, `null` sinon. */
export function positionValide(x: unknown, y: unknown): PointPlan | null {
  const px = pourcentValide(x);
  const py = pourcentValide(y);
  if (px === null || py === null) return null;
  return { x: px, y: py };
}

/**
 * Le résultat de la lecture d'une zone reçue.
 *
 * Trois cas et non deux : un tableau vide veut dire « efface la zone », ce qui
 * est une demande légitime et non une erreur de saisie.
 */
export type LectureZone =
  | { etat: 'absente' }
  | { etat: 'effacee' }
  | { etat: 'valide'; points: PointPlan[] }
  | { etat: 'refusee' };

/** Lit une zone reçue dans un corps de requête. */
export function lireZone(brut: unknown): LectureZone {
  if (brut === undefined) return { etat: 'absente' };
  if (brut === null) return { etat: 'effacee' };
  if (!Array.isArray(brut)) return { etat: 'refusee' };
  if (brut.length === 0) return { etat: 'effacee' };
  if (brut.length < SOMMETS_MIN || brut.length > SOMMETS_MAX) return { etat: 'refusee' };

  const points: PointPlan[] = [];
  for (const brutPoint of brut) {
    if (!brutPoint || typeof brutPoint !== 'object') return { etat: 'refusee' };
    const point = positionValide((brutPoint as any).x, (brutPoint as any).y);
    if (!point) return { etat: 'refusee' };
    points.push(point);
  }
  return { etat: 'valide', points };
}
