import { db } from '../database';
import { EMPLACEMENTS_COULEUR, emplacementSuivant, estEmplacementCouleur } from '../config/paletteCategories';
import {
  estDureeValide,
  estHeureValide,
  estJourValide,
  minutesEntre,
  versJour,
} from '../utils/periodes';

/**
 * Les heures déclarées : ce qu'on a le droit de voir, et ce qu'on a le droit
 * d'écrire.
 *
 * Deux règles portent tout le module, et les deux sont subtiles.
 *
 * **Le périmètre.** Chacun voit ses propres heures ; un encadrant voit en plus
 * celles des personnes qui lui sont rattachées. La règle est volontairement la
 * même pour tous les rôles sauf l'administrateur, et volontairement **non
 * transitive** : si A encadre B et B encadre C, A ne voit pas C. Cela rend
 * inoffensifs les cas tordus — un encadrant lui-même rattaché à quelqu'un, deux
 * personnes rattachées l'une à l'autre — sans parcours de graphe, que MySQL 5.7
 * ne saurait de toute façon pas faire en SQL.
 *
 * **Les renforts non nominatifs.** Leur ligne porte `user_id IS NULL` et ne
 * satisfera jamais un `personne_id IN (…)`. Un périmètre écrit naïvement les
 * ferait disparaître de tous les rapports sauf ceux de l'administrateur —
 * silencieusement, et alors que c'est précisément une des choses que ce module
 * existe pour mesurer. Ils suivent donc le périmètre de la tâche à laquelle ils
 * se rattachent, jamais le leur.
 */

// ------------------------------------------------------------------- périmètre

export interface Perimetre {
  /** Aucune restriction : l'administrateur voit tout. */
  tout: boolean;
  /** Les personnes dont on peut lire les heures. Vide n'est pas « tout le monde ». */
  personnes: number[];
}

/** Les personnes rattachées à cet encadrant. */
export async function agentsDe(superviseurId: number): Promise<number[]> {
  const lignes = await db.query(
    'SELECT agent_id FROM planning_superviseurs WHERE superviseur_id = ?',
    [superviseurId]
  );
  return lignes.map((l: any) => Number(l.agent_id));
}

export interface LienEncadrement {
  id: number;
  personneId: number;
  nom: string;
  intitule: string | null;
}

/** Qui encadre cette personne, et à quel titre. */
export async function superviseursDe(agentId: number): Promise<LienEncadrement[]> {
  const lignes = await db.query(
    `SELECT ps.id, ps.intitule, u.id AS personne_id, u.first_name, u.last_name
       FROM planning_superviseurs ps
       JOIN users u ON u.id = ps.superviseur_id
      WHERE ps.agent_id = ?
      ORDER BY u.last_name, u.first_name`,
    [agentId]
  );
  return lignes.map(enLien);
}

/** Qui cette personne encadre, et à quel titre. */
export async function encadresPar(superviseurId: number): Promise<LienEncadrement[]> {
  const lignes = await db.query(
    `SELECT ps.id, ps.intitule, u.id AS personne_id, u.first_name, u.last_name
       FROM planning_superviseurs ps
       JOIN users u ON u.id = ps.agent_id
      WHERE ps.superviseur_id = ?
      ORDER BY u.last_name, u.first_name`,
    [superviseurId]
  );
  return lignes.map(enLien);
}

function enLien(ligne: any): LienEncadrement {
  return {
    id: Number(ligne.id),
    personneId: Number(ligne.personne_id),
    nom: nomComplet(ligne),
    intitule: ligne.intitule ?? null,
  };
}

/** Le nom affichable d'une personne, sans jamais rendre une chaîne vide. */
export function nomComplet(ligne: any): string {
  const nom = [ligne?.first_name, ligne?.last_name].filter(Boolean).join(' ').trim();
  return nom || `Personne n° ${ligne?.id ?? ligne?.personne_id ?? '?'}`;
}

/** Ce que cette personne a le droit de lire. */
export async function perimetreDe(userId: number, role: string): Promise<Perimetre> {
  if (role === 'admin') return { tout: true, personnes: [] };

  const agents = await agentsDe(userId);
  // `Set` : quelqu'un peut être rattaché à lui-même par accident de données
  // anciennes, et un identifiant répété fausserait un `IN` sans le dire.
  return { tout: false, personnes: [...new Set([userId, ...agents])] };
}

