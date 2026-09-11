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
 * Quel matériel du parc peut être posé sur la voie publique.
 *
 * Le catalogue de pose proposerait sinon tout le parc. Un agent venu poser un
 * candélabre au coin de la rue y trouverait les barrières Vauban des
 * manifestations, les radars pédagogiques de la police municipale, les chaises
 * de la salle des fêtes et les prestations de raccordement électrique. Sur un
 * parc communal de plusieurs centaines de lignes, chercher « corbeille » dans
 * cette liste est un travail en soi — et le relevé de terrain, qui doit tenir
 * en trois gestes sur un téléphone, n'y survit pas.
 *
 * Même règle que pour le prêt et pour l'implantation en espace vert : **trois
 * niveaux, le plus précis l'emporte**. La catégorie Mobilier urbain s'ouvre
 * d'un bloc, la sous-catégorie Signalisation temporaire s'en retire, un modèle
 * fait exception. `NULL` veut dire « suivre le niveau au-dessus ».
 *
 * Ce réglage **s'ajoute** à la portée par catégorie du compte
 * (`objectScope.ts`) et ne la remplace pas : le réglage dit ce que le module
 * propose, la portée dit ce que ce compte-là a le droit de voir.
 */

/** La colonne qui porte le réglage pour ce module. */
const COLONNE = 'available_for_public_space' as const;

/** Fragment SQL rendant la « posabilité » effective d'un matériel. */
export function expressionPosable(
  aliasObjet = 'o',
  aliasSousCategorie = 'psc',
  aliasCategorie = 'pc'
): string {
  return expressionGenerique(COLONNE, aliasObjet, aliasSousCategorie, aliasCategorie);
}

/**
 * Jointures nécessaires à `expressionPosable`.
 *
 * Identiques à celles du prêt et de l'implantation : une requête qui les pose
 * déjà pour connaître la nature du matériel ne doit surtout pas les redéclarer
 * sous les mêmes alias — SQL refuserait la requête.
 */
export const jointuresPosable = jointuresGeneriques;

/** Ce matériel peut-il être posé sur la voie publique ? */
export const estPosable = (objectId: number | string): Promise<boolean> =>
  estDisponible(COLONNE, objectId);

/** Arbre des catégories et sous-catégories, avec leur réglage et leurs effectifs. */
export const arbrePosable = (): Promise<any[]> => arbreGenerique(COLONNE);

/** Matériels d'une catégorie, avec leur réglage propre et le résultat effectif. */
export const objetsDeLaCategorie = (
  req: AuthRequest,
  categoryId: number | string
): Promise<any[] | null> => objetsGeneriques(COLONNE, 'posable', req, categoryId);

/** Matériels dont le nom, la référence ou le numéro de série contient le terme. */
export const rechercherObjetsPosables = (
  req: AuthRequest,
  recherche: string
): Promise<any[] | null> => rechercherObjets(COLONNE, 'posable', req, recherche);

/** Message unique, pour que le refus se lise pareil partout. */
export const REFUS_POSE =
  "Ce matériel n'est pas ouvert à la pose sur la voie publique";
