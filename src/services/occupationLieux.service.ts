import { db } from '../database';

/**
 * Qui occupe quel lieu, et quand — et ce qui se heurte.
 *
 * Une seule fonction porte la règle de conflit, et l'écran comme le serveur
 * l'appellent. C'est littéralement la leçon de `requeteConflits` dans
 * `reservation.routes.ts` : si la vérification affichée et le refus opposé à
 * l'enregistrement divergeaient, l'écran annoncerait « libre » puis le serveur
 * répondrait 409 — pire que de ne rien annoncer, parce que l'utilisateur
 * cesserait de faire confiance à l'indication.
 */

/** Ce qui occupe réellement un lieu. `annule` est gardé pour l'historique, et ne bloque rien. */
export const STATUTS_OCCUPANTS = ['demande', 'confirme'] as const;

/** Les trois statuts admis en base. */
export const STATUTS_OCCUPATION = ['demande', 'confirme', 'annule'] as const;

export type StatutOccupation = (typeof STATUTS_OCCUPATION)[number];

/**
 * Deux créneaux se chevauchent si l'un commence **avant** que l'autre finisse et
 * finit **après** que l'autre commence. Les bornes sont **exclusives**.
 *
 * C'est l'inverse de `CHEVAUCHEMENT` dans `reservation.routes.ts`, qui s'écrit
 * `start_date <= ? AND end_date >= ?` — bornes incluses — parce qu'« un matériel
 * n'est pas rendu et repris dans la même seconde ».
 *
 * Une salle, si. Libérée à 18h00, elle est reprise à 18h00 : c'est même le cas
 * normal d'une salle des fêtes un samedi. Recopier l'opérateur du parc ferait
 * refuser un créneau 18h–20h après un 16h–18h, et le réglage passerait pour un
 * bug dès le premier jour.
 *
 * Deux règles voisines, deux fichiers, chacune commentée chez elle. Paramètres
 * attendus, dans cet ordre : **fin** du créneau demandé, puis **début**.
 */
export const CHEVAUCHEMENT_LIEU = 'debut < ? AND fin > ?';

/**
 * La même condition, préfixée d'un alias de table.
 *
 * Écrit comme une fonction plutôt que dérivé de la constante par un `replace` :
 * une substitution sur du SQL est le genre d'astuce qui marche jusqu'au jour où
 * une colonne s'appelle `debut_reel`, et qui se casse alors en silence, en
 * produisant une requête valide mais fausse.
 */
export const chevauchementAvec = (alias: string): string =>
  `${alias}.debut < ? AND ${alias}.fin > ?`;

export interface Creneau {
  siteId: number;
  /** `null` = le bâtiment entier. */
  pieceId?: number | null;
  debut: string;
  fin: string;
}

export interface Conflit {
  id: number;
  site_id: number;
  piece_id: number | null;
  manifestation_id: number | null;
  titre: string;
  debut: string;
  fin: string;
  statut: StatutOccupation;
  site_name: string | null;
  piece_name: string | null;
}

/**
 * Ce qui heurte un créneau, en tenant compte de la hiérarchie des lieux.
 *
 * Trois cas, et c'est toute la règle :
 *
 *   on demande **le bâtiment entier** → tout ce qui touche ce bâtiment heurte,
 *   y compris une seule de ses pièces : on ne prête pas la mairie entière le
 *   jour d'un mariage dans la salle des mariages ;
 *
 *   on demande **une pièce** → l'occupation du bâtiment entier heurte, et celle
 *   de la même pièce aussi ;
 *
 *   **deux pièces différentes** ne se gênent pas.
 *
 * Le résultat porte le **statut** de chaque conflit. Une occupation `demande`
 * n'est pas un refus : elle se signale, et c'est au superviseur de trancher —
 * exactement le traitement que `reservation.routes.ts` réserve à `pending`.
 *
 * `ignorerId` sert à la modification : un créneau ne doit pas se heurter
 * lui-même quand on le déplace d'une heure.
 */
