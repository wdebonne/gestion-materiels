import { db } from '../database';

/**
 * Le référentiel des demandes : les statuts, et les catégories qui décident du
 * routage.
 *
 * ## Les statuts sont ceux de la commune, pas ceux du code
 *
 * Six états sont semés au premier démarrage — à traiter, en cours, en attente
 * de retour, en commande, résolu, refusé — et la commune les renomme, les
 * recolore et les réordonne. Le code ne s'appuie donc jamais sur un libellé,
 * mais sur trois drapeaux, qui ne sont pas exclusifs :
 *
 *   `is_ouvert`  la demande compte encore comme à traiter
 *   `is_defaut`  l'état d'une demande qui vient d'être ouverte
 *   `is_final`   la demande est close, `ferme_at` est posée
 *
 * « En attente de retour » est ouvert sans être le défaut ; « refusé » est final
 * sans être une résolution. Un champ `type` unique ne saurait pas le dire.
 *
 * ## L'héritage d'une sous-catégorie
 *
 * Une sous-catégorie dont la colonne est `NULL` prend celle de sa parente. C'est
 * la convention déjà tenue par `subcategories` pour ses drapeaux
 * `available_for_*`, et elle évite de recopier le routage sur chaque
 * sous-catégorie — donc de le voir diverger le jour où le service change.
 *
 * `resoudreRoutage()` est le seul endroit qui applique cette règle. Toute route
 * qui la réécrirait finirait par en oublier une branche.
 */

// ----------------------------------------------------------------- les statuts

export interface Statut {
  id: number;
  nom: string;
  slug: string;
  couleur: string | null;
  icone: string | null;
  ordre: number;
  ouvert: boolean;
  defaut: boolean;
  final: boolean;
  systeme: boolean;
  actif: boolean;
}

function enStatut(l: any): Statut {
  return {
    id: Number(l.id),
    nom: l.nom,
    slug: l.slug,
    couleur: l.couleur ?? null,
    icone: l.icone ?? null,
    ordre: Number(l.ordre ?? 0),
    ouvert: Boolean(l.is_ouvert),
    defaut: Boolean(l.is_defaut),
    final: Boolean(l.is_final),
    systeme: Boolean(l.is_systeme),
    actif: Boolean(l.is_active),
  };
}

export async function listerStatuts(inclureInactifs = false): Promise<Statut[]> {
  const lignes = await db.query(
    `SELECT * FROM ticket_statuts
      ${inclureInactifs ? '' : 'WHERE is_active = 1'}
      ORDER BY ordre ASC, id ASC`
  );
  return lignes.map(enStatut);
}

export async function lireStatut(id: number | string): Promise<Statut | null> {
  const l = await db.queryOne('SELECT * FROM ticket_statuts WHERE id = ?', [id]);
  return l ? enStatut(l) : null;
}

/**
 * Le statut d'une demande qui vient d'être ouverte.
 *
 * À défaut de `is_defaut` — une commune peut l'avoir décoché par mégarde — on
 * prend le premier statut ouvert, puis le premier tout court. Une création ne
 * doit jamais échouer faute de réglage : elle échouerait au pire moment, sur le
 * geste que l'utilisateur vient de faire.
 */
export async function statutParDefaut(): Promise<Statut | null> {
  const l =
    (await db.queryOne('SELECT * FROM ticket_statuts WHERE is_defaut = 1 AND is_active = 1 ORDER BY ordre ASC')) ??
    (await db.queryOne('SELECT * FROM ticket_statuts WHERE is_ouvert = 1 AND is_active = 1 ORDER BY ordre ASC')) ??
    (await db.queryOne('SELECT * FROM ticket_statuts ORDER BY ordre ASC'));
  return l ? enStatut(l) : null;
}

/** Combien de demandes portent ce statut — une suppression le regarde. */
export async function usagesStatut(id: number | string): Promise<number> {
  const l = await db.queryOne('SELECT COUNT(*) as cnt FROM tickets WHERE statut_id = ?', [id]);
  return Number(l?.cnt ?? 0);
}

// -------------------------------------------------------------- les catégories

export interface CategorieDemande {
  id: number;
  nom: string;
  parentId: number | null;
  description: string | null;
  couleur: string | null;
  icone: string | null;
  ordre: number;
  actif: boolean;
  serviceId: number | null;
  technicienId: number | null;
  visibilite: Visibilite | null;
  materielMode: MaterielMode | null;
  siteMode: SiteMode | null;
  slaPriseEnChargeMinutes: number | null;
  slaResolutionMinutes: number | null;
}

