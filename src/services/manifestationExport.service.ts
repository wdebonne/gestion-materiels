import ExcelJS from 'exceljs';
import { db } from '../database';
import { grouperEnfants, enfantsDe } from '../utils/batchQuery';

/**
 * Export des manifestations en feuille de calcul.
 *
 * Le suivi se partage par fichier : une feuille déposée sur un Nextcloud, que
 * plusieurs services consultent et annotent. Elle était tenue à la main, donc
 * périmée dès qu'un statut changeait.
 *
 * Les colonnes sont **configurables** — quelles données, dans quel ordre, sous
 * quel intitulé. Chaque collectivité range son tableau à sa façon, et redemander
 * un développeur à chaque changement de colonne serait absurde. C'est le même
 * choix que pour l'import, dont ce module reprend la forme des définitions.
 */

export type ChampExport =
  | 'id'
  | 'title'
  | 'status'
  | 'date_start'
  | 'date_end'
  | 'start_time'
  | 'end_time'
  | 'delivery_date'
  | 'recovery_date'
  | 'delivery_address'
  | 'contact_name'
  | 'contact_phone'
  | 'contact_email'
  | 'expected_people'
  | 'created_by_name'
  | 'materials_requested'
  | 'materials_delivered'
  | 'materials_recovered'
  | 'materials_lost'
  | 'materials_detail'
  | 'approvals'
  | 'approvals_pending'
  | 'notes'
  | 'updated_at';

export interface DefinitionExport {
  champ: ChampExport;
  /** Intitulé par défaut de la colonne, modifiable par profil. */
  libelle: string;
  largeur: number;
}

/** Ordre de référence, utilisé quand un profil ne dit rien. */
export const CHAMPS_EXPORT: DefinitionExport[] = [
  { champ: 'id', libelle: 'N°', largeur: 8 },
  { champ: 'title', libelle: 'Manifestation', largeur: 32 },
  { champ: 'status', libelle: 'Statut', largeur: 14 },
  { champ: 'date_start', libelle: 'Date', largeur: 12 },
  { champ: 'date_end', libelle: 'Date de fin', largeur: 12 },
  { champ: 'start_time', libelle: 'Début', largeur: 8 },
  { champ: 'end_time', libelle: 'Fin', largeur: 8 },
  { champ: 'delivery_date', libelle: 'Livraison', largeur: 12 },
  { champ: 'recovery_date', libelle: 'Récupération', largeur: 13 },
  { champ: 'delivery_address', libelle: 'Lieu de livraison', largeur: 30 },
  { champ: 'contact_name', libelle: 'Contact', largeur: 22 },
  { champ: 'contact_phone', libelle: 'Téléphone', largeur: 15 },
  { champ: 'contact_email', libelle: 'Courriel', largeur: 26 },
  { champ: 'expected_people', libelle: 'Personnes attendues', largeur: 12 },
  { champ: 'created_by_name', libelle: 'Demandeur', largeur: 22 },
  { champ: 'materials_requested', libelle: 'Demandé', largeur: 10 },
  { champ: 'materials_delivered', libelle: 'Livré', largeur: 10 },
  { champ: 'materials_recovered', libelle: 'Récupéré', largeur: 10 },
  { champ: 'materials_lost', libelle: 'Perdu', largeur: 10 },
  { champ: 'materials_detail', libelle: 'Détail du matériel', largeur: 45 },
  { champ: 'approvals', libelle: 'Approbations', largeur: 40 },
  { champ: 'approvals_pending', libelle: 'En attente de', largeur: 28 },
  { champ: 'notes', libelle: 'Notes', largeur: 35 },
  { champ: 'updated_at', libelle: 'Dernière modification', largeur: 18 },
];

/** Une colonne d'un profil : quel champ, sous quel intitulé. */
export interface ColonneProfil {
  champ: ChampExport;
  entete?: string;
}

export interface FiltresExport {
  status?: string;
  date_from?: string;
  date_to?: string;
  /** Inclure les manifestations archivées, exclues par défaut. */
  archived?: boolean;
}

const LIBELLES_STATUT: Record<string, string> = {
  pending: 'À confirmer',
  draft: 'Brouillon',
  validated: 'Validée',
  delivered: 'Livrée',
  recovered: 'Récupérée',
  archived: 'Archivée',
  cancelled: 'Annulée',
};

const LIBELLES_DECISION: Record<string, string> = {
  pending: 'en attente',
  approved: 'approuvé',
  rejected: 'refusé',
  not_concerned: 'non concerné',
};

/**
 * Colonnes à produire : celles du profil, sinon toutes, dans l'ordre de
 * référence. Un champ inconnu — profil enregistré avant une évolution du code —
 * est ignoré plutôt que de faire échouer l'export entier.
 */
export function resoudreColonnes(colonnes?: ColonneProfil[] | null): DefinitionExport[] {
  if (!colonnes || colonnes.length === 0) return CHAMPS_EXPORT;

  return colonnes
    .map((colonne) => {
      const definition = CHAMPS_EXPORT.find((d) => d.champ === colonne.champ);
      if (!definition) return null;
      return { ...definition, libelle: colonne.entete?.trim() || definition.libelle };
    })
    .filter((d): d is DefinitionExport => d !== null);
}