/** Peut-on saisir ou corriger une tâche au nom de cette personne ? */
export async function peutEcrirePour(
  userId: number,
  role: string,
  titulaireId: number
): Promise<boolean> {
  if (role === 'admin') return true;
  if (Number(titulaireId) === Number(userId)) return true;
  return (await agentsDe(userId)).includes(Number(titulaireId));
}

/**
 * Les personnes du périmètre, sous forme de fragment SQL.
 *
 * `null` veut dire « aucune restriction ». Un périmètre **vide** n'est pas
 * représentable : `IN ()` est une erreur de syntaxe sur les deux moteurs, et
 * l'appelant doit avoir renvoyé un résultat vide avant d'en arriver là.
 */
export function fragmentPerimetre(perimetre: Perimetre, colonne: string): { sql: string; params: number[] } | null {
  if (perimetre.tout) return null;
  if (perimetre.personnes.length === 0) {
    throw new Error('Périmètre vide : le résultat devait être écarté en amont.');
  }
  const marqueurs = perimetre.personnes.map(() => '?').join(', ');
  return { sql: `${colonne} IN (${marqueurs})`, params: [...perimetre.personnes] };
}

// ----------------------------------------------------------------- catégories

export interface Categorie {
  id: number;
  nom: string;
  couleur: string;
  active: boolean;
}

/**
 * La forme comparable d'un nom de catégorie.
 *
 * Volontairement plus douce que `normaliserLibelle` : celle-ci retire ce qu'il
 * y a entre parenthèses, ce qui confondrait « Entretien (été) » et
 * « Entretien (hiver) » — deux catégories que personne n'a demandé de fusionner.
 * Ici on ne neutralise que ce qui relève de la frappe : la casse, les accents et
 * les espaces en trop.
 */