export type Visibilite = 'privee' | 'site';
export type MaterielMode = 'aucun' | 'optionnel' | 'requis';
export type SiteMode = 'auto' | 'requis' | 'masque';

export const VISIBILITES: readonly Visibilite[] = ['privee', 'site'];
export const MATERIEL_MODES: readonly MaterielMode[] = ['aucun', 'optionnel', 'requis'];
export const SITE_MODES: readonly SiteMode[] = ['auto', 'requis', 'masque'];

function enCategorie(l: any): CategorieDemande {
  return {
    id: Number(l.id),
    nom: l.nom,
    parentId: l.parent_id === null || l.parent_id === undefined ? null : Number(l.parent_id),
    description: l.description ?? null,
    couleur: l.couleur ?? null,
    icone: l.icone ?? null,
    ordre: Number(l.ordre ?? 0),
    actif: Boolean(l.is_active),
    serviceId: l.service_id === null || l.service_id === undefined ? null : Number(l.service_id),
    technicienId: l.technicien_id === null || l.technicien_id === undefined ? null : Number(l.technicien_id),
    visibilite: (l.visibilite as Visibilite) ?? null,
    materielMode: (l.materiel_mode as MaterielMode) ?? null,
    siteMode: (l.site_mode as SiteMode) ?? null,
    slaPriseEnChargeMinutes:
      l.sla_prise_en_charge_minutes === null || l.sla_prise_en_charge_minutes === undefined
        ? null
        : Number(l.sla_prise_en_charge_minutes),
    slaResolutionMinutes:
      l.sla_resolution_minutes === null || l.sla_resolution_minutes === undefined
        ? null
        : Number(l.sla_resolution_minutes),
  };
}

/**
 * La forme comparable d'un nom de catégorie.
 *
 * Repris de `normaliserCategorie()` des plannings, et pour la même raison :
 * `UNIQUE(nom)` ne veut pas dire la même chose selon le moteur. MySQL, en
 * `utf8mb4_unicode_ci`, ignore la casse et les accents ; SQLite, en `BINARY`,
 * ne les ignore pas. Sans cette colonne, SQLite accepterait « Plomberie » et
 * « plomberie » côte à côte, et les demandes se répartiraient entre deux
 * catégories que rien ne distingue à l'œil.
 */
