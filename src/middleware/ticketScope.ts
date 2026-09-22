import { db } from '../database';
import type { AuthRequest } from './auth.middleware';
import { agentsDe } from '../services/plannings.service';
import { filtreObjets } from './objectScope';

/**
 * Qui voit quel ticket.
 *
 * C'est la pièce la plus sensible du module, et la seule qu'on écrit une fois :
 * une demande porte le nom de celui qui l'a faite, ce qui ne va pas chez lui, et
 * parfois de quoi le deviner. La règle est donc rassemblée ici, comme
 * `objectScope.ts` a rassemblé celle du parc après avoir trouvé quatre routes
 * qui la contournaient sans le savoir.
 *
 * ## Six prédicats, réunis par `OR`
 *
 *   1. j'ai fait la demande            `demandeur_id`
 *   2. je l'ai saisie pour quelqu'un   `created_by`
 *   3. elle m'est confiée              `technicien_id`
 *   4. elle est confiée à mon équipe   `service_id`
 *   5. je la suis                      `ticket_watchers`
 *   6. elle concerne mon bâtiment      `site_id` **et** `visibilite_site = 1`
 *
 * Les prédicats 1 et 3 portent sur **le périmètre de personnes** et non sur le
 * seul identifiant : un superviseur voit les demandes des agents qu'il encadre,
 * par le même lien `planning_superviseurs` qui sert déjà aux heures. Le lien
 * « qui encadre qui » sert enfin deux modules, au lieu d'être ressaisi.
 *
 * ## Le rôle ne donne rien, sauf `admin`
 *
 * « Le service informatique gère l'informatique, le service technique n'a pas à
 * voir ces tickets, et inversement » : c'est la demande, et elle interdit qu'un
 * rôle ouvre tout par lui-même. Un superviseur des services techniques n'est
 * donc pas privilégié ici — il voit son équipe et ses agents, pas l'infirmerie
 * ni les demandes de mot de passe de ses collègues.
 *
 * Qui doit tout voir le reçoit explicitement, par
 * `module_permissions('tickets')` ou son équivalent individuel, écrans qui
 * existent déjà. C'est une décision d'administrateur, visible dans un tableau,
 * plutôt qu'un effet de bord d'un rôle attribué pour autre chose.
 *
 * ## Voir n'est pas lire
 *
 * Le prédicat 6 répond à « M. Dupont a déjà signalé le rideau cassé » — il est
 * là pour éviter le doublon, pas pour ouvrir la correspondance d'autrui. Un
 * ticket qu'on ne voit **que** par ce prédicat se lit en **voisinage** : le
 * titre, la catégorie, le statut, la date et le demandeur, et rien d'autre. Ni
 * le fil, ni les pièces jointes, ni les notes internes. `accesTicket()` tranche,
 * et la liste rend `acces_complet` pour que l'écran grise ces lignes au lieu de
 * promettre une fiche qu'il refusera.
 */

export interface ContexteTickets {
  moi: number;
  role: string;
  /** Aucune restriction : administrateur, ou droit de module accordé. */
  voitTout: boolean;
  /** Moi, plus les agents que j'encadre. Contient toujours au moins `moi`. */
  personnes: number[];
  /** Les services dont je suis membre. */
  services: number[];
  /** Les bâtiments dont on m'a accordé la lecture des demandes. */
  sitesPartages: number[];
}

export type PorteeTickets =
  | { type: 'tout' }
  | { type: 'limitee'; sql: string; params: any[] };

/** Ce qu'un compte peut faire d'un ticket donné. */
export type AccesTicket = 'aucun' | 'voisinage' | 'complet';

/** Message unique, pour que le refus se lise pareil partout. */
export const REFUS_PORTEE_TICKET = "Cette demande ne fait pas partie de celles qui vous sont accessibles";

/**
 * Le droit de tout voir, accordé à un rôle ou à une personne.
 *
 * Lu comme `tracking.routes.ts` le fait pour son propre module : le réglage
 * individuel l'emporte sur celui du rôle, et l'absence des deux vaut « non ».
 * Le défaut est fermé, à l'inverse de `GET /api/plugins/menu` qui autorise
 * faute de réglage : ici, autoriser par défaut ouvrirait toutes les demandes de
 * la commune à tout le monde le jour de l'installation.
 */
