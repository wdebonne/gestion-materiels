import { db } from '../database';
import { estNiveauTicket, NIVEAUX_TICKET, type NiveauTicket } from '../middleware/ticketScope';
import { definirSitesDe, sitesDe } from './sites.service';
import { SaisieInvalide, versDateTime } from './tickets.service';
import {
  estMaterielMode,
  estSiteMode,
  reglagesFormulaireDe,
  type MaterielMode,
  type SiteMode,
} from './ticketsReferentiel.service';

/**
 * Tout ce qu'une personne a le droit de voir et de faire, lu et écrit d'un bloc.
 *
 * « Une gestion fine des droits et des rôles au même endroit : les
 * utilisateurs, dans les paramètres, avec une recherche, et une fenêtre qui
 * montre les informations dans un onglet et tous les droits dans un autre. »
 * Jusqu'ici, régler un agent demandait de passer par quatre écrans — les
 * utilisateurs, les permissions des modules, l'organisation, les rattachements
 * des demandes — sans jamais voir le résultat d'ensemble.
 *
 * Ce service n'invente pas de nouveau droit : il rassemble ceux qui existent,
 * et les écrit dans **une seule transaction**. Un enregistrement refusé ne
 * laisse pas une personne à moitié réglée — ses modules changés, ses catégories
 * non.
 *
 *   - les **modules** visibles : `user_plugin_permissions`, surcharge
 *     individuelle du réglage du rôle (même préséance que `GET /plugins/menu`) ;
 *   - les **catégories de demandes**, avec le niveau et l'autonomie
 *     (`user_ticket_categories`, migrations 045 et 046) ;
 *   - les **bâtiments** et leurs quatre drapeaux (`user_sites`) ;
 *   - le **matériel attribué** (`user_materiels`) ;
 *   - les **champs du formulaire** de demande (`user_ticket_reglages`, 047).
 *
 * Le rôle et l'identité restent au formulaire des informations, qui porte déjà
 * leurs gardes — le dernier administrateur, son propre rôle.
 */

// ------------------------------------------------------------- les modules

export interface ModuleVisible {
  pluginId: number;
  slug: string;
  nom: string;
  /** Ce que le rôle donne, faute de réglage individuel. */
  parRole: boolean;
  /** La surcharge individuelle ; `null` : le rôle décide. */
  individuel: boolean | null;
  effectif: boolean;
}

export async function modulesDe(userId: number, role: string): Promise<ModuleVisible[]> {
  const [plugins, duRole, individuels] = await Promise.all([
    db.query(`SELECT id, name, slug FROM plugins WHERE is_active = 1 AND plugin_type = 'menu' ORDER BY name`),
    db.query('SELECT plugin_id, can_access FROM plugin_permissions WHERE role = ?', [role]),
    db.query('SELECT plugin_id, can_access FROM user_plugin_permissions WHERE user_id = ?', [userId]),
  ]);
  const roleMap = new Map<number, boolean>(duRole.map((l: any) => [Number(l.plugin_id), Boolean(l.can_access)]));
  const persoMap = new Map<number, boolean>(
    individuels.map((l: any) => [Number(l.plugin_id), Boolean(l.can_access)])
  );

  return plugins.map((p: any) => {
    const id = Number(p.id);
    // L'administrateur voit tout, quoi qu'on règle : le menu l'ignore aussi.
    const parRole = role === 'admin' ? true : roleMap.get(id) ?? true;
    const individuel = persoMap.has(id) ? persoMap.get(id)! : null;
    return {
      pluginId: id,
      slug: p.slug,
      nom: p.name,
      parRole,
      individuel,
      effectif: role === 'admin' ? true : individuel ?? parRole,
    };
  });
}

