import { db } from '../database';
import { lireDisponibilite, versColonne, type Disponibilite } from './disponibiliteParc.service';

/**
 * Les pièces d'un bâtiment, et ce qui se prête.
 *
 * Le référentiel des lieux tient trois niveaux depuis la migration 037 :
 *
 *   `cle_sites`     le bâtiment — la mairie, l'école, la salle des fêtes
 *   `site_pieces`   la pièce    — la salle des mariages, le hall, la cour
 *   `cle_ouvrants`  l'ouvrant   — la porte principale, la barrière du stade
 *
 * `sites.service.ts` reste la porte d'entrée du niveau bâtiment et explique
 * pourquoi la table s'appelle `cle_sites`. Ce fichier-ci porte le niveau qui
 * lui manquait, et la seule règle qui traverse les trois : qu'est-ce qui se
 * prête.
 *
 * ## Un ouvrant peut n'appartenir à aucune pièce
 *
 * `cle_ouvrants.piece_id` est nullable, et ce n'est pas une facilité. La
 * barrière principale, le portail du stade et le local à poubelles ne sont dans
 * aucune salle. Les forcer dans une pièce fictive « Extérieur » ferait inventer
 * à chaque commune sa propre convention, et la première recherche « où est cette
 * barrière » rendrait une pièce qui n'existe pas.
 *
 * ## Trois états pour `pretable`, et un repli à « non »
 *
 * La mécanique est celle de `disponibiliteParc.service.ts`, dont on réutilise
 * `lireDisponibilite` et `versColonne` plutôt que de les recopier : `NULL` veut
 * dire « suivre le bâtiment ». Sans ce troisième état, ouvrir un bâtiment au
 * prêt obligerait à recocher chacune de ses pièces, et personne ne le ferait.
 *
 * Le **repli** diffère, lui, et délibérément. Voir `expressionPretable`.
 */

export interface Piece {
  id: number;
  siteId: number;
  nom: string;
  code: string | null;
  description: string | null;
  /** Salle, hall, cour, terrain, préau… Libre : sert à filtrer, pas à contraindre. */
  typeLieu: string | null;
  /** Nombre de personnes, pour écarter les salles trop petites. */
  capacite: number | null;
  /** `null` = suivre le bâtiment. */
  pretable: Disponibilite;
  ordre: number;
  actif: boolean;
}

/** Une pièce, avec la réponse déjà calculée à « se prête-t-elle ? ». */
export interface PieceResolue extends Piece {
  pretableEffectif: boolean;
  siteNom: string;
}

export function enPiece(ligne: any): Piece {
  return {
    id: Number(ligne.id),
    siteId: Number(ligne.site_id),
    nom: ligne.name,
    code: ligne.code ?? null,
    description: ligne.description ?? null,
    typeLieu: ligne.type_lieu ?? null,
    capacite: ligne.capacite === null || ligne.capacite === undefined ? null : Number(ligne.capacite),
    pretable: lireDisponibilite(ligne.pretable),
    ordre: Number(ligne.sort_order ?? 0),
    actif: ligne.is_active === undefined || ligne.is_active === null ? true : Boolean(ligne.is_active),
  };
}

/**
 * Fragment SQL rendant le caractère prêtable effectif d'une pièce.
 *
 * Suppose que la requête appelante joint le bâtiment sous l'alias donné.
 *
 * **Le repli est `0`, là où `expressionDisponibilite` replie sur `1`.** Ce n'est
 * pas une incohérence entre deux fichiers voisins, c'est la seule lecture
 * défendable de chacun. Un matériel sans réglage est réputé prêtable parce que
 * le réglage est arrivé après les matériels et ne devait rien changer à ce qui
 * marchait. Aucun lieu n'a jamais été prêtable : replier sur « oui » mettrait
 * d'un coup le centre technique, le local électrique et le cimetière dans la
 * liste des salles à louer, et la première demande de prêt porterait sur la
 * chaufferie. C'est à l'administrateur d'ouvrir ce qui se prête.
 */
export function expressionPretable(aliasPiece = 'p', aliasSite = 's'): string {
  return `COALESCE(${aliasPiece}.pretable, ${aliasSite}.pretable, 0)`;
}

/** Le même calcul, pour un bâtiment pris seul — il n'a pas de niveau au-dessus. */
export function expressionPretableSite(aliasSite = 's'): string {
  return `COALESCE(${aliasSite}.pretable, 0)`;
}