async function voitToutLesTickets(userId: number, role: string): Promise<boolean> {
  if (role === 'admin') return true;

  const individuel = await db.queryOne(
    `SELECT can_view FROM user_module_permissions WHERE user_id = ? AND module_name = 'tickets'`,
    [userId]
  );
  if (individuel) return Boolean(individuel.can_view);

  const duRole = await db.queryOne(
    `SELECT can_view FROM module_permissions WHERE module_name = 'tickets' AND role = ?`,
    [role]
  );
  return Boolean(duRole?.can_view);
}

/** Les services dont cette personne est membre. */
export async function servicesDe(userId: number): Promise<number[]> {
  const lignes = await db.query('SELECT service_id FROM service_members WHERE user_id = ?', [userId]);
  return lignes.map((l: any) => Number(l.service_id));
}

/** Les bâtiments dont cette personne peut lire les demandes. */
export async function sitesPartagesDe(userId: number): Promise<number[]> {
  const lignes = await db.query(
    'SELECT site_id FROM user_sites WHERE user_id = ? AND peut_voir_tickets = 1',
    [userId]
  );
  return lignes.map((l: any) => Number(l.site_id));
}

/** Tout ce qu'il faut savoir du demandeur pour décider de ce qu'il voit. */
export async function contexteTickets(req: AuthRequest): Promise<ContexteTickets> {
  const moi = Number(req.user!.userId);
  const role = String(req.user!.role);

  const [voitTout, encadres, services, sitesPartages] = await Promise.all([
    voitToutLesTickets(moi, role),
    agentsDe(moi),
    servicesDe(moi),
    sitesPartagesDe(moi),
  ]);

  // `Set` : quelqu'un peut être rattaché à lui-même par accident de données, et
  // un identifiant répété fausserait un `IN` sans le dire. Même précaution que
  // `perimetreDe()`.
  return {
    moi,
    role,
    voitTout,
    personnes: [...new Set([moi, ...encadres])],
    services,
    sitesPartages,
  };
}

/**
 * Le fragment de portée, alias `t` par défaut.
 *
 * `avecVoisinage = false` rend la même règle **privée du prédicat 6**. C'est ce
 * qui distingue « je vois ce ticket » de « je peux le lire » : la liste
 * interroge les deux d'un coup pour poser `acces_complet`, et `accesTicket()`
 * s'en sert pour refuser le fil d'un ticket qu'on ne voit que par le bâtiment.
 *
 * Le fragment n'est jamais vide : `personnes` contient toujours au moins
 * l'identifiant du demandeur, si bien qu'aucun `IN ()` — erreur de syntaxe sur
 * les deux moteurs — ne peut être produit. Les listes vides sont simplement
 * omises de l'alternative.
 */
export function fragmentPortee(
  ctx: ContexteTickets,
  alias = 't',
  avecVoisinage = true
): PorteeTickets {
  if (ctx.voitTout) return { type: 'tout' };

  const p = alias ? `${alias}.` : '';
  const conditions: string[] = [];
  const params: any[] = [];

  const marqueurs = (n: number) => Array(n).fill('?').join(',');

  conditions.push(`${p}demandeur_id IN (${marqueurs(ctx.personnes.length)})`);
  params.push(...ctx.personnes);

  conditions.push(`${p}created_by = ?`);
  params.push(ctx.moi);

  conditions.push(`${p}technicien_id IN (${marqueurs(ctx.personnes.length)})`);
  params.push(...ctx.personnes);

  if (ctx.services.length > 0) {
    conditions.push(`${p}service_id IN (${marqueurs(ctx.services.length)})`);
    params.push(...ctx.services);
  }

  // Observateur, nommément ou par son service.
  if (ctx.services.length > 0) {
    conditions.push(
      `EXISTS (SELECT 1 FROM ticket_watchers w WHERE w.ticket_id = ${p}id AND (w.user_id = ? OR w.service_id IN (${marqueurs(ctx.services.length)})))`
    );
    params.push(ctx.moi, ...ctx.services);
  } else {
    conditions.push(
      `EXISTS (SELECT 1 FROM ticket_watchers w WHERE w.ticket_id = ${p}id AND w.user_id = ?)`
    );
    params.push(ctx.moi);
  }

  if (avecVoisinage && ctx.sitesPartages.length > 0) {
    conditions.push(
      `(${p}site_id IN (${marqueurs(ctx.sitesPartages.length)}) AND ${p}visibilite_site = 1)`
    );
    params.push(...ctx.sitesPartages);
  }

  return { type: 'limitee', sql: `(${conditions.join(' OR ')})`, params };
}

