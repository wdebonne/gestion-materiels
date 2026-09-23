import { db } from '../database';
import { normaliserLibelle } from '../utils/normaliserLibelle';

/**
 * Rapprocher les lieux d'une demande du référentiel de la commune.
 *
 * Le formulaire envoie ses salles en une phrase, et le module de réception la
 * conserve telle quelle depuis la migration 029 :
 *
 *     « Mairie : Salle des mariages ; Maison Pour Tous : Le hall »
 *
 * C'est `texteLisible` qui produit cette forme, dans
 * `manifestationIntake.service.ts` : les répétitions se séparent au
 * point-virgule, et ce qui va ensemble à l'intérieur d'une répétition au
 * deux-points, « pour ne plus perdre quelle salle appartient à quel bâtiment ».
 * On relit donc exactement ce que l'autre a écrit.
 *
 * ## Ce qui n'est pas reconnu n'est pas perdu
 *
 * C'est la règle du module, et elle prime sur l'envie d'automatiser. Un
 * rapprochement raté rend le libellé d'origine dans `nonReconnus`, et l'appelant
 * le laisse dans `intake_details`, intact, pour que l'agent le lise et l'apparie
 * à la main. Écraser une réponse parce qu'on n'a pas su la comprendre serait
 * exactement ce que la migration 029 a été écrite pour empêcher.
 *
 * ## Trois degrés de certitude, et pas de devinette
 *
 * `exact` le libellé normalisé est le même — « Salle des Mariages » et
 *             « salle des mariages »
 * `partiel` l'un contient l'autre — « Le hall » trouve « Hall »
 * rien      on ne propose pas : un rapprochement plausible et faux réserve
 *             une salle qui n'était pas demandée, et personne ne s'en aperçoit
 *             avant le jour même.
 */

export interface LieuReference {
  siteId: number;
  siteNom: string;
  pieceId: number | null;
  pieceNom: string | null;
}

export interface LieuRapproche extends LieuReference {
  /** Ce que le formulaire disait, gardé pour que l'écran puisse le montrer. */
  libelle: string;
  confiance: 'exact' | 'partiel';
}

export interface Rapprochement {
  trouves: LieuRapproche[];
  nonReconnus: string[];
}

/** Une entrée du formulaire : un bâtiment, une pièce, ou les deux. */
export interface EntreeLieu {
  batiment: string | null;
  piece: string | null;
}

/**
 * Découpe la phrase du formulaire en entrées.
 *
 * Fonction pure, sans base : c'est elle qui porte les surprises du terrain — un
 * séparateur doublé, une entrée vide, un deux-points dans un nom — et elle se
 * teste sans monter de référentiel.
 *
 * Une entrée sans deux-points est **ambiguë** : « Salle des fêtes » peut nommer
 * un bâtiment comme une pièce. On ne tranche pas ici ; on la range dans `piece`
 * et le rapprochement essaiera les deux.
 */
export function decouperLieux(texte: unknown): EntreeLieu[] {
  const brut = String(texte ?? '').trim();
  if (!brut) return [];

  return brut
    .split(/[;\n]+/)
    .map((morceau) => morceau.trim())
    .filter(Boolean)
    .map((morceau) => {
      // Un seul découpage, sur le premier deux-points : « Mairie : Salle B : 2 »
      // nomme un bâtiment et une pièce dont le nom contient un deux-points.
      const separateur = morceau.indexOf(':');
      if (separateur === -1) return { batiment: null, piece: morceau };

      const batiment = morceau.slice(0, separateur).trim();
      const piece = morceau.slice(separateur + 1).trim();
      return { batiment: batiment || null, piece: piece || null };
    })
    .filter((entree) => entree.batiment || entree.piece);
}

/** Le référentiel à plat, tel que le rapprochement le consulte. */
export async function referentielAPlat(): Promise<LieuReference[]> {
  const lignes = await db.query(
    `SELECT s.id AS site_id, s.name AS site_name, p.id AS piece_id, p.name AS piece_name
       FROM cle_sites s
       LEFT JOIN site_pieces p ON p.site_id = s.id AND p.is_active = 1
      WHERE s.is_active = 1
      ORDER BY s.sort_order ASC, s.name ASC`
  );

  return lignes.map((l: any) => ({
    siteId: Number(l.site_id),
    siteNom: l.site_name,
    pieceId: l.piece_id === null || l.piece_id === undefined ? null : Number(l.piece_id),
    pieceNom: l.piece_name ?? null,
  }));
}

