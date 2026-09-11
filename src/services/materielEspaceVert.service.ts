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
 * Quel matériel du parc peut être implanté dans un espace vert.
 *
 * Le catalogue d'implantation proposait tout le parc, moins les prestations. Un
 * jardinier qui vient poser trente rosiers y voyait donc les barrières Vauban
 * des manifestations, les radars pédagogiques de la police municipale et les
 * chaises de la salle des fêtes. Sur un parc communal de plusieurs centaines de
 * lignes, chercher « gazon » dans cette liste est un travail en soi, et le
 * matériel finit posé au hasard ou pas posé du tout.
 *
 * Même règle que pour le prêt : **trois niveaux, le plus précis l'emporte**. La
 * catégorie Espaces verts s'ouvre d'un bloc, la sous-catégorie Outillage s'en
 * retire, une tondeuse fait exception. `NULL` veut dire « suivre le niveau au-
 * dessus ».
 *
 * Ce réglage **s'ajoute** à la portée par catégorie du compte
 * (`objectScope.ts`) et ne la remplace pas : le réglage dit ce que le module
 * propose, la portée dit ce que ce compte-là a le droit de voir.
 */

/** La colonne qui porte le réglage pour ce module. */
const COLONNE = 'available_for_green_spaces' as const;

/** Fragment SQL rendant l'implantabilité effective d'un matériel. */
export function expressionImplantable(
  aliasObjet = 'o',
  aliasSousCategorie = 'psc',
  aliasCategorie = 'pc'
): string {
  return expressionGenerique(COLONNE, aliasObjet, aliasSousCategorie, aliasCategorie);
}

/**
 * Jointures nécessaires à `expressionImplantable`.
 *
 * Identiques à celles du prêt : le catalogue d'implantation les pose déjà pour
 * connaître la nature du matériel, et il ne faut surtout pas les redéclarer sous
 * les mêmes alias — SQL refuserait la requête.
 */
export const jointuresImplantable = jointuresGeneriques;

/** Ce matériel peut-il être implanté dans un espace vert ? */
export const estImplantable = (objectId: number | string): Promise<boolean> =>
  estDisponible(COLONNE, objectId);

/** Arbre des catégories et sous-catégories, avec leur réglage et leurs effectifs. */
export const arbreImplantable = (): Promise<any[]> => arbreGenerique(COLONNE);

/** Matériels d'une catégorie, avec leur réglage propre et le résultat effectif. */
export const objetsDeLaCategorie = (
  req: AuthRequest,
  categoryId: number | string
): Promise<any[] | null> => objetsGeneriques(COLONNE, 'implantable', req, categoryId);

/** Matériels dont le nom, la référence ou le numéro de série contient le terme. */
export const rechercherObjetsImplantables = (
  req: AuthRequest,
  recherche: string
): Promise<any[] | null> => rechercherObjets(COLONNE, 'implantable', req, recherche);

/** Message unique, pour que le refus se lise pareil partout. */
export const REFUS_IMPLANTATION =
  "Ce matériel n'est pas ouvert à l'implantation dans les espaces verts";