/** La jointure que `expressionPretable` suppose. */
export function jointurePretable(aliasPiece = 'p', aliasSite = 's'): string {
  return `JOIN cle_sites ${aliasSite} ON ${aliasSite}.id = ${aliasPiece}.site_id`;
}

/** Résout en TypeScript ce que `expressionPretable` résout en SQL — même règle, deux langages. */
export function pretableEffectif(pretablePiece: Disponibilite, pretableSite: Disponibilite): boolean {
  if (pretablePiece !== null) return pretablePiece;
  if (pretableSite !== null) return pretableSite;
  return false;
}

/**
 * Le type qui fait d'une pièce une **salle**.
 *
 * La commune raisonne en salles — la salle du conseil, la salle des mariages,
 * la salle du CCAS — et c'est par elles que le formulaire externe propose un
 * lieu. Pas de quatrième niveau pour autant : une salle est une pièce dont le
 * type est « Salle ». Le type reste libre ; seule cette valeur-là est
 * normalisée, parce qu'une « salle » saisie en minuscules disparaîtrait
 * sinon de toutes les listes de salles.
 */
export const TYPE_SALLE = 'Salle';

/** Ramène « salle », « SALLE » ou « Salle » à la forme de référence ; le reste passe tel quel. */
export function normaliserTypeLieu(brut: unknown): string | null {
  const valeur = String(brut ?? '').trim();
  if (!valeur) return null;
  return valeur.toLowerCase() === TYPE_SALLE.toLowerCase() ? TYPE_SALLE : valeur;
}

/** Les pièces d'un bâtiment, les inactives seulement si on les demande. */
export async function listerPieces(
  siteId: number | string,
  inclureInactives = false
): Promise<Piece[]> {
  const lignes = await db.query(
    `SELECT * FROM site_pieces
      WHERE site_id = ? ${inclureInactives ? '' : 'AND is_active = 1'}
      ORDER BY sort_order ASC, name ASC`,
    [siteId]
  );
  return lignes.map(enPiece);
}

export async function lirePiece(id: number | string): Promise<Piece | null> {
  const ligne = await db.queryOne('SELECT * FROM site_pieces WHERE id = ?', [id]);
  return ligne ? enPiece(ligne) : null;
}

/**
 * Les lieux ouverts au prêt — bâtiments entiers et pièces.
 *
 * Un bâtiment prêtable est proposé **en plus** de ses pièces, et non à leur
 * place : on prête la salle des fêtes entière pour un loto, et seulement sa
 * cuisine pour un repas d'association. Les deux sont des réponses légitimes à
 * « quoi réserver », et c'est le conflit hiérarchique qui empêche de les
 * accorder en même temps.
 *
 * `capaciteMinimale` écarte les salles trop petites. Une pièce sans capacité
 * renseignée est **gardée** : l'absence d'information n'est pas une information,
 * et masquer la salle des fêtes parce que personne n'a saisi sa jauge serait le
 * plus sûr moyen de faire abandonner le filtre.
 */
export async function lieuxPretables(
  options: { capaciteMinimale?: number; typeLieu?: string | null } = {}
): Promise<
  Array<{
    siteId: number;
    pieceId: number | null;
    nom: string;
    siteNom: string;
    /** « Salle du conseil — Mairie » : ce que le formulaire affiche tel quel. */
    libelle: string;
    typeLieu: string | null;
    capacite: number | null;
  }>
> {
  const { capaciteMinimale } = options;
  const typeLieu = normaliserTypeLieu(options.typeLieu);

  // Filtrer sur un type écarte les bâtiments entiers : la mairie n'est pas
  // « une salle », même quand elle se prête d'un bloc.
  const batiments = typeLieu ? [] : await db.query(
    `SELECT s.id, s.name
       FROM cle_sites s
      WHERE s.is_active = 1 AND ${expressionPretableSite('s')} = 1
      ORDER BY s.sort_order ASC, s.name ASC`
  );

  const filtreCapacite =
    capaciteMinimale !== undefined && capaciteMinimale !== null
      ? 'AND (p.capacite IS NULL OR p.capacite >= ?)'
      : '';
  const filtreType = typeLieu ? 'AND LOWER(TRIM(p.type_lieu)) = ?' : '';
  const params: any[] = [
    ...(filtreCapacite ? [capaciteMinimale] : []),
    ...(typeLieu ? [typeLieu.toLowerCase()] : []),
  ];

  const pieces = await db.query(
    `SELECT p.id, p.name, p.type_lieu, p.capacite, p.site_id, s.name AS site_name
       FROM site_pieces p
       ${jointurePretable('p', 's')}
      WHERE p.is_active = 1 AND s.is_active = 1
        AND ${expressionPretable('p', 's')} = 1
        ${filtreCapacite}
        ${filtreType}
      ORDER BY s.sort_order ASC, s.name ASC, p.sort_order ASC, p.name ASC`,
    params
  );

  return [
    ...batiments.map((b: any) => ({
      siteId: Number(b.id),
      pieceId: null,
      nom: b.name,
      siteNom: b.name,
      libelle: b.name,
      typeLieu: 'batiment' as string | null,
      capacite: null,
    })),
    ...pieces.map((p: any) => ({
      siteId: Number(p.site_id),
      pieceId: Number(p.id),
      nom: p.name,
      siteNom: p.site_name,
      libelle: `${p.name} — ${p.site_name}`,
      typeLieu: normaliserTypeLieu(p.type_lieu),
      capacite: p.capacite === null || p.capacite === undefined ? null : Number(p.capacite),
    })),
  ];
}