export function normaliserCategorie(nom: unknown): string {
  return String(nom ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * La clé de parenté employée par l'index unique.
 *
 * Les deux moteurs tiennent deux `NULL` pour distincts dans un index unique :
 * `UNIQUE(parent_id, name_normalise)` ne contraindrait donc **rien** sur les
 * catégories racines, dont le `parent_id` est `NULL`. « Informatique » pourrait
 * être créée deux fois, et les demandes se répartiraient entre les deux. `0`
 * porte le même renseignement sans le trou.
 */
export function cleParente(parentId: number | null | undefined): number {
  return parentId === null || parentId === undefined ? 0 : Number(parentId);
}

export async function listerCategories(inclureInactives = false): Promise<CategorieDemande[]> {
  const lignes = await db.query(
    `SELECT * FROM ticket_categories
      ${inclureInactives ? '' : 'WHERE is_active = 1'}
      ORDER BY ordre ASC, nom ASC`
  );
  return lignes.map(enCategorie);
}

export async function lireCategorie(id: number | string): Promise<CategorieDemande | null> {
  const l = await db.queryOne('SELECT * FROM ticket_categories WHERE id = ?', [id]);
  return l ? enCategorie(l) : null;
}

/** Erreur d'unicité, dans les deux dialectes. Repris de `plannings.service`. */
export function estViolationUnicite(erreur: any): boolean {
  const message = String(erreur?.message ?? '');
  return (
    erreur?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    erreur?.code === 'ER_DUP_ENTRY' ||
    /UNIQUE constraint failed/i.test(message) ||
    /Duplicate entry/i.test(message)
  );
}

/**
 * Erreur de clé étrangère, dans les deux dialectes.
 *
 * Un formulaire resté ouvert pendant qu'un administrateur retirait un bâtiment
 * enverra un identifiant qui n'existe plus. La contrainte fait son travail, mais
 * ressortirait en « Erreur serveur » — un message qui n'apprend rien à celui qui
 * vient d'écrire sa demande, et qui l'enverrait la ressaisir à l'identique.
 */
export function estViolationCleEtrangere(erreur: any): boolean {
  const message = String(erreur?.message ?? '');
  return (
    erreur?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
    erreur?.code === 'ER_NO_REFERENCED_ROW' ||
    erreur?.code === 'ER_NO_REFERENCED_ROW_2' ||
    /FOREIGN KEY constraint failed/i.test(message) ||
    /foreign key constraint fails/i.test(message)
  );
}

/** Ce qui empêche de supprimer une catégorie. */
export async function usagesCategorie(id: number | string): Promise<{ tickets: number; enfants: number }> {
  const t = await db.queryOne(
    'SELECT COUNT(*) as cnt FROM tickets WHERE categorie_id = ? OR sous_categorie_id = ?',
    [id, id]
  );
  const e = await db.queryOne('SELECT COUNT(*) as cnt FROM ticket_categories WHERE parent_id = ?', [id]);
  return { tickets: Number(t?.cnt ?? 0), enfants: Number(e?.cnt ?? 0) };
}

// ----------------------------------------------------------------- le routage

/**
 * Ce qu'une demande devient, une fois sa catégorie choisie.
 *
 * Toutes les valeurs remontent la chaîne sous-catégorie → catégorie, en
 * s'arrêtant à la première qui n'est pas `NULL`. Les défauts de dernier recours
 * sont posés ici, et nulle part ailleurs : une catégorie sans réglage donne une
 * demande privée, sans matériel, dont le bâtiment est demandé selon la
 * situation de la personne.
 */
export interface Routage {
  serviceId: number | null;
  technicienId: number | null;
  visibilite: Visibilite;
  materielMode: MaterielMode;
  siteMode: SiteMode;
  slaPriseEnChargeMinutes: number | null;
  slaResolutionMinutes: number | null;
}

export async function resoudreRoutage(
  categorieId: number | null | undefined,
  sousCategorieId: number | null | undefined
): Promise<Routage> {
  const sous = sousCategorieId ? await lireCategorie(sousCategorieId) : null;
  // La parente déclarée par la sous-catégorie fait foi : elle est plus sûre que
  // celle que l'appelant a transmise, qui peut venir d'un formulaire périmé.
  const parenteId = sous?.parentId ?? categorieId ?? null;
  const parente = parenteId ? await lireCategorie(parenteId) : null;

  const premier = <T>(...valeurs: Array<T | null | undefined>): T | null => {
    for (const v of valeurs) if (v !== null && v !== undefined) return v;
    return null;
  };

  return {
    serviceId: premier(sous?.serviceId, parente?.serviceId),
    technicienId: premier(sous?.technicienId, parente?.technicienId),
    visibilite: premier(sous?.visibilite, parente?.visibilite) ?? 'privee',
    materielMode: premier(sous?.materielMode, parente?.materielMode) ?? 'aucun',
    siteMode: premier(sous?.siteMode, parente?.siteMode) ?? 'auto',
    slaPriseEnChargeMinutes: premier(sous?.slaPriseEnChargeMinutes, parente?.slaPriseEnChargeMinutes),
    slaResolutionMinutes: premier(sous?.slaResolutionMinutes, parente?.slaResolutionMinutes),
  };
}

/**
 * Les catégories qu'une personne a le droit de demander.
 *
 * **Aucune ligne vaut « aucune catégorie ».** La première version faisait
 * l'inverse — tout proposer à qui n'avait rien — pour que le module serve avant
 * d'être configuré. C'était un mauvais calcul : chacun n'a pas les mêmes
 * besoins, et présenter à un agent d'accueil les catégories de la voirie et des
 * espaces verts lui fait ranger sa demande au hasard, ce qui coûte plus cher
 * qu'un formulaire vide.
 *
 * La contrepartie est assumée, et compensée : l'écran d'attribution signale
 * nommément les comptes sans rattachement, et le formulaire dit à qui n'a rien
 * vers qui se tourner plutôt que d'afficher une liste déserte sans explication.
 *
 * Le rattachement porte sur une catégorie racine ; ses sous-catégories suivent.
 * Rattacher quelqu'un à « Informatique » sans lui donner « Écran » serait un
 * piège à administrateur.
 */
export async function categoriesProposeesA(userId: number | string): Promise<CategorieDemande[]> {
  const rattachees = await db.query(
    'SELECT ticket_categorie_id FROM user_ticket_categories WHERE user_id = ?',
    [userId]
  );
  if (rattachees.length === 0) return [];

  const toutes = await listerCategories();
  const autorisees = new Set(rattachees.map((l: any) => Number(l.ticket_categorie_id)));
  return toutes.filter((c) => autorisees.has(c.id) || (c.parentId !== null && autorisees.has(c.parentId)));
}

/**
 * Le matériel attribué à cette personne — son téléphone, son ordinateur.
 *
 * C'est la réponse à « je veux signaler une panne sur *mon* poste » sans
 * dérouler l'inventaire de la commune. `objects.location` ne pouvait pas y
 * répondre : c'est du texte libre, et il désigne un lieu, pas une personne.
 *
 * `filtreParc` restreint en plus au parc que la catégorie de demande propose :
 * choisir « Informatique » ne doit pas faire apparaître la tondeuse qu'on a par
 * ailleurs en charge.
 */
export async function materielsDe(
  userId: number | string,
  filtreParc: { sql: string; params: any[] } = { sql: '', params: [] }
): Promise<Array<{ id: number; name: string; reference: string | null; location: string | null }>> {
  return db.query(
    `SELECT o.id, o.name, o.reference, o.location
       FROM user_materiels um
       JOIN objects o ON o.id = um.object_id
      WHERE um.user_id = ?${filtreParc.sql}
      ORDER BY o.name ASC`,
    [userId, ...filtreParc.params]
  );
}

/**
 * Cette personne peut-elle désigner un matériel pour cette catégorie ?
 *
 * La catégorie pose la règle, le rattachement individuel la corrige. C'est ce
 * qui répond à « si l'option est activée pour l'utilisateur » sans dupliquer le
 * réglage : `materiel_autorise` à `NULL` — le cas courant — laisse décider la
 * catégorie.
 */
export async function materielAutorisePour(
  userId: number | string,
  categorieId: number | null | undefined,
  routage: Routage
): Promise<boolean> {
  if (routage.materielMode === 'aucun') return false;
  // La catégorie autorise ; reste à voir si une exception vise cette personne.
  if (!categorieId) return true;

  const ligne = await db.queryOne(
    'SELECT materiel_autorise FROM user_ticket_categories WHERE user_id = ? AND ticket_categorie_id = ?',
    [userId, categorieId]
  );
  if (ligne && ligne.materiel_autorise !== null && ligne.materiel_autorise !== undefined) {
    return Boolean(ligne.materiel_autorise);
  }
  return true;
}

/**
 * Les catégories de parc que cette catégorie de demande propose.
 *
 * Rendues sous forme de fragment `WHERE` pour le sélecteur de matériel : sans
 * lui, « souci de bruit sur le Nemo » obligerait à dérouler tout le parc de la
 * commune, donc à ne jamais s'en servir. Aucune association vaut « tout le
 * parc », faute de quoi une catégorie mal réglée viderait la liste sans le dire.
 */
export async function filtreMaterielDe(
  categorieId: number | null | undefined,
  sousCategorieId: number | null | undefined
): Promise<{ sql: string; params: any[] }> {
  const ids = [sousCategorieId, categorieId].filter(Boolean);
  if (ids.length === 0) return { sql: '', params: [] };

  const marqueurs = ids.map(() => '?').join(',');
  const lignes = await db.query(
    `SELECT category_id, subcategory_id FROM ticket_categorie_materiels
      WHERE ticket_categorie_id IN (${marqueurs})`,
    ids
  );
  if (lignes.length === 0) return { sql: '', params: [] };

  const categories = lignes.map((l: any) => l.category_id).filter((v: any) => v !== null);
  const sousCategories = lignes.map((l: any) => l.subcategory_id).filter((v: any) => v !== null);

  const alternatives: string[] = [];
  const params: any[] = [];

  if (categories.length > 0) {
    const m = categories.map(() => '?').join(',');
    // Un matériel porte sa catégorie directement, ou par sa sous-catégorie :
    // les deux colonnes coexistent et l'une peut être nulle (`objectScope`).
    alternatives.push(
      `(o.category_id IN (${m}) OR EXISTS (SELECT 1 FROM subcategories sc WHERE sc.id = o.subcategory_id AND sc.category_id IN (${m})))`
    );
    params.push(...categories, ...categories);
  }
  if (sousCategories.length > 0) {
    const m = sousCategories.map(() => '?').join(',');
    alternatives.push(`o.subcategory_id IN (${m})`);
    params.push(...sousCategories);
  }

  return { sql: ` AND (${alternatives.join(' OR ')})`, params };
}