/** Le fragment prêt à concaténer derrière un `WHERE`, et ses paramètres. */
export async function porteeTickets(
  req: AuthRequest,
  alias = 't',
  avecVoisinage = true
): Promise<{ sql: string; params: any[] }> {
  const ctx = await contexteTickets(req);
  const portee = fragmentPortee(ctx, alias, avecVoisinage);
  if (portee.type === 'tout') return { sql: '', params: [] };
  return { sql: ` AND ${portee.sql}`, params: portee.params };
}

/**
 * Ce que l'auteur de la requête peut faire de ce ticket précis.
 *
 * Deux lectures par clé primaire, donc deux index uniques : c'est moins cher
 * qu'il n'y paraît, et bien plus sûr que de recalculer la règle à la main dans
 * chaque route.
 */
export async function accesTicket(req: AuthRequest, ticketId: number | string): Promise<AccesTicket> {
  const ctx = await contexteTickets(req);
  if (ctx.voitTout) return 'complet';

  const complet = fragmentPortee(ctx, 't', false);
  if (complet.type === 'limitee') {
    const ligne = await db.queryOne(`SELECT t.id FROM tickets t WHERE t.id = ? AND ${complet.sql}`, [
      ticketId,
      ...complet.params,
    ]);
    if (ligne) return 'complet';
  }

  const avecSite = fragmentPortee(ctx, 't', true);
  if (avecSite.type === 'limitee') {
    const ligne = await db.queryOne(`SELECT t.id FROM tickets t WHERE t.id = ? AND ${avecSite.sql}`, [
      ticketId,
      ...avecSite.params,
    ]);
    if (ligne) return 'voisinage';
  }

  return 'aucun';
}

/**
 * Parmi ces matériels, ceux que l'auteur de la requête a le droit de nommer.
 *
 * `filtreObjetsLies()` d'`objectScope` ne convient **pas** ici, et c'est un
 * piège qui mérite d'être écrit. Sa branche « aucune catégorie accessible »
 * rend `AND object_id IS NULL`, ce qui écarte la **ligne entière** — donc ferait
 * disparaître de sa propre liste le ticket que l'utilisateur vient d'ouvrir sur
 * un matériel qu'il n'a pas le droit de consulter. Ce serait remplacer une fuite
 * par une disparition.
 *
 * On garde donc la ligne et on **vide les colonnes** : le ticket reste visible,
 * son matériel s'affiche « hors de votre périmètre ». Une requête par page de
 * liste, pas une par ticket.
 */
export async function materielsVisibles(
  req: AuthRequest,
  ids: Array<number | null | undefined>
): Promise<Set<number>> {
  const distincts = [...new Set(ids.filter((id): id is number => Number.isFinite(Number(id))).map(Number))];
  if (distincts.length === 0) return new Set();

  const filtre = await filtreObjets(req, 'o');
  if (filtre === null) return new Set();

  const marqueurs = distincts.map(() => '?').join(',');
  const lignes = await db.query(
    `SELECT o.id FROM objects o WHERE o.id IN (${marqueurs})${filtre.sql}`,
    [...distincts, ...filtre.params]
  );
  return new Set(lignes.map((l: any) => Number(l.id)));
}

/** Ce qu'on affiche à la place d'un matériel qu'on n'a pas le droit de nommer. */
export const MATERIEL_HORS_PORTEE = 'Matériel hors de votre périmètre';