/**
 * Toutes les salles, tous bâtiments confondus — l'onglet « Salles ».
 *
 * `pretableEffectif` est calculé ici, pour que l'écran n'ait pas à refaire la
 * règle d'héritage : une salle « comme le bâtiment » dans une salle des fêtes
 * ouverte au prêt se prête, et le tableau doit le dire.
 */
export async function listerSalles(inclureInactives = false): Promise<
  Array<PieceResolue & { libelle: string }>
> {
  const lignes = await db.query(
    `SELECT p.*, s.name AS site_name, s.pretable AS site_pretable
       FROM site_pieces p
       ${jointurePretable('p', 's')}
      WHERE LOWER(TRIM(p.type_lieu)) = ?
        ${inclureInactives ? '' : 'AND p.is_active = 1 AND s.is_active = 1'}
      ORDER BY s.sort_order ASC, s.name ASC, p.sort_order ASC, p.name ASC`,
    [TYPE_SALLE.toLowerCase()]
  );
  return lignes.map((l: any) => {
    const piece = enPiece(l);
    return {
      ...piece,
      siteNom: l.site_name,
      libelle: `${piece.nom} — ${l.site_name}`,
      pretableEffectif: pretableEffectif(piece.pretable, lireDisponibilite(l.site_pretable)),
    };
  });
}

/**
 * Le référentiel entier : bâtiments, leurs pièces, leurs ouvrants.
 *
 * Trois requêtes — une par niveau — et l'assemblage se fait ici. La forme
 * « une requête par bâtiment pour ses pièces, puis une par pièce pour ses
 * ouvrants » est exactement le motif retiré ailleurs dans ce dépôt : sur douze
 * bâtiments et cent portes, elle fait cent treize allers-retours pour afficher
 * un écran qui n'en demande que trois.
 */
export async function arbreDesLieux(inclureInactifs = false): Promise<any[]> {
  const conditionSite = inclureInactifs ? '' : 'WHERE is_active = 1';

  const [sites, pieces, ouvrants] = await Promise.all([
    db.query(`SELECT * FROM cle_sites ${conditionSite} ORDER BY sort_order ASC, name ASC`),
    db.query(
      `SELECT * FROM site_pieces ${inclureInactifs ? '' : 'WHERE is_active = 1'}
        ORDER BY sort_order ASC, name ASC`
    ),
    db.query('SELECT * FROM cle_ouvrants ORDER BY sort_order ASC, name ASC'),
  ]);

  const ouvrantsParPiece = new Map<number, any[]>();
  const ouvrantsDirects = new Map<number, any[]>();
  for (const o of ouvrants) {
    // Un ouvrant rattaché à une pièce se range sous elle ; sinon il reste au
    // bâtiment. `piece_id` nul est le cas de la barrière et du portail.
    const cible = o.piece_id ? ouvrantsParPiece : ouvrantsDirects;
    const cle = Number(o.piece_id ?? o.site_id);
    if (!cible.has(cle)) cible.set(cle, []);
    cible.get(cle)!.push(o);
  }

  const piecesParSite = new Map<number, any[]>();
  for (const p of pieces) {
    const cle = Number(p.site_id);
    if (!piecesParSite.has(cle)) piecesParSite.set(cle, []);
    piecesParSite.get(cle)!.push(p);
  }

  return sites.map((s: any) => {
    const pretableSite = lireDisponibilite(s.pretable);
    return {
      ...s,
      pretable_effectif: pretableEffectif(null, pretableSite),
      pieces: (piecesParSite.get(Number(s.id)) ?? []).map((p: any) => ({
        ...p,
        pretable_effectif: pretableEffectif(lireDisponibilite(p.pretable), pretableSite),
        ouvrants: ouvrantsParPiece.get(Number(p.id)) ?? [],
      })),
      // Les ouvrants qui ne sont dans aucune pièce, affichés sous le bâtiment.
      ouvrants: ouvrantsDirects.get(Number(s.id)) ?? [],
    };
  });
}