/** Manifestations à exporter, avec leur matériel et leurs approbations. */
async function lireDonnees(filtres: FiltresExport): Promise<any[]> {
  let sql = `
    SELECT m.*, (u.first_name || ' ' || u.last_name) as created_by_name
    FROM manifestations m
    LEFT JOIN users u ON u.id = m.created_by
    WHERE 1=1
  `;
  const params: any[] = [];

  if (filtres.status) {
    sql += ' AND m.status = ?';
    params.push(filtres.status);
  } else if (!filtres.archived) {
    sql += " AND m.status != 'archived'";
  }
  if (filtres.date_from) {
    sql += ' AND m.date_start >= ?';
    params.push(filtres.date_from);
  }
  if (filtres.date_to) {
    sql += ' AND m.date_start <= ?';
    params.push(filtres.date_to);
  }
  sql += ' ORDER BY m.date_start DESC, m.id DESC';

  const manifestations = await db.query(sql, params);
  if (manifestations.length === 0) return [];

  const ids = manifestations.map((m: any) => m.id);

  // Deux requêtes groupées plutôt que deux par manifestation : c'est la règle
  // déjà posée par `grouperEnfants` sur les fiches et les listes.
  const [materiels, approbations] = await Promise.all([
    grouperEnfants(
      (marqueurs) => `
        SELECT mm.*, ms.name as stock_name, ms.unit
        FROM manifestation_materials mm
        JOIN manifestation_stock ms ON ms.id = mm.stock_id
        WHERE mm.manifestation_id IN (${marqueurs})
      `,
      ids,
      'manifestation_id'
    ),
    grouperEnfants(
      (marqueurs) => `
        SELECT a.manifestation_id, a.status, a.kind, s.name as service_name
        FROM manifestation_approvals a
        LEFT JOIN services s ON s.id = a.service_id
        WHERE a.manifestation_id IN (${marqueurs})
      `,
      ids,
      'manifestation_id'
    ),
  ]);

  return manifestations.map((m: any) => ({
    ...m,
    materials: enfantsDe<any>(materiels, m.id),
    approvals: enfantsDe<any>(approbations, m.id),
  }));
}

const somme = (lignes: any[], champ: string): number =>
  lignes.reduce((total, ligne) => total + (Number(ligne[champ]) || 0), 0);

/** Valeur d'un champ pour une manifestation, prête à écrire dans une cellule. */
export function valeurDe(manifestation: any, champ: ChampExport): string | number {
  const materiels: any[] = manifestation.materials ?? [];
  const approbations: any[] = manifestation.approvals ?? [];

  switch (champ) {
    case 'status':
      return LIBELLES_STATUT[manifestation.status] ?? manifestation.status;

    case 'materials_requested':
      return somme(materiels, 'quantity_requested');
    case 'materials_delivered':
      return somme(materiels, 'quantity_delivered');
    case 'materials_recovered':
      return somme(materiels, 'quantity_recovered');
    case 'materials_lost':
      return somme(materiels, 'quantity_lost');

    case 'materials_detail':
      // Une ligne par article, lisible sans décodeur : « 50 × Chaise ».
      return materiels
        .map((mat) => `${mat.quantity_requested} × ${mat.stock_name}`)
        .join('\n');

    case 'approvals':
      return approbations
        .map((a) => `${a.service_name ?? 'Destinataire'} : ${LIBELLES_DECISION[a.status] ?? a.status}`)
        .join('\n');

    case 'approvals_pending':
      return approbations
        .filter((a) => a.kind === 'approbation' && a.status === 'pending')
        .map((a) => a.service_name ?? 'Destinataire')
        .join(', ');

    case 'notes':
      return [manifestation.notes_interior, manifestation.notes_exterior]
        .filter(Boolean)
        .join('\n');

    case 'updated_at':
      return manifestation.updated_at
        ? new Date(manifestation.updated_at).toLocaleString('fr-FR')
        : '';

    default: {
      const valeur = manifestation[champ];
      if (valeur === null || valeur === undefined) return '';
      // Les dates sont stockées en ISO : on ne garde que le jour, seul utile
      // dans un tableau de suivi.
      if (typeof valeur === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(valeur)) {
        return valeur.split('T')[0];
      }
      return valeur;
    }
  }
}

export interface ResultatExport {
  contenu: Buffer;
  lignes: number;
  nomFichier: string;
}

/**
 * Produit le classeur.
 *
 * Une seule feuille, une ligne par manifestation. Le détail du matériel tient
 * dans une cellule à retours à la ligne plutôt qu'en lignes multiples : le
 * fichier sert à filtrer et à trier, ce qu'un tableau à lignes fusionnées rend
 * impraticable.
 */
export async function genererClasseur(
  colonnes?: ColonneProfil[] | null,
  filtres: FiltresExport = {}
): Promise<ResultatExport> {
  const definitions = resoudreColonnes(colonnes);
  const donnees = await lireDonnees(filtres);

  const classeur = new ExcelJS.Workbook();
  classeur.creator = 'Gestion Matériels';
  classeur.created = new Date();

  const feuille = classeur.addWorksheet('Manifestations');
  feuille.columns = definitions.map((d) => ({ header: d.libelle, key: d.champ, width: d.largeur }));

  feuille.getRow(1).font = { bold: true };
  feuille.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF3F4F6' },
  };

  for (const manifestation of donnees) {
    const ligne: Record<string, string | number> = {};
    for (const definition of definitions) {
      ligne[definition.champ] = valeurDe(manifestation, definition.champ);
    }
    feuille.addRow(ligne);
  }

  // Le détail du matériel et les approbations contiennent des retours à la
  // ligne : sans cet alignement, ils s'affichent sur une seule ligne tronquée.
  feuille.eachRow({ includeEmpty: false }, (ligne) => {
    ligne.alignment = { vertical: 'top', wrapText: true };
  });
  feuille.views = [{ state: 'frozen', ySplit: 1 }];
  feuille.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: definitions.length },
  };

  const contenu = Buffer.from(await classeur.xlsx.writeBuffer());

  return {
    contenu,
    lignes: donnees.length,
    nomFichier: `manifestations_${new Date().toISOString().split('T')[0]}.xlsx`,
  };
}

export const TYPE_MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
