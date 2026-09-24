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
 * ## Aucun rattachement vaut « aucun site »
 *
 * La première version faisait l'inverse : elle proposait **tous** les sites à
 * qui n'en avait aucun, pour que le module serve avant d'être configuré. C'était
 * un mauvais calcul. Un agent d'accueil n'a pas à choisir entre les douze
 * bâtiments de la commune, et proposer une liste où presque tout est faux
 * garantit qu'on s'y trompe.
 *
 * `sitesProposesA()` ne rend donc que les bâtiments rattachés. La contrepartie
 * est assumée : il faut rattacher les comptes avant que le module ne serve, et
 * l'écran d'attribution signale nommément ceux qui n'ont rien — c'est à cette
 * condition que la règle tient.
 *
 * ## Trois droits, indépendants, sur chaque rattachement
 *
 * Une école a plusieurs responsables : la directrice, l'élu, le responsable des
 * écoles. Ils n'ont ni le même périmètre ni les mêmes besoins.
 *
 *   `est_responsable`   signale *pour le bâtiment*, pas seulement pour le
 *                       matériel qui lui est attribué
 *   `peut_voir_tickets` lit les demandes du bâtiment
 *   `notifie`           reçoit un courriel à chaque demande
 *
 * Les faire découler l'un de l'autre obligerait l'élu à choisir entre ne rien
 * voir et tout recevoir.
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
  /** Peut signaler pour le bâtiment, et pas seulement pour son matériel. */
  estResponsable: boolean;
  /** Lit les demandes du bâtiment. */
  peutVoirTickets: boolean;
  /** Reçoit un courriel à chaque demande du bâtiment. */
  notifie: boolean;
  /** Gère le bâtiment : ses salles, ses portes, ses rattachements (migration 040). */
  gereLieu: boolean;
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
    `SELECT s.*, us.*, s.id AS id
       FROM user_sites us
       JOIN cle_sites s ON s.id = us.site_id
      WHERE us.user_id = ?
      ORDER BY s.sort_order ASC, s.name ASC`,
    [userId]
  );
  return lignes.map((l: any) => ({
    ...enSite(l),
    estResponsable: Boolean(l.est_responsable),
    peutVoirTickets: Boolean(l.peut_voir_tickets),
    notifie: Boolean(l.notifie),
    gereLieu: Boolean(Number(l.gere_lieu ?? 0)),
  }));
}

/** Les bâtiments dont cette personne est responsable — ceux pour lesquels elle signale. */
export async function sitesDontResponsable(userId: number | string): Promise<Site[]> {
  const rattaches = await sitesDe(userId);
  return rattaches
    .filter((s) => s.estResponsable)
    .map(({ estResponsable, peutVoirTickets, notifie, gereLieu, ...site }) => site);
}

/**
 * Qui reçoit un courriel pour les demandes de ce bâtiment.
 *
 * C'est la question que pose l'envoi, à chaque demande. La directrice et le
 * responsable des écoles y répondent ; l'élu, qui lit sans vouloir être
 * dérangé, n'y figure pas.
 */
export async function notifiesDuSite(siteId: number | string): Promise<Array<{ id: number; email: string; role: string }>> {
  return db.query(
    `SELECT u.id, u.email, u.role
       FROM user_sites us
       JOIN users u ON u.id = us.user_id
      WHERE us.site_id = ? AND us.notifie = 1
        AND u.is_active = 1 AND u.email IS NOT NULL`,
    [siteId]
  );
}

/**
 * Les bâtiments à proposer à cette personne dans un formulaire.
 *
 * C'est ici que « un utilisateur peut avoir qu'un bâtiment mais aussi
 * plusieurs » se règle. Trois cas, et l'appelant n'a qu'à compter :
 *
 *   0 rattachement → aucun, le champ n'a pas lieu d'être posé
 *   1 rattachement → un seul site, le champ est masqué et la valeur imposée
 *   n rattachements → ses sites, le champ est proposé
 *
 * Un bâtiment devenu inactif reste rendu s'il est explicitement rattaché : le
 * retirer ferait disparaître le site d'une personne qui n'y peut rien, au
 * milieu de sa saisie. C'est à l'administrateur de défaire le rattachement.
 */
export async function sitesProposesA(userId: number | string): Promise<Site[]> {
  const rattaches = await sitesDe(userId);
  return rattaches.map(({ estResponsable, peutVoirTickets, notifie, gereLieu, ...site }) => site);
}

/**
 * Remplace les rattachements d'une personne.
 *
 * Remplacement et non fusion : l'écran montre l'état complet, et c'est cet état
 * qu'il enregistre. Une fusion obligerait l'appelant à dire ce qu'il retire,
 * donc à tenir un journal de différences que personne ne lirait.
 *
 * **Sauf pour `gereLieu`**, qu'un écran plus ancien ne connaît pas : absent, il
 * est repris de la ligne qu'on remplace. Sans cela, enregistrer la fiche d'un
 * compte depuis « Qui a droit à quoi » lui retirait en silence la gestion de
 * son bâtiment.
 */
export async function definirSitesDe(
  userId: number,
  rattachements: Array<{
    siteId: number;
    estResponsable?: boolean;
    peutVoirTickets?: boolean;
    notifie?: boolean;
    gereLieu?: boolean;
  }>,
  auteurId: number | null
): Promise<void> {
  const avant = new Map((await sitesDe(userId)).map((s) => [s.id, s.gereLieu]));

  await db.transaction(async () => {
    await db.execute('DELETE FROM user_sites WHERE user_id = ?', [userId]);
    for (const r of rattachements) {
      const gere = r.gereLieu ?? avant.get(Number(r.siteId)) ?? false;
      await db.execute(
        `INSERT INTO user_sites (user_id, site_id, est_responsable, peut_voir_tickets, notifie, created_by${gere ? ', gere_lieu' : ''})
         VALUES (?, ?, ?, ?, ?, ?${gere ? ', 1' : ''})`,
        [
          userId,
          r.siteId,
          r.estResponsable ? 1 : 0,
          r.peutVoirTickets ? 1 : 0,
          r.notifie ? 1 : 0,
          auteurId,
        ]
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