/**
 * Ce qui empêche de supprimer une pièce.
 *
 * Même règle que `usagesSite` : une pièce citée par une clé ou par un ticket ne
 * se supprime pas, parce que la clé deviendrait un bout de métal sans usage
 * connu et le ticket perdrait son lieu. Le refus **porte le nombre**, parce que
 * « 3 clés ouvrent encore cette pièce » dit quoi faire là où « suppression
 * impossible » laisse chercher.
 *
 * Les ouvrants n'y figurent pas : ils ne bloquent rien, ils retombent sur le
 * bâtiment, comme le `ON DELETE SET NULL` de la migration 037 l'organise.
 */
export async function usagesPiece(pieceId: number | string): Promise<{
  tickets: number;
  cles: number;
  ouvrants: number;
  occupations: number;
}> {
  const compter = async (sql: string): Promise<number> => {
    try {
      const ligne = await db.queryOne(sql, [pieceId]);
      return Number(ligne?.cnt ?? 0);
    } catch {
      // Table absente sur une base pas encore migrée : rien à compter.
      return 0;
    }
  };

  return {
    tickets: await compter('SELECT COUNT(*) as cnt FROM tickets WHERE piece_id = ?'),
    cles: await compter('SELECT COUNT(*) as cnt FROM cle_ouvre WHERE piece_id = ?'),
    ouvrants: await compter('SELECT COUNT(*) as cnt FROM cle_ouvrants WHERE piece_id = ?'),
    occupations: await compter('SELECT COUNT(*) as cnt FROM lieu_occupations WHERE piece_id = ?'),
  };
}

/** Enregistre une pièce, et rend son identifiant. */
export async function creerPiece(valeurs: {
  siteId: number;
  nom: string;
  code?: string | null;
  description?: string | null;
  typeLieu?: string | null;
  capacite?: number | null;
  pretable?: unknown;
  ordre?: number;
}): Promise<number> {
  const resultat = await db.execute(
    `INSERT INTO site_pieces (site_id, name, code, description, type_lieu, capacite, pretable, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      valeurs.siteId,
      valeurs.nom,
      valeurs.code || null,
      valeurs.description || null,
      normaliserTypeLieu(valeurs.typeLieu),
      valeurs.capacite ?? null,
      versColonne(lireDisponibilite(valeurs.pretable)),
      valeurs.ordre ?? 0,
    ]
  );
  return Number(resultat.lastInsertRowid);
}

/** Met à jour une pièce. Les champs absents ne sont pas touchés. */
export async function modifierPiece(
  id: number | string,
  valeurs: {
    nom?: string;
    code?: string | null;
    description?: string | null;
    typeLieu?: string | null;
    capacite?: number | null;
    pretable?: unknown;
    ordre?: number;
    actif?: boolean;
  }
): Promise<void> {
  const champs: string[] = [];
  const params: any[] = [];

  const poser = (colonne: string, valeur: any) => {
    champs.push(`${colonne} = ?`);
    params.push(valeur);
  };

  if (valeurs.nom !== undefined) poser('name', valeurs.nom);
  if (valeurs.code !== undefined) poser('code', valeurs.code || null);
  if (valeurs.description !== undefined) poser('description', valeurs.description || null);
  if (valeurs.typeLieu !== undefined) poser('type_lieu', normaliserTypeLieu(valeurs.typeLieu));
  if (valeurs.capacite !== undefined) poser('capacite', valeurs.capacite ?? null);
  // `pretable` traverse `lireDisponibilite` : une chaîne vide venue du
  // formulaire doit devenir `NULL` (« hérite ») et non `0` (« non »).
  if (valeurs.pretable !== undefined) poser('pretable', versColonne(lireDisponibilite(valeurs.pretable)));
  if (valeurs.ordre !== undefined) poser('sort_order', valeurs.ordre);
  if (valeurs.actif !== undefined) poser('is_active', valeurs.actif ? 1 : 0);

  if (champs.length === 0) return;

  params.push(id);
  await db.execute(`UPDATE site_pieces SET ${champs.join(', ')} WHERE id = ?`, params);
}
