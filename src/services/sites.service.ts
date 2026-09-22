import { db } from '../database';

/**
 * Les sites et bâtiments de la commune — la mairie, la salle des fêtes, le
 * centre de loisirs — et qui y est rattaché.
 *
 * ## Pourquoi la table s'appelle `cle_sites`
 *
 * Le référentiel des lieux est né dans le module Clés (migration 024), où il
 * porte les sites et leurs ouvrants. Il contient depuis les bâtiments réels de
 * la commune, avec leur code et leur adresse, alimentés jusque par l'import
 * Snipe-IT — c'est le référentiel de bâtiments, de fait.
 *
 * Le renommer aurait été plus joli et plus risqué : `ALTER TABLE … RENAME`
 * n'est pas rejouable, donc interdit dans une migration de ce dépôt, et la
 * table est lue par `cle.routes.ts`, `snipeIt.service.ts` et la migration 026.
 * Le nom physique reste donc historique ; ce service est la porte partagée, et
 * l'interface dit « Sites et bâtiments ».
 *
 * ## Aucun rattachement vaut « tous les sites »
 *
 * `sitesDe()` rend la liste des bâtiments d'une personne. Quand elle est vide,
 * l'appelant doit comprendre « pas de restriction », et non « aucun site » :
 * sans cette convention, il faudrait rattacher trois cents agents avant que le
 * formulaire ne propose quoi que ce soit, et personne ne le ferait. C'est
 * `sitesProposesA()` qui applique la règle, une fois, pour que le formulaire et
 * les routes ne la réinventent pas chacun de leur côté.
 */

export interface Site {
  id: number;
  nom: string;
  code: string | null;
  adresse: string | null;
  ordre: number;
  actif: boolean;
}

export interface SiteRattache extends Site {
  /** Cette personne lit-elle les demandes partagées de ce bâtiment ? */
  peutVoirTickets: boolean;
}

export interface Ouvrant {
  id: number;
  siteId: number;
  nom: string;
  code: string | null;
  description: string | null;
}

function enSite(ligne: any): Site {
  return {
    id: Number(ligne.id),
    nom: ligne.name,
    code: ligne.code ?? null,
    adresse: ligne.address ?? null,
    ordre: Number(ligne.sort_order ?? 0),
    // `is_active` est arrivée avec la migration 032 : une base migrée à
    // mi-chemin pourrait ne pas l'avoir, et un bâtiment sans colonne est actif.
    actif: ligne.is_active === undefined || ligne.is_active === null ? true : Boolean(ligne.is_active),
  };
}

function enOuvrant(ligne: any): Ouvrant {
  return {
    id: Number(ligne.id),
    siteId: Number(ligne.site_id),
    nom: ligne.name,
    code: ligne.code ?? null,
    description: ligne.description ?? null,
  };
}

/** Tous les sites, les inactifs seulement si on les demande. */
export async function listerSites(inclureInactifs = false): Promise<Site[]> {
  const lignes = await db.query(
    `SELECT * FROM cle_sites
      ${inclureInactifs ? '' : 'WHERE is_active = 1'}
      ORDER BY sort_order ASC, name ASC`
  );
  return lignes.map(enSite);
}

export async function lireSite(id: number | string): Promise<Site | null> {
  const ligne = await db.queryOne('SELECT * FROM cle_sites WHERE id = ?', [id]);
  return ligne ? enSite(ligne) : null;
}

/** Les ouvrants d'un site — ses portes, ses locaux. */
export async function ouvrantsDe(siteId: number | string): Promise<Ouvrant[]> {
  const lignes = await db.query(
    'SELECT * FROM cle_ouvrants WHERE site_id = ? ORDER BY sort_order ASC, name ASC',
    [siteId]
  );
  return lignes.map(enOuvrant);
}

/** Les bâtiments auxquels cette personne est rattachée, avec son droit de lecture. */
export async function sitesDe(userId: number | string): Promise<SiteRattache[]> {
  const lignes = await db.query(
    `SELECT s.*, us.peut_voir_tickets
       FROM user_sites us
       JOIN cle_sites s ON s.id = us.site_id
      WHERE us.user_id = ?
      ORDER BY s.sort_order ASC, s.name ASC`,
    [userId]
  );
  return lignes.map((l: any) => ({ ...enSite(l), peutVoirTickets: Boolean(l.peut_voir_tickets) }));
}

/**
 * Les bâtiments à proposer à cette personne dans un formulaire.
 *
 * C'est ici que « un utilisateur peut avoir que 1 bâtiment mais aussi
 * plusieurs » se règle. Trois cas, et l'appelant n'a qu'à compter :
 *
 *   0 rattachement → tous les sites actifs, il choisit librement
 *   1 rattachement → un seul site, le champ est masqué et la valeur imposée
 *   n rattachements → ses sites, le champ est proposé
 *
 * Un bâtiment devenu inactif reste rendu s'il est explicitement rattaché : le
 * retirer ferait disparaître le site d'une personne qui n'y peut rien, au
 * milieu de sa saisie. C'est à l'administrateur de défaire le rattachement.
 */
export async function sitesProposesA(userId: number | string): Promise<Site[]> {
  const rattaches = await sitesDe(userId);
  if (rattaches.length > 0) return rattaches.map(({ peutVoirTickets, ...site }) => site);
  return listerSites();
}

/**
 * Remplace les rattachements d'une personne.
 *
 * Remplacement et non fusion : l'écran montre l'état complet, et c'est cet état
 * qu'il enregistre. Une fusion obligerait l'appelant à dire ce qu'il retire,
 * donc à tenir un journal de différences que personne ne lirait.
 */
export async function definirSitesDe(
  userId: number,
  rattachements: Array<{ siteId: number; peutVoirTickets?: boolean }>,
  auteurId: number | null
): Promise<void> {
  await db.transaction(async () => {
    await db.execute('DELETE FROM user_sites WHERE user_id = ?', [userId]);
    for (const r of rattachements) {
      await db.execute(
        `INSERT INTO user_sites (user_id, site_id, peut_voir_tickets, created_by)
         VALUES (?, ?, ?, ?)`,
        [userId, r.siteId, r.peutVoirTickets ? 1 : 0, auteurId]
      );
    }
  });
}

/**
 * Ce qui empêche de supprimer un site.
 *
 * Un bâtiment cité par un ticket ne se supprime pas : le ticket perdrait son
 * lieu, donc l'historique qu'on veut justement pouvoir relire. L'écran propose
 * de le désactiver à la place.
 */
export async function usagesSite(siteId: number | string): Promise<{
  tickets: number;
  ouvrants: number;
  rattachements: number;
  cles: number;
}> {
  const compter = async (sql: string): Promise<number> => {
    try {
      const ligne = await db.queryOne(sql, [siteId]);
      return Number(ligne?.cnt ?? 0);
    } catch {
      // Table absente sur une base pas encore migrée : rien à compter.
      return 0;
    }
  };

  return {
    tickets: await compter('SELECT COUNT(*) as cnt FROM tickets WHERE site_id = ?'),
    ouvrants: await compter('SELECT COUNT(*) as cnt FROM cle_ouvrants WHERE site_id = ?'),
    rattachements: await compter('SELECT COUNT(*) as cnt FROM user_sites WHERE site_id = ?'),
    cles: await compter('SELECT COUNT(*) as cnt FROM cle_ouvre WHERE site_id = ?'),
  };
}
