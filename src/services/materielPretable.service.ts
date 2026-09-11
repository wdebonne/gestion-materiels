import {
  arbreDisponibilite as arbreGenerique,
  estDisponible,
  expressionDisponibilite as expressionGenerique,
  jointuresDisponibilite as jointuresGeneriques,
  objetsDeLaCategorie as objetsGeneriques,
  rechercherObjets,
} from './disponibiliteParc.service';
import type { AuthRequest } from '../middleware/auth.middleware';

/**
 * Quel matériel du parc peut être prêté pour une manifestation.
 *
 * Le sélecteur proposait tout le parc. Or une catégorie ne se prête pas d'un
 * bloc : un réfrigérateur de la catégorie Électroménager part volontiers pour
 * une brocante, le grill de la même catégorie non.
 *
 * Trois niveaux, **le plus précis l'emporte** : la catégorie donne le ton, la
 * sous-catégorie l'affine, le matériel fait exception. `NULL` veut dire « suivre
 * le niveau au-dessus » — trois états et non deux, sans quoi ouvrir une
 * catégorie obligerait à recocher chacun de ses matériels.
 *
 * La règle elle-même vit désormais dans `disponibiliteParc.service.ts` : les
 * espaces verts se sont posé exactement la même question — on y plante du gazon,
 * pas les prestations de la police municipale — et deux copies auraient fini par
 * répondre différemment. Ce fichier ne dit plus que **de quelle colonne** il
 * s'agit.
 */

/** La colonne qui porte le réglage pour ce module. */
const COLONNE = 'available_for_manifestations' as const;

export type { Disponibilite } from './disponibiliteParc.service';
export { lireDisponibilite, versColonne } from './disponibiliteParc.service';

/** Fragment SQL rendant la disponibilité effective d'un matériel. */
export function expressionDisponibilite(
  aliasObjet = 'o',
  aliasSousCategorie = 'psc',
  aliasCategorie = 'pc'
): string {
  return expressionGenerique(COLONNE, aliasObjet, aliasSousCategorie, aliasCategorie);
}

/** Jointures nécessaires à `expressionDisponibilite`. */
export const jointuresDisponibilite = jointuresGeneriques;

/** Ce matériel peut-il être prêté ? */
export const estPretable = (objectId: number | string): Promise<boolean> =>
  estDisponible(COLONNE, objectId);

/** Arbre des catégories et sous-catégories, avec leur réglage et leurs effectifs. */
export const arbreDisponibilite = (): Promise<any[]> => arbreGenerique(COLONNE);

/** Matériels d'une catégorie, avec leur réglage propre et le résultat effectif. */
export const objetsDeLaCategorie = (
  req: AuthRequest,
  categoryId: number | string
): Promise<any[] | null> => objetsGeneriques(COLONNE, 'pretable', req, categoryId);

/** Matériels dont le nom, la référence ou le numéro de série contient le terme. */
export const rechercherObjetsPretables = (
  req: AuthRequest,
  recherche: string
): Promise<any[] | null> => rechercherObjets(COLONNE, 'pretable', req, recherche);
