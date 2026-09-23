import { db } from '../database';
import { tirerJeton } from '../utils/jetonOpaque';
import { versFluxICS, type EvenementICal } from './agendasExternes.service';
import { conflitsPour } from './occupationLieux.service';
import { versDateTime } from './tickets.service';

/**
 * L'agenda d'une salle, publié à qui on en donne l'adresse.
 *
 * Le régisseur, l'élu aux associations et l'amicale qui occupe le préau tous
 * les mardis ne se connecteront pas à l'application pour savoir si la salle est
 * libre : ils ont déjà un agenda, et c'est là qu'ils regardent. Un flux iCal
 * s'y colle une fois et se tient à jour tout seul.
 *
 * ## Un jeton long, parce qu'il n'est pas imprimé
 *
 * `cle_jetons` tient huit caractères parce qu'il finit sur une étiquette Avery
 * de dix millimètres, où un QR plus dense cesserait d'être lisible. Ici il n'y a
 * pas d'étiquette : l'URL se copie-colle dans un champ d'agenda. On prend donc
 * vingt-deux caractères, soit plus de cent bits, parce que cette adresse ouvre
 * un flux de données là où celle du trousseau n'ouvre qu'une page qui ne dit
 * presque rien.
 *
 * ## Révoqué vaut inconnu
 *
 * Un jeton révoqué rend `null`, et la route répond 404 — jamais 403. Une URL
 * retirée doit disparaître, pas annoncer qu'elle a existé : « accès refusé »
 * confirmerait à qui l'a gardée que la salle existe et qu'il avait bien l'adresse.
 */

/** Vingt-deux caractères sur trente et un symboles : ~109 bits. */
const LONGUEUR_JETON_AGENDA = 22;

export interface JetonAgenda {
  id: number;
  site_id: number;
  piece_id: number | null;
  token: string;
  label: string | null;
  revoked_at: string | null;
  created_at: string | null;
  site_name?: string | null;
  piece_name?: string | null;
}

/** Les abonnements d'un lieu, révoqués compris — l'écran les montre grisés. */
export async function jetonsDuLieu(
  siteId: number | string,
  pieceId?: number | string | null
): Promise<JetonAgenda[]> {
  const conditions = ['j.site_id = ?'];
  const params: any[] = [siteId];

  if (pieceId === null || pieceId === undefined) {
    conditions.push('j.piece_id IS NULL');
  } else {
    conditions.push('j.piece_id = ?');
    params.push(pieceId);
  }

  return db.query<JetonAgenda>(
    `SELECT j.*, s.name AS site_name, p.name AS piece_name
       FROM lieu_jetons j
       LEFT JOIN cle_sites s ON s.id = j.site_id
       LEFT JOIN site_pieces p ON p.id = j.piece_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY j.created_at DESC`,
    params
  );
}

/** Tous les abonnements d'un bâtiment, ses pièces comprises — pour l'écran de partage. */
export async function jetonsDuSite(siteId: number | string): Promise<JetonAgenda[]> {
  return db.query<JetonAgenda>(
    `SELECT j.*, s.name AS site_name, p.name AS piece_name
       FROM lieu_jetons j
       LEFT JOIN cle_sites s ON s.id = j.site_id
       LEFT JOIN site_pieces p ON p.id = j.piece_id
      WHERE j.site_id = ?
      ORDER BY j.revoked_at IS NULL DESC, j.created_at DESC`,
    [siteId]
  );
}

/**
 * Ouvre un abonnement.
 *
 * Un jeton par destinataire : retirer l'accès à une association ne doit pas
 * casser celui du régisseur. `label` dit à qui l'adresse a été donnée — sans
 * lui, la liste est une colonne de jetons illisibles dont plus personne n'ose
 * retirer aucun.
 */
export async function creerJetonAgenda(valeurs: {
  siteId: number;
  pieceId?: number | null;
  label?: string | null;
  creePar?: number | null;
}): Promise<JetonAgenda> {
  // La collision est traitée en réessayant : à cent bits elle est hors
  // d'atteinte, mais l'unicité est tenue par la base et non par l'espérance.
  for (let essai = 0; essai < 5; essai += 1) {
    const token = tirerJeton(LONGUEUR_JETON_AGENDA);
    try {
      const resultat = await db.execute(
        'INSERT INTO lieu_jetons (site_id, piece_id, token, label, created_by) VALUES (?, ?, ?, ?, ?)',
        [
          valeurs.siteId,
          valeurs.pieceId ?? null,
          token,
          valeurs.label?.trim() || null,
          valeurs.creePar ?? null,
        ]
      );
      return {
        id: Number(resultat.lastInsertRowid),
        site_id: valeurs.siteId,
        piece_id: valeurs.pieceId ?? null,
        token,
        label: valeurs.label?.trim() || null,
        revoked_at: null,
        created_at: null,
      };
    } catch (erreur: any) {
      if (essai === 4) throw erreur;
    }
  }
  throw new Error('Impossible de tirer un jeton d’agenda');
}