async function definirModulesDe(
  userId: number,
  modules: Array<{ pluginId: number; acces: boolean | null }>
): Promise<void> {
  const connus = new Set((await db.query('SELECT id FROM plugins')).map((l: any) => Number(l.id)));
  const maintenant = versDateTime();

  for (const m of modules) {
    const pluginId = Number(m.pluginId);
    if (!connus.has(pluginId)) throw new SaisieInvalide(`Module inconnu : n° ${m.pluginId}`);

    // Remplacement plutôt que mise à jour : portable sur les deux moteurs, et
    // « selon le rôle » se dit par l'absence de ligne.
    await db.execute('DELETE FROM user_plugin_permissions WHERE user_id = ? AND plugin_id = ?', [userId, pluginId]);
    if (m.acces === true || m.acces === false) {
      await db.execute(
        `INSERT INTO user_plugin_permissions (user_id, plugin_id, can_access, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, pluginId, m.acces ? 1 : 0, maintenant, maintenant]
      );
    }
  }
}

// ------------------------------------------------ les catégories de demandes

export interface LigneCategorieSaisie {
  categorieId: number;
  niveau?: string | null;
  peutCloturer?: boolean | null;
  materielAutorise?: boolean | null;
}

/**
 * Remplace les catégories de demandes d'une personne.
 *
 * Le niveau porte sur la racine : une sous-catégorie transmise y est ramenée,
 * et deux lignes sur la même racine n'en font qu'une — la plus haute. Sans
 * cela, la contrainte `UNIQUE` refuserait l'enregistrement entier pour un
 * doublon que l'écran n'a pas vu. Une catégorie inconnue est refusée : la
 * sauter en silence enregistrerait autre chose que ce qu'on a vu à l'écran.
 */
export async function definirCategoriesDe(
  userId: number,
  lignes: LigneCategorieSaisie[],
  auteurId: number | null
): Promise<void> {
  const parents = new Map<number, number | null>(
    (await db.query('SELECT id, parent_id FROM ticket_categories')).map((l: any) => [
      Number(l.id),
      l.parent_id === null ? null : Number(l.parent_id),
    ])
  );

  const parRacine = new Map<number, { niveau: NiveauTicket; peutCloturer: number; materielAutorise: number | null }>();
  for (const c of lignes) {
    const categorieId = Number(c?.categorieId);
    if (!parents.has(categorieId)) throw new SaisieInvalide(`Catégorie de demande inconnue : n° ${c?.categorieId}`);
    const racine = parents.get(categorieId) ?? categorieId;
    const niveau: NiveauTicket = estNiveauTicket(c?.niveau) ? c.niveau : 'demandeur';
    const deja = parRacine.get(racine);
    if (deja && NIVEAUX_TICKET.indexOf(deja.niveau) >= NIVEAUX_TICKET.indexOf(niveau)) continue;
    parRacine.set(racine, {
      niveau,
      // Autonome par défaut : c'est ce que tout le monde était avant la 046.
      peutCloturer: c?.peutCloturer === false ? 0 : 1,
      // `null` veut dire « ce que la catégorie a décidé ».
      materielAutorise:
        c?.materielAutorise === null || c?.materielAutorise === undefined ? null : c.materielAutorise ? 1 : 0,
    });
  }

  await db.execute('DELETE FROM user_ticket_categories WHERE user_id = ?', [userId]);
  for (const [racine, { niveau, peutCloturer, materielAutorise }] of parRacine) {
    await db.execute(
      `INSERT INTO user_ticket_categories
         (user_id, ticket_categorie_id, niveau, peut_cloturer, materiel_autorise, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, racine, niveau, peutCloturer, materielAutorise, auteurId, versDateTime()]
    );
  }
}

/** Remplace le matériel attribué : l'écran montre l'état complet, et c'est lui qu'il enregistre. */
export async function definirMaterielsDe(userId: number, objectIds: number[], auteurId: number | null): Promise<void> {
  await db.execute('DELETE FROM user_materiels WHERE user_id = ?', [userId]);
  for (const objectId of new Set(objectIds.filter((id) => Number.isFinite(id)))) {
    await db.execute(
      'INSERT INTO user_materiels (user_id, object_id, created_by, created_at) VALUES (?, ?, ?, ?)',
      [userId, objectId, auteurId, versDateTime()]
    );
  }
}

async function definirReglagesFormulaire(
  userId: number,
  reglages: { siteMode?: string | null; materielMode?: string | null },
  auteurId: number | null
): Promise<void> {
  const siteMode: SiteMode | null = estSiteMode(reglages.siteMode) ? reglages.siteMode : null;
  const materielMode: MaterielMode | null = estMaterielMode(reglages.materielMode) ? reglages.materielMode : null;
  if (reglages.siteMode && !siteMode) throw new SaisieInvalide('Réglage du bâtiment inconnu');
  if (reglages.materielMode && !materielMode) throw new SaisieInvalide('Réglage du matériel inconnu');

  await db.execute('DELETE FROM user_ticket_reglages WHERE user_id = ?', [userId]);
  // Rien de réglé : pas de ligne, la catégorie décide.
  if (siteMode || materielMode) {
    await db.execute(
      `INSERT INTO user_ticket_reglages (user_id, site_mode, materiel_mode, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, siteMode, materielMode, auteurId, versDateTime()]
    );
  }
}

// ------------------------------------------------------------ la lecture

export interface CategorieDroits {
  categorieId: number;
  nom: string;
  couleur: string | null;
  /** `null` : cette catégorie ne lui est pas attribuée. */
  niveau: NiveauTicket | null;
  peutCloturer: boolean;
  materielAutorise: boolean | null;
  /** La catégorie propose-t-elle du matériel ? Sinon l'exception n'a pas de sens. */
  proposeMateriel: boolean;
  /** Quelqu'un supervise-t-il la catégorie ? */
  aUnSuperviseur: boolean;
}

export async function lireDroits(userId: number) {
  const personne = await db.queryOne(
    'SELECT id, first_name, last_name, email, role FROM users WHERE id = ?',
    [userId]
  );
  if (!personne) return null;

  const [modules, racines, lignes, superviseurs, sites, materiels, formulaire] = await Promise.all([
    modulesDe(userId, personne.role),
    db.query(
      `SELECT id, nom, couleur, materiel_mode FROM ticket_categories
        WHERE parent_id IS NULL AND is_active = 1 ORDER BY ordre ASC, nom ASC`
    ),
    db.query('SELECT * FROM user_ticket_categories WHERE user_id = ?', [userId]),
    db.query(
      `SELECT DISTINCT ticket_categorie_id FROM user_ticket_categories WHERE niveau = 'superviseur' AND user_id <> ?`,
      [userId]
    ),
    sitesDe(userId),
    db.query(
      `SELECT um.object_id, o.name, o.reference
         FROM user_materiels um JOIN objects o ON o.id = um.object_id
        WHERE um.user_id = ? ORDER BY o.name ASC`,
      [userId]
    ),
    reglagesFormulaireDe(userId),
  ]);

  const parCategorie = new Map<number, any>(lignes.map((l: any) => [Number(l.ticket_categorie_id), l]));
  const supervisees = new Set(superviseurs.map((l: any) => Number(l.ticket_categorie_id)));

  const categories: CategorieDroits[] = racines.map((c: any) => {
    const ligne = parCategorie.get(Number(c.id));
    return {
      categorieId: Number(c.id),
      nom: c.nom,
      couleur: c.couleur ?? null,
      niveau: ligne ? (estNiveauTicket(ligne.niveau) ? ligne.niveau : 'demandeur') : null,
      peutCloturer: ligne ? ligne.peut_cloturer === null || ligne.peut_cloturer === undefined || Boolean(Number(ligne.peut_cloturer)) : true,
      materielAutorise:
        !ligne || ligne.materiel_autorise === null || ligne.materiel_autorise === undefined
          ? null
          : Boolean(Number(ligne.materiel_autorise)),
      proposeMateriel: Boolean(c.materiel_mode) && c.materiel_mode !== 'aucun',
      aUnSuperviseur: supervisees.has(Number(c.id)),
    };
  });

  const avertissements: string[] = [];
  const tickets = modules.find((m) => m.slug === 'tickets');
  if (tickets && !tickets.effectif && categories.some((c) => c.niveau)) {
    avertissements.push(
      'Le module Tickets lui est masqué, alors que des catégories de demandes lui sont attribuées.'
    );
  }
  for (const c of categories) {
    const intervient = c.niveau === 'intervenant' || c.niveau === 'intervenant_categorie';
    if (intervient && !c.peutCloturer && !c.aUnSuperviseur) {
      avertissements.push(
        `« ${c.nom} » n’a aucun superviseur : ses clôtures à valider iront aux administrateurs.`
      );
    }
  }
  if (sites.length > 1 && !sites.some((s) => s.parDefaut) && categories.some((c) => c.niveau)) {
    avertissements.push(
      'Plusieurs bâtiments et aucun désigné comme son bureau : ses demandes qui ne demandent pas de lieu, comme l’informatique, n’en porteront aucun.'
    );
  }

  return {
    personne: {
      id: Number(personne.id),
      nom: [personne.first_name, personne.last_name].filter(Boolean).join(' ').trim() || personne.email,
      role: personne.role,
    },
    modules,
    tickets: {
      categories,
      sites: sites.map((s) => ({
        siteId: s.id,
        nom: s.nom,
        estResponsable: s.estResponsable,
        peutVoirTickets: s.peutVoirTickets,
        notifie: s.notifie,
        gereLieu: s.gereLieu,
        parDefaut: s.parDefaut,
      })),
      materiels: materiels.map((m: any) => ({ objectId: Number(m.object_id), nom: m.name, reference: m.reference ?? null })),
      formulaire,
    },
    avertissements,
  };
}

// ------------------------------------------------------------ l'écriture

export interface DroitsSaisis {
  modules?: Array<{ pluginId: number; acces: boolean | null }>;
  categories?: LigneCategorieSaisie[];
  sites?: Array<{
    siteId: number;
    estResponsable?: boolean;
    peutVoirTickets?: boolean;
    notifie?: boolean;
    gereLieu?: boolean;
    /** Le bâtiment où la personne a son bureau ; un seul, le premier désigné. */
    parDefaut?: boolean;
  }>;
  materiels?: number[];
  formulaire?: { siteMode?: string | null; materielMode?: string | null };
}

/** Écrit ce qui est transmis, et seulement cela, dans une seule transaction. */
export async function definirDroits(userId: number, saisie: DroitsSaisis, auteurId: number): Promise<void> {
  const personne = await db.queryOne('SELECT id FROM users WHERE id = ?', [userId]);
  if (!personne) throw new SaisieInvalide('Personne introuvable');

  await db.transaction(async () => {
    if (Array.isArray(saisie.modules)) await definirModulesDe(userId, saisie.modules);
    if (Array.isArray(saisie.categories)) await definirCategoriesDe(userId, saisie.categories, auteurId);
    if (Array.isArray(saisie.sites)) {
      await definirSitesDe(
        userId,
        saisie.sites.map((s) => ({
          siteId: Number(s.siteId),
          estResponsable: Boolean(s.estResponsable),
          peutVoirTickets: Boolean(s.peutVoirTickets),
          notifie: Boolean(s.notifie),
          gereLieu: s.gereLieu === undefined ? undefined : Boolean(s.gereLieu),
          parDefaut: s.parDefaut === undefined ? undefined : Boolean(s.parDefaut),
        })),
        auteurId
      );
    }
    if (Array.isArray(saisie.materiels)) await definirMaterielsDe(userId, saisie.materiels.map(Number), auteurId);
    if (saisie.formulaire) await definirReglagesFormulaire(userId, saisie.formulaire, auteurId);
  });
}