export async function conflitsPour(
  creneau: Creneau & { ignorerId?: number | null; ignorerManifestationId?: number | null }
): Promise<Conflit[]> {
  const { siteId, pieceId, debut, fin, ignorerId, ignorerManifestationId } = creneau;

  const marqueurs = STATUTS_OCCUPANTS.map(() => '?').join(', ');
  const params: any[] = [siteId, ...STATUTS_OCCUPANTS];

  /*
   * Branché ici plutôt qu'écrit en SQL avec un `? IS NULL` : la comparaison
   * d'un paramètre à NULL se lit mal et se comporte différemment selon le
   * pilote. Deux phrases claires valent mieux qu'une phrase habile.
   */
  let portee = '';
  if (pieceId !== null && pieceId !== undefined) {
    portee = 'AND (o.piece_id IS NULL OR o.piece_id = ?)';
    params.push(pieceId);
  }

  params.push(fin, debut);

  let exclusion = '';
  if (ignorerId) {
    exclusion += ' AND o.id <> ?';
    params.push(ignorerId);
  }
  if (ignorerManifestationId) {
    exclusion += ' AND (o.manifestation_id IS NULL OR o.manifestation_id <> ?)';
    params.push(ignorerManifestationId);
  }

  return db.query<Conflit>(
    `SELECT o.id, o.site_id, o.piece_id, o.manifestation_id, o.titre, o.debut, o.fin, o.statut,
            s.name AS site_name, p.name AS piece_name
       FROM lieu_occupations o
       LEFT JOIN cle_sites s ON s.id = o.site_id
       LEFT JOIN site_pieces p ON p.id = o.piece_id
      WHERE o.site_id = ?
        AND o.statut IN (${marqueurs})
        ${portee}
        AND ${chevauchementAvec('o')}
        ${exclusion}
      ORDER BY o.debut ASC`,
    params
  );
}

/** Ce qui interdit vraiment, par opposition à ce qui mérite seulement d'être signalé. */
export const bloquants = (conflits: Conflit[]): Conflit[] =>
  conflits.filter((c) => c.statut === 'confirme');

/** Ce qui est demandé mais pas arbitré : on le montre, on ne s'en sert pas pour refuser. */
export const avertissements = (conflits: Conflit[]): Conflit[] =>
  conflits.filter((c) => c.statut === 'demande');

// ------------------------------------------------------------------ lecture

/** Les occupations d'une période, pour l'agenda. */
export async function listerOccupations(filtres: {
  debut?: string;
  fin?: string;
  siteId?: number | null;
  pieceId?: number | null;
  manifestationId?: number | null;
  statuts?: readonly string[];
}): Promise<Conflit[]> {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filtres.debut && filtres.fin) {
    conditions.push(chevauchementAvec('o'));
    params.push(filtres.fin, filtres.debut);
  }
  if (filtres.siteId) {
    conditions.push('o.site_id = ?');
    params.push(filtres.siteId);
  }
  if (filtres.pieceId) {
    conditions.push('o.piece_id = ?');
    params.push(filtres.pieceId);
  }
  if (filtres.manifestationId) {
    conditions.push('o.manifestation_id = ?');
    params.push(filtres.manifestationId);
  }

  const statuts = filtres.statuts ?? STATUTS_OCCUPANTS;
  conditions.push(`o.statut IN (${statuts.map(() => '?').join(', ')})`);
  params.push(...statuts);

  return db.query<Conflit>(
    `SELECT o.id, o.site_id, o.piece_id, o.manifestation_id, o.titre, o.debut, o.fin, o.statut,
            o.demandeur, o.notes,
            s.name AS site_name, p.name AS piece_name
       FROM lieu_occupations o
       LEFT JOIN cle_sites s ON s.id = o.site_id
       LEFT JOIN site_pieces p ON p.id = o.piece_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY o.debut ASC`,
    params
  );
}

export async function lireOccupation(id: number | string): Promise<Conflit | null> {
  return db.queryOne<Conflit>('SELECT * FROM lieu_occupations WHERE id = ?', [id]);
}

// ----------------------------------------------------------------- écriture