export function normaliserCategorie(nom: unknown): string {
  return String(nom ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function enCategorie(ligne: any): Categorie {
  return {
    id: Number(ligne.id),
    nom: ligne.name,
    couleur: estEmplacementCouleur(ligne.couleur) ? ligne.couleur : EMPLACEMENTS_COULEUR[0],
    active: Boolean(Number(ligne.is_active)),
  };
}

export async function listerCategories(inclureInactives = false): Promise<Categorie[]> {
  const lignes = await db.query(
    `SELECT id, name, couleur, is_active FROM planning_categories
      ${inclureInactives ? '' : 'WHERE is_active = 1'}
      ORDER BY name`
  );
  return lignes.map(enCategorie);
}

export async function lireCategorie(id: number): Promise<Categorie | null> {
  const ligne = await db.queryOne(
    'SELECT id, name, couleur, is_active FROM planning_categories WHERE id = ?',
    [id]
  );
  return ligne ? enCategorie(ligne) : null;
}

/**
 * La catégorie portant ce nom, créée si elle n'existe pas encore.
 *
 * C'est ce que fait le champ d'autocomplétion du formulaire : l'agent tape
 * « Livraison Manifestation », et si personne ne l'a encore employée, elle
 * entre dans le référentiel.
 *
 * Pas de transaction : `db.transaction` est réservé aux opérations
 * d'administration en bloc — sur SQLite il n'y a qu'une connexion, et une
 * transaction ouverte ici happerait les écritures des autres requêtes. On
 * s'appuie donc sur l'index unique : si deux agents saisissent la même
 * catégorie à la même seconde — un lundi matin, ça arrive — le second `INSERT`
 * échoue, et on relit la ligne que le premier vient de créer.
 */
export async function resoudreCategorie(nom: string, auteurId: number | null): Promise<Categorie> {
  const propre = String(nom ?? '').replace(/\s+/g, ' ').trim();
  if (propre.length === 0) {
    throw new Error('Le nom de la catégorie ne peut pas être vide.');
  }
  if (propre.length > 160) {
    throw new Error('Le nom de la catégorie est limité à 160 caractères.');
  }

  const normalise = normaliserCategorie(propre);

  const existante = await db.queryOne(
    'SELECT id, name, couleur, is_active FROM planning_categories WHERE name_normalise = ?',
    [normalise]
  );
  if (existante) return enCategorie(existante);

  const prises = await db.query('SELECT couleur FROM planning_categories WHERE is_active = 1');
  const couleur = emplacementSuivant(prises.map((l: any) => l.couleur));
  const maintenant = new Date().toISOString();

  try {
    const { lastInsertRowid } = await db.execute(
      `INSERT INTO planning_categories (name, name_normalise, couleur, is_active, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
      [propre, normalise, couleur, auteurId, maintenant, maintenant]
    );
    return { id: Number(lastInsertRowid), nom: propre, couleur, active: true };
  } catch (erreur: any) {
    if (!estViolationUnicite(erreur)) throw erreur;
    const concurrente = await db.queryOne(
      'SELECT id, name, couleur, is_active FROM planning_categories WHERE name_normalise = ?',
      [normalise]
    );
    if (!concurrente) throw erreur;
    return enCategorie(concurrente);
  }
}

/** Les deux moteurs ne nomment pas pareil le refus d'un doublon. */
export function estViolationUnicite(erreur: any): boolean {
  const message = String(erreur?.message ?? '');
  return /UNIQUE constraint failed/i.test(message)
    || /Duplicate entry/i.test(message)
    || erreur?.code === 'SQLITE_CONSTRAINT_UNIQUE'
    || erreur?.code === 'ER_DUP_ENTRY';
}

/** Combien de tâches emploient encore cette catégorie. */
export async function usagesCategorie(id: number): Promise<number> {
  const ligne = await db.queryOne(
    'SELECT COUNT(*) as cnt FROM planning_taches WHERE categorie_id = ?',
    [id]
  );
  return Number(ligne?.cnt ?? 0);
}

// --------------------------------------------------------------------- tâches

export interface ParticipantSaisi {
  userId?: number | null;
  libelle?: string | null;
  minutes?: number | null;
}

export interface TacheSaisie {
  userId: number;
  jour: string;
  heureDebut?: string | null;
  heureFin?: string | null;
  minutes?: number | null;
  categorieId?: number | null;
  manifestationId?: number | null;
  ticketId?: number | null;
  description?: string | null;
  participants?: ParticipantSaisi[];
}

/** Une saisie refusée, avec ce qu'il faut dire à la personne. */
export class SaisieInvalide extends Error {}

/**
 * La durée d'une tâche : depuis ses horaires, ou telle qu'elle a été donnée.
 *
 * Les horaires priment toujours. Une durée envoyée par le client alors que les
 * horaires sont là serait une seconde vérité, qui finirait par diverger de la
 * première — et un total qu'on ne saurait plus expliquer depuis sa ligne.
 * La durée seule reste acceptée pour le cas « deux heures, je ne sais plus
 * quand », qui est une saisie légitime de fin de journée.
 */
export function calculerMinutes(saisie: Pick<TacheSaisie, 'heureDebut' | 'heureFin' | 'minutes'>): number {
  const { heureDebut, heureFin, minutes } = saisie;

  if (heureDebut || heureFin) {
    if (!estHeureValide(heureDebut) || !estHeureValide(heureFin)) {
      throw new SaisieInvalide("Indiquez l'heure de début et l'heure de fin, au format HH:MM.");
    }
    try {
      return minutesEntre(heureDebut, heureFin);
    } catch (erreur: any) {
      throw new SaisieInvalide(erreur.message);
    }
  }

  if (!estDureeValide(minutes)) {
    throw new SaisieInvalide('Indiquez des horaires, ou une durée entre 1 minute et 24 heures.');
  }
  return minutes;
}

/**
 * Vérifie une saisie de bout en bout avant d'écrire quoi que ce soit.
 *
 * Tout est contrôlé ici plutôt qu'au fil des `INSERT` : sans transaction
 * ordinaire sur ce chemin, une tâche écrite puis un participant refusé
 * laisserait une tâche incomplète en base.
 */
export function verifierSaisie(saisie: TacheSaisie): { minutes: number; participants: Required<ParticipantSaisi>[] } {
  if (!estJourValide(saisie.jour)) {
    throw new SaisieInvalide('La date doit être un jour existant, au format AAAA-MM-JJ.');
  }

  const minutes = calculerMinutes(saisie);
  const participants: Required<ParticipantSaisi>[] = [];
  const dejaVus = new Set<number>();

  for (const brut of saisie.participants ?? []) {
    const userId = brut.userId == null ? null : Number(brut.userId);
    const libelle = String(brut.libelle ?? '').replace(/\s+/g, ' ').trim();

    if (userId != null && libelle) {
      throw new SaisieInvalide('Un renfort est soit une personne de l’annuaire, soit un libellé, pas les deux.');
    }
    if (userId == null && !libelle) {
      throw new SaisieInvalide('Nommez le renfort, ou décrivez-le en quelques mots.');
    }
    if (userId != null && userId === Number(saisie.userId)) {
      throw new SaisieInvalide(
        'Le titulaire de la tâche est déjà compté pour sa durée : ne l’ajoutez pas comme renfort.'
      );
    }
    if (userId != null && dejaVus.has(userId)) {
      throw new SaisieInvalide('Cette personne figure déjà parmi les renforts de cette tâche.');
    }
    if (userId != null) dejaVus.add(userId);

    // Par défaut le renfort a fait la tâche entière : c'est le cas courant,
    // deux agents sur la même livraison. Le soutien partiel se dit en
    // corrigeant cette valeur.
    const duree = brut.minutes == null ? minutes : Number(brut.minutes);
    if (!estDureeValide(duree)) {
      throw new SaisieInvalide('La participation d’un renfort doit tenir entre 1 minute et 24 heures.');
    }

    participants.push({ userId, libelle: libelle || null, minutes: duree });
  }

  return { minutes, participants };
}

export async function creerTache(saisie: TacheSaisie, auteurId: number): Promise<number> {
  const { minutes, participants } = verifierSaisie(saisie);
  const maintenant = new Date().toISOString();

  const { lastInsertRowid } = await db.execute(
    `INSERT INTO planning_taches
       (user_id, categorie_id, manifestation_id, ticket_id, date_jour, heure_debut, heure_fin,
        minutes, description, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      saisie.userId,
      saisie.categorieId ?? null,
      saisie.manifestationId ?? null,
      saisie.ticketId ?? null,
      saisie.jour,
      saisie.heureDebut || null,
      saisie.heureFin || null,
      minutes,
      saisie.description || null,
      auteurId,
      maintenant,
      maintenant,
    ]
  );

  const tacheId = Number(lastInsertRowid);

  try {
    await ecrireParticipants(tacheId, participants);
  } catch (erreur) {
    // Une tâche sans ses renforts afficherait un total faux sans le dire :
    // mieux vaut n'en laisser aucune trace et laisser la personne recommencer.
    await db.execute('DELETE FROM planning_taches WHERE id = ?', [tacheId]);
    throw erreur;
  }

  return tacheId;
}

export async function modifierTache(id: number, saisie: TacheSaisie): Promise<void> {
  const { minutes, participants } = verifierSaisie(saisie);

  await db.execute(
    `UPDATE planning_taches
        SET user_id = ?, categorie_id = ?, manifestation_id = ?, ticket_id = ?, date_jour = ?,
            heure_debut = ?, heure_fin = ?, minutes = ?, description = ?, updated_at = ?
      WHERE id = ?`,
    [
      saisie.userId,
      saisie.categorieId ?? null,
      saisie.manifestationId ?? null,
      saisie.ticketId ?? null,
      saisie.jour,
      saisie.heureDebut || null,
      saisie.heureFin || null,
      minutes,
      saisie.description || null,
      new Date().toISOString(),
      id,
    ]
  );

  await db.execute('DELETE FROM planning_participants WHERE tache_id = ?', [id]);
  await ecrireParticipants(id, participants);
}

async function ecrireParticipants(tacheId: number, participants: Required<ParticipantSaisi>[]): Promise<void> {
  const maintenant = new Date().toISOString();
  for (const p of participants) {
    await db.execute(
      'INSERT INTO planning_participants (tache_id, user_id, libelle, minutes, created_at) VALUES (?, ?, ?, ?, ?)',
      [tacheId, p.userId, p.libelle, p.minutes, maintenant]
    );
  }
}

export async function supprimerTache(id: number): Promise<void> {
  // Les renforts partent avec la tâche par `ON DELETE CASCADE`.
  await db.execute('DELETE FROM planning_taches WHERE id = ?', [id]);
}

// ---------------------------------------------------------------- lecture

export interface FiltresTaches {
  debut: string;
  fin: string;
  categorieIds?: number[];
  personneIds?: number[];
  manifestationId?: number | null;
  ticketId?: number | null;
}

export interface Tache {
  id: number;
  jour: string;
  heureDebut: string | null;
  heureFin: string | null;
  minutes: number;
  minutesMobilisees: number;
  description: string | null;
  titulaire: { id: number; nom: string };
  categorie: Categorie | null;
  manifestation: { id: number; titre: string } | null;
  ticket: { id: number; reference: string | null; titre: string } | null;
  participants: {
    id: number;
    personne: { id: number; nom: string } | null;
    libelle: string | null;
    minutes: number;
  }[];
}

/**
 * Le fragment `WHERE` commun à toutes les lectures de tâches.
 *
 * Il est construit une fois et réemployé, y compris dans les deux branches de
 * l'union des rapports : recopier ces conditions obligerait à empiler les
 * paramètres deux fois, dans le bon ordre, ce qui est précisément la façon dont
 * ce genre de requête finit par mentir.
 */
export function construireFiltres(
  filtres: FiltresTaches,
  perimetre: Perimetre,
  alias = 't'
): { sql: string; params: any[] } {
  const conditions: string[] = [`${alias}.date_jour >= ?`, `${alias}.date_jour <= ?`];
  const params: any[] = [filtres.debut, filtres.fin];

  if (filtres.categorieIds?.length) {
    conditions.push(`${alias}.categorie_id IN (${filtres.categorieIds.map(() => '?').join(', ')})`);
    params.push(...filtres.categorieIds);
  }

  if (filtres.manifestationId != null) {
    conditions.push(`${alias}.manifestation_id = ?`);
    params.push(filtres.manifestationId);
  }

  // Même mécanique que la manifestation : c'est le précédent exact, et le
  // rapport sait déjà répartir par entité rattachée.
  if (filtres.ticketId != null) {
    conditions.push(`${alias}.ticket_id = ?`);
    params.push(filtres.ticketId);
  }

  // Les personnes demandées explicitement retiennent la tâche si elles en sont
  // titulaires **ou** si elles y ont prêté main-forte : sans quoi les heures
  // d'un agent qui n'a fait qu'aider seraient introuvables.
  if (filtres.personneIds?.length) {
    const marqueurs = filtres.personneIds.map(() => '?').join(', ');
    conditions.push(
      `(${alias}.user_id IN (${marqueurs}) OR EXISTS (
          SELECT 1 FROM planning_participants pf
           WHERE pf.tache_id = ${alias}.id AND pf.user_id IN (${marqueurs})))`
    );
    params.push(...filtres.personneIds, ...filtres.personneIds);
  }

  const portee = fragmentPerimetre(perimetre, `${alias}.user_id`);
  if (portee) {
    // Une tâche dont le titulaire est hors périmètre reste visible si l'un des
    // renforts en fait partie : sinon le total hebdomadaire de mon agent
    // amputerait ce qu'il a fait chez les autres.
    const marqueurs = perimetre.personnes.map(() => '?').join(', ');
    conditions.push(
      `(${portee.sql} OR EXISTS (
          SELECT 1 FROM planning_participants pp
           WHERE pp.tache_id = ${alias}.id AND pp.user_id IN (${marqueurs})))`
    );
    params.push(...portee.params, ...perimetre.personnes);
  }

  return { sql: conditions.join(' AND '), params };
}

export async function listerTaches(filtres: FiltresTaches, perimetre: Perimetre): Promise<Tache[]> {
  if (!perimetre.tout && perimetre.personnes.length === 0) return [];

  const { sql, params } = construireFiltres(filtres, perimetre);

  const lignes = await db.query(
    `SELECT t.*, u.first_name, u.last_name,
            c.id AS cat_id, c.name AS cat_name, c.couleur AS cat_couleur, c.is_active AS cat_active,
            m.id AS manif_id, m.title AS manif_titre,
            tk.id AS ticket_ref_id, tk.reference AS ticket_reference, tk.titre AS ticket_titre
       FROM planning_taches t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN planning_categories c ON c.id = t.categorie_id
       LEFT JOIN manifestations m ON m.id = t.manifestation_id
       LEFT JOIN tickets tk ON tk.id = t.ticket_id
      WHERE ${sql}
      ORDER BY t.date_jour DESC, t.heure_debut DESC, t.id DESC`,
    params
  );

  if (lignes.length === 0) return [];

  const participants = await participantsDe(lignes.map((l: any) => Number(l.id)));

  return lignes.map((ligne: any) => {
    const miens = participants.get(Number(ligne.id)) ?? [];
    return {
      id: Number(ligne.id),
      jour: versJour(ligne.date_jour),
      heureDebut: ligne.heure_debut ?? null,
      heureFin: ligne.heure_fin ?? null,
      minutes: Number(ligne.minutes),
      minutesMobilisees: Number(ligne.minutes) + miens.reduce((total, p) => total + p.minutes, 0),
      description: ligne.description ?? null,
      titulaire: { id: Number(ligne.user_id), nom: nomComplet(ligne) },
      categorie: ligne.cat_id
        ? enCategorie({ id: ligne.cat_id, name: ligne.cat_name, couleur: ligne.cat_couleur, is_active: ligne.cat_active })
        : null,
      manifestation: ligne.manif_id ? { id: Number(ligne.manif_id), titre: ligne.manif_titre } : null,
      ticket: ligne.ticket_ref_id
        ? {
            id: Number(ligne.ticket_ref_id),
            reference: ligne.ticket_reference ?? null,
            titre: ligne.ticket_titre,
          }
        : null,
      participants: miens,
    };
  });
}

/** Les renforts de plusieurs tâches, en une requête plutôt qu'une par tâche. */
async function participantsDe(tacheIds: number[]): Promise<Map<number, Tache['participants']>> {
  const parTache = new Map<number, Tache['participants']>();
  if (tacheIds.length === 0) return parTache;

  const lignes = await db.query(
    `SELECT p.id, p.tache_id, p.user_id, p.libelle, p.minutes,
            u.first_name, u.last_name
       FROM planning_participants p
       LEFT JOIN users u ON u.id = p.user_id
      WHERE p.tache_id IN (${tacheIds.map(() => '?').join(', ')})
      ORDER BY p.id`,
    tacheIds
  );

  for (const ligne of lignes) {
    const tacheId = Number(ligne.tache_id);
    if (!parTache.has(tacheId)) parTache.set(tacheId, []);
    parTache.get(tacheId)!.push({
      id: Number(ligne.id),
      personne: ligne.user_id
        ? { id: Number(ligne.user_id), nom: nomComplet(ligne) }
        : null,
      libelle: ligne.libelle ?? null,
      minutes: Number(ligne.minutes),
    });
  }

  return parTache;
}

/** Une tâche, si le périmètre permet de la voir. */
export async function lireTache(id: number, perimetre: Perimetre): Promise<Tache | null> {
  if (!perimetre.tout && perimetre.personnes.length === 0) return null;

  const ligne = await db.queryOne('SELECT user_id, date_jour FROM planning_taches WHERE id = ?', [id]);
  if (!ligne) return null;

  const jour = versJour(ligne.date_jour);
  const taches = await listerTaches({ debut: jour, fin: jour }, perimetre);
  return taches.find((t) => t.id === Number(id)) ?? null;
}

/** Les personnes rattachées à aucun encadrant : leurs heures n'échappent pas, elles se cachent. */
export async function agentsSansSuperviseur(): Promise<{ id: number; nom: string }[]> {
  const lignes = await db.query(
    `SELECT DISTINCT u.id, u.first_name, u.last_name
       FROM planning_taches t
       JOIN users u ON u.id = t.user_id
      WHERE u.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM planning_superviseurs ps WHERE ps.agent_id = u.id)
        AND u.role != 'admin'
      ORDER BY u.last_name, u.first_name`
  );
  return lignes.map((l: any) => ({ id: Number(l.id), nom: nomComplet(l) }));
}
