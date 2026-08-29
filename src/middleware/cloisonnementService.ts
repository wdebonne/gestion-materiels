import type { Request, Response } from 'express';

/**
 * Cloisonnement du rôle « service » au seul module Manifestations.
 *
 * Le service communication suit les manifestations, le service informatique
 * approuve le prêt d'un vidéoprojecteur. Ni l'un ni l'autre n'a à voir le parc,
 * les entretiens, les pleins de carburant ou les espaces verts : ce serait un
 * volume d'information sans usage pour eux, et une exposition sans raison pour
 * la collectivité.
 *
 * La règle est appliquée **une seule fois**, au point exact où le rôle devient
 * connu : la fin de `authenticateToken`. C'est le seul endroit qui convienne —
 * l'authentification est posée route par route dans ce projet, donc un
 * middleware global monté avant les routes verrait toujours `req.user`
 * indéfini et laisserait tout passer.
 *
 * Elle est **fermée par défaut** : tout `/api/*` est refusé au rôle `service`
 * sauf ce que la liste ci-dessous ouvre explicitement. Une route ajoutée demain
 * sera donc inaccessible tant que quelqu'un n'aura pas décidé du contraire —
 * c'est l'inverse d'une liste noire, qu'on oublie de compléter.
 */

/**
 * Chemins ouverts au rôle « service », comparés par préfixe sur le chemin
 * complet de la requête (`req.originalUrl`).
 *
 * `/api/manifestations` couvre le module. `/api/auth` porte la connexion, le
 * rafraîchissement de jeton et le profil : sans lui, le compte ne pourrait même
 * pas se connecter. Les réglages et les catégories sont ouverts en **lecture
 * seule** (voir `METHODES_LECTURE`) : l'interface a besoin du nom du site, de son
 * logo et du libellé des catégories pour s'afficher.
 */
const CHEMINS_AUTORISES: ReadonlyArray<{ prefixe: string; lectureSeule?: boolean }> = [
  { prefixe: '/api/manifestations' },
  { prefixe: '/api/auth' },
  { prefixe: '/api/settings', lectureSeule: true },
  { prefixe: '/api/categories', lectureSeule: true },
  { prefixe: '/api/subcategories', lectureSeule: true },
  // La pastille d'alertes et la recherche globale sont dans la mise en page
  // commune : les refuser afficherait une erreur à chaque chargement de page.
  { prefixe: '/api/alerts', lectureSeule: true },
  // Un compte cloisonné doit pouvoir lire son propre service et nommer les
  // autres dans le fil d'échange. La composition détaillée reste gardée par
  // `requireAdmin` sur la route elle-même.
  { prefixe: '/api/services', lectureSeule: true },
];

const METHODES_LECTURE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Chemins de réception : ouverts à tous, y compris sans compte.
 *
 * Ils sont montés avant ce middleware et ne devraient pas l'atteindre, mais une
 * réorganisation du montage ne doit pas transformer silencieusement un dépôt
 * signé en 403.
 */
const CHEMINS_PUBLICS = ['/api/manifestations/intake/'];

/**
 * Ce chemin est-il ouvert au rôle « service » pour cette méthode ?
 *
 * `chemin` doit être le chemin **complet** (`/api/objects/5`). Attention à ne pas
 * lui passer `req.path` : dans un routeur monté, Express le rend relatif au
 * point de montage — `/5` et non `/api/objects/5` — et la liste ne
 * reconnaîtrait plus rien, donc refuserait tout, y compris les manifestations.
 * C'est `req.originalUrl`, privé de sa chaîne de requête, qu'il faut fournir.
 */
export function cheminAutorise(chemin: string, methode: string): boolean {
  const sansRequete = chemin.split('?')[0];

  if (CHEMINS_PUBLICS.some((p) => sansRequete.startsWith(p))) return true;

  const regle = CHEMINS_AUTORISES.find(
    (r) => sansRequete === r.prefixe || sansRequete.startsWith(`${r.prefixe}/`)
  );
  if (!regle) return false;

  return regle.lectureSeule ? METHODES_LECTURE.has(methode.toUpperCase()) : true;
}

export const REFUS_CLOISONNEMENT =
  'Votre compte est limité au suivi des manifestations qui vous concernent';

/**
 * Refuse la requête si le compte est cloisonné et le chemin hors périmètre.
 *
 * Rend `true` quand elle a répondu — l'appelant doit alors s'arrêter. Appelée
 * depuis `authenticateToken`, juste après que le rôle est connu.
 */
export function refuserSiCloisonne(req: Request, res: Response, role: string): boolean {
  if (role !== 'service') return false;
  if (cheminAutorise(req.originalUrl, req.method)) return false;

  res.status(403).json({ success: false, message: REFUS_CLOISONNEMENT });
  return true;
}