export interface SaisieOccupation {
  siteId: number;
  pieceId?: number | null;
  manifestationId?: number | null;
  titre: string;
  debut: string;
  fin: string;
  statut?: StatutOccupation;
  demandeur?: string | null;
  notes?: string | null;
  creePar?: number | null;
}

export async function creerOccupation(saisie: SaisieOccupation): Promise<number> {
  const resultat = await db.execute(
    `INSERT INTO lieu_occupations
       (site_id, piece_id, manifestation_id, titre, debut, fin, statut, demandeur, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      saisie.siteId,
      saisie.pieceId ?? null,
      saisie.manifestationId ?? null,
      saisie.titre,
      saisie.debut,
      saisie.fin,
      saisie.statut ?? 'confirme',
      saisie.demandeur ?? null,
      saisie.notes ?? null,
      saisie.creePar ?? null,
    ]
  );
  return Number(resultat.lastInsertRowid);
}

export async function modifierOccupation(
  id: number | string,
  valeurs: Partial<SaisieOccupation>
): Promise<void> {
  const champs: string[] = [];
  const params: any[] = [];
  const poser = (colonne: string, valeur: any) => {
    champs.push(`${colonne} = ?`);
    params.push(valeur);
  };

  if (valeurs.siteId !== undefined) poser('site_id', valeurs.siteId);
  if (valeurs.pieceId !== undefined) poser('piece_id', valeurs.pieceId ?? null);
  if (valeurs.titre !== undefined) poser('titre', valeurs.titre);
  if (valeurs.debut !== undefined) poser('debut', valeurs.debut);
  if (valeurs.fin !== undefined) poser('fin', valeurs.fin);
  if (valeurs.statut !== undefined) poser('statut', valeurs.statut);
  if (valeurs.demandeur !== undefined) poser('demandeur', valeurs.demandeur ?? null);
  if (valeurs.notes !== undefined) poser('notes', valeurs.notes ?? null);

  if (champs.length === 0) return;

  params.push(id);
  await db.execute(`UPDATE lieu_occupations SET ${champs.join(', ')} WHERE id = ?`, params);
}

export async function supprimerOccupation(id: number | string): Promise<void> {
  await db.execute('DELETE FROM lieu_occupations WHERE id = ?', [id]);
}

// ------------------------------------------------------ dates et créneaux

/**
 * Le jour d'une valeur venue de la base, au format `YYYY-MM-DD`.
 *
 * **Le pool mysql2 de ce dépôt n'a pas `dateStrings`.** Une colonne `DATE` en
 * revient donc en objet `Date` construit à minuit *local*, là où SQLite rend la
 * chaîne telle quelle. Passer ce `Date` par `toISOString()` — le réflexe — donne
 * la veille dès que le serveur est à l'est de Greenwich : le décalage
 * n'apparaît qu'en production, sur une seule journée, et il est très pénible à
 * retrouver.
 *
 * On lit donc les composantes **locales**, comme `versDateTime` le fait déjà
 * dans `tickets.service.ts`, et on ne touche jamais à `toISOString`.
 */
export function jourDe(valeur: unknown): string | null {
  if (!valeur) return null;

  if (valeur instanceof Date) {
    if (Number.isNaN(valeur.getTime())) return null;
    const deuxChiffres = (n: number) => String(n).padStart(2, '0');
    return `${valeur.getFullYear()}-${deuxChiffres(valeur.getMonth() + 1)}-${deuxChiffres(valeur.getDate())}`;
  }

  const texte = String(valeur).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(texte) ? texte.slice(0, 10) : null;
}

/** `16:00`, `16h00`, `16:00:00` → `16:00:00`. Rend `null` sur ce qui n'est pas une heure. */
export function heureDe(valeur: unknown, defaut: string): string {
  if (valeur === null || valeur === undefined || String(valeur).trim() === '') return defaut;

  const trouve = /^(\d{1,2})[:hH](\d{2})/.exec(String(valeur).trim());
  if (!trouve) return defaut;

  const heures = Number(trouve[1]);
  const minutes = Number(trouve[2]);
  if (heures > 23 || minutes > 59) return defaut;

  return `${String(heures).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
}

/**
 * Les bornes d'une manifestation, en `DATETIME`.
 *
 * Une manifestation sans heure occupe la journée entière : `00:00:00` à
 * `23:59:59`. C'est volontairement large — mieux vaut signaler un conflit à
 * arbitrer que d'en taire un parce que personne n'a saisi d'horaire.
 *
 * Rend `null` si la date de début manque, seul cas où l'on ne peut rien dire.
 */
export function bornesDeLaManifestation(manifestation: {
  date_start?: unknown;
  date_end?: unknown;
  start_time?: unknown;
  end_time?: unknown;
}): { debut: string; fin: string } | null {
  const jourDebut = jourDe(manifestation.date_start);
  if (!jourDebut) return null;

  const jourFin = jourDe(manifestation.date_end) ?? jourDebut;

  return {
    debut: `${jourDebut} ${heureDe(manifestation.start_time, '00:00:00')}`,
    fin: `${jourFin} ${heureDe(manifestation.end_time, '23:59:59')}`,
  };
}

/**
 * Remplace les créneaux qu'une manifestation occupe.
 *
 * Remplacement et non fusion, comme `definirOuvrants` pour les clés : l'écran
 * présente la liste entière des lieux retenus, et en retirer un s'y fait en le
 * décochant. Une fusion le laisserait en place, et la salle resterait bloquée
 * sans que personne ne comprenne pourquoi.
 *
 * Seuls les créneaux **de cette manifestation** sont remplacés : ceux saisis à
 * la main sur les mêmes salles — un mariage, un conseil — n'ont rien à voir avec
 * elle et survivent.
 */
export async function ecrireOccupationsDeLaManifestation(
  manifestationId: number,
  manifestation: { title?: string; date_start?: unknown; date_end?: unknown; start_time?: unknown; end_time?: unknown },
  lieux: Array<{ siteId: number; pieceId?: number | null }>,
  options: { statut?: StatutOccupation; demandeur?: string | null; creePar?: number | null } = {}
): Promise<number> {
  await db.execute('DELETE FROM lieu_occupations WHERE manifestation_id = ?', [manifestationId]);

  const bornes = bornesDeLaManifestation(manifestation);
  if (!bornes) return 0;

  let ecrits = 0;
  for (const lieu of lieux) {
    if (!lieu?.siteId) continue;
    await creerOccupation({
      siteId: Number(lieu.siteId),
      pieceId: lieu.pieceId ? Number(lieu.pieceId) : null,
      manifestationId,
      titre: manifestation.title || 'Manifestation',
      debut: bornes.debut,
      fin: bornes.fin,
      statut: options.statut ?? 'demande',
      demandeur: options.demandeur ?? null,
      creePar: options.creePar ?? null,
    });
    ecrits += 1;
  }
  return ecrits;
}

/**
 * Les conflits d'une manifestation, tous lieux confondus.
 *
 * Calculé et non stocké. Un conflit naît et meurt quand *l'autre* réservation
 * bouge : une colonne `en_conflit` sur la manifestation serait fausse sans que
 * rien ne l'ait touchée, et c'est le genre de champ que plus personne n'ose
 * croire au bout de six mois. Le coût est un index déjà posé par la
 * migration 038.
 */
export async function conflitsDeLaManifestation(manifestationId: number): Promise<
  Array<{ occupation: Conflit; conflits: Conflit[] }>
> {
  const siennes = await listerOccupations({
    manifestationId,
    statuts: STATUTS_OCCUPANTS,
  });

  const resultat: Array<{ occupation: Conflit; conflits: Conflit[] }> = [];
  for (const occupation of siennes) {
    const conflits = await conflitsPour({
      siteId: occupation.site_id,
      pieceId: occupation.piece_id,
      debut: occupation.debut,
      fin: occupation.fin,
      ignorerManifestationId: manifestationId,
    });
    if (conflits.length > 0) resultat.push({ occupation, conflits });
  }
  return resultat;
}