/** Retire un abonnement, sans effacer la trace de son existence. */
export async function revoquerJetonAgenda(id: number | string): Promise<void> {
  // `versDateTime` et non `toISOString` : les horodatages de ce dépôt sont
  // locaux, et mêler les deux ferait qu'une révocation paraîtrait faite deux
  // heures plus tôt que la ligne d'à côté.
  await db.execute('UPDATE lieu_jetons SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [
    versDateTime(),
    id,
  ]);
}

/** Le lieu derrière un jeton, ou `null` si le jeton est inconnu ou révoqué. */
export async function lieuDuJeton(token: string): Promise<JetonAgenda | null> {
  if (!token) return null;
  return db.queryOne<JetonAgenda>(
    `SELECT j.*, s.name AS site_name, p.name AS piece_name
       FROM lieu_jetons j
       LEFT JOIN cle_sites s ON s.id = j.site_id
       LEFT JOIN site_pieces p ON p.id = j.piece_id
      WHERE j.token = ? AND j.revoked_at IS NULL`,
    [token]
  );
}

/**
 * L'identifiant iCalendar d'une occupation.
 *
 * Stable entre deux passages, et propre aux occupations de lieu : sans lui,
 * chaque rafraîchissement créerait des doublons — le piège que documente déjà
 * `uidDe` pour les événements du parc — et un abonné aux deux flux verrait les
 * uns écraser les autres si l'espace de noms était partagé.
 */
export const uidOccupation = (id: number): string => `lieu-occupation-${id}@gestion-materiels`;

/**
 * Le flux d'un lieu, prêt à être servi.
 *
 * Les occupations `annule` n'y sont pas : un créneau retiré doit disparaître de
 * l'agenda de l'abonné, et l'y laisser en le marquant « annulé » ferait qu'on
 * continue de croire la salle prise.
 *
 * Une fenêtre bornée plutôt que tout l'historique : un agenda qui republie cinq
 * ans d'occupations à chaque rafraîchissement coûte cher aux deux bouts, et
 * personne ne consulte l'an dernier dans son téléphone.
 */
export async function fluxDuLieu(
  jeton: JetonAgenda,
  options: { moisEnArriere?: number; moisEnAvant?: number } = {}
): Promise<string> {
  const maintenant = new Date();
  const borne = (decalageMois: number) => {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() + decalageMois, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;
  };

  /*
   * `conflitsPour` plutôt qu'un filtre à plat, parce que l'agenda d'une salle
   * doit dire quand elle est **réellement** indisponible. Si la mairie entière
   * est prise pour les élections, la salle des mariages l'est aussi : un filtre
   * `piece_id = ?` l'afficherait libre ce jour-là, et quelqu'un la promettrait.
   *
   * C'est la même règle hiérarchique que celle du refus à l'enregistrement, et
   * c'est bien l'intérêt de l'appeler ici plutôt que de la réécrire : l'agenda
   * publié et le serveur ne peuvent pas se contredire.
   *
   * Un jeton de bâtiment (`piece_id` nul) ramène tout le bâtiment, pièces
   * comprises — ce que veut le gardien d'une école.
   */
  const occupations = await conflitsPour({
    siteId: jeton.site_id,
    pieceId: jeton.piece_id ?? null,
    debut: borne(-(options.moisEnArriere ?? 3)),
    fin: borne(options.moisEnAvant ?? 18),
  });

  const nom = jeton.piece_name
    ? `${jeton.piece_name} — ${jeton.site_name}`
    : (jeton.site_name ?? 'Agenda du lieu');

  return versFluxICS(
    occupations.map((o) => ({
      uid: uidOccupation(o.id),
      evenement: {
        title: o.statut === 'demande' ? `[À confirmer] ${o.titre}` : o.titre,
        start_date: o.debut,
        end_date: o.fin,
        location: o.piece_name ? `${o.piece_name}, ${o.site_name}` : o.site_name,
        description: null,
      } as EvenementICal,
    })),
    nom
  );
}