/** Deux libellés se rejoignent-ils, et à quel degré ? */
function comparer(attendu: string, propose: string): 'exact' | 'partiel' | null {
  const a = normaliserLibelle(attendu);
  const b = normaliserLibelle(propose);
  if (!a || !b) return null;
  if (a === b) return 'exact';
  // Assez long pour que « le hall » trouve « hall » sans que « a » trouve tout.
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return 'partiel';
  return null;
}

/** La plus faible des deux certitudes : un rapprochement ne vaut que par son maillon faible. */
const moindre = (a: 'exact' | 'partiel', b: 'exact' | 'partiel'): 'exact' | 'partiel' =>
  a === 'exact' && b === 'exact' ? 'exact' : 'partiel';

/**
 * Apparie une entrée au référentiel.
 *
 * L'ordre des tentatives suit ce qui est le plus sûr :
 *
 *   1. bâtiment **et** pièce nommés → on exige les deux, et la pièce doit
 *      appartenir à ce bâtiment-là. Sans cette condition, « Mairie : Hall »
 *      attraperait le hall de la salle des fêtes ;
 *   2. un seul libellé → on essaie d'abord la **pièce**, parce qu'un formulaire
 *      qui ne nomme qu'un lieu nomme presque toujours la salle ;
 *   3. puis le **bâtiment**, pour « Salle des fêtes » prise en entier.
 */
function apparier(entree: EntreeLieu, referentiel: LieuReference[]): LieuRapproche | null {
  const libelle = [entree.batiment, entree.piece].filter(Boolean).join(' : ');

  if (entree.batiment && entree.piece) {
    const candidats = referentiel
      .filter((r) => r.pieceId !== null)
      .map((r) => {
        const surBatiment = comparer(r.siteNom, entree.batiment!);
        const surPiece = comparer(r.pieceNom ?? '', entree.piece!);
        return surBatiment && surPiece ? { r, confiance: moindre(surBatiment, surPiece) } : null;
      })
      .filter(Boolean) as Array<{ r: LieuReference; confiance: 'exact' | 'partiel' }>;

    const retenu = candidats.find((c) => c.confiance === 'exact') ?? candidats[0];
    if (retenu) return { ...retenu.r, libelle, confiance: retenu.confiance };

    // Le bâtiment est peut-être connu même si la salle ne l'est pas : on ne
    // rapproche pas pour autant. Réserver la mairie entière quand la demande
    // visait une salle bloquerait tout le bâtiment sans que personne l'ait
    // voulu.
    return null;
  }

  const seul = entree.piece ?? entree.batiment;
  if (!seul) return null;

  const pieces = referentiel
    .filter((r) => r.pieceId !== null)
    .map((r) => ({ r, confiance: comparer(r.pieceNom ?? '', seul) }))
    .filter((c) => c.confiance) as Array<{ r: LieuReference; confiance: 'exact' | 'partiel' }>;

  const piece = pieces.find((c) => c.confiance === 'exact') ?? pieces[0];
  if (piece) return { ...piece.r, libelle, confiance: piece.confiance };

  const batiments = referentiel
    .map((r) => ({ r, confiance: comparer(r.siteNom, seul) }))
    .filter((c) => c.confiance) as Array<{ r: LieuReference; confiance: 'exact' | 'partiel' }>;

  const batiment = batiments.find((c) => c.confiance === 'exact') ?? batiments[0];
  if (batiment) {
    // Le bâtiment entier : on oublie la pièce que portait la ligne du
    // référentiel, qui n'était là que pour la jointure.
    return {
      siteId: batiment.r.siteId,
      siteNom: batiment.r.siteNom,
      pieceId: null,
      pieceNom: null,
      libelle,
      confiance: batiment.confiance,
    };
  }

  return null;
}

/**
 * Rapproche la phrase du formulaire du référentiel.
 *
 * Les doublons sont écartés : « Mairie : Hall » et « Hall » désignent le même
 * lieu, et poser deux créneaux identiques ferait une salle en conflit avec
 * elle-même.
 */
export function rapprocherDansReferentiel(
  texte: unknown,
  referentiel: LieuReference[]
): Rapprochement {
  const trouves: LieuRapproche[] = [];
  const nonReconnus: string[] = [];
  const vus = new Set<string>();

  for (const entree of decouperLieux(texte)) {
    const apparie = apparier(entree, referentiel);
    if (!apparie) {
      nonReconnus.push([entree.batiment, entree.piece].filter(Boolean).join(' : '));
      continue;
    }

    const cle = `${apparie.siteId}:${apparie.pieceId ?? ''}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    trouves.push(apparie);
  }

  return { trouves, nonReconnus };
}

/** La même chose, en allant chercher le référentiel. */
export async function rapprocherLieux(texte: unknown): Promise<Rapprochement> {
  return rapprocherDansReferentiel(texte, await referentielAPlat());
}
