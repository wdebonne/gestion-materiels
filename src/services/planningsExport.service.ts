import ExcelJS from 'exceljs';
import { Bornes, enHeuresDecimales, formaterDuree, jourCourant } from '../utils/periodes';
import { Perimetre, Tache, listerTaches } from './plannings.service';
import { FiltresRapport, Rapport, construireRapport } from './planningsRapport.service';

/**
 * Le rapport, sous une forme qu'on peut emporter.
 *
 * Deux feuilles, parce que les deux usages sont différents : « Détail » pour
 * qui veut refaire le calcul ou retrouver une journée, « Synthèse » pour qui
 * doit projeter une répartition en réunion. Un seul onglet obligerait le
 * premier à masquer des colonnes et le second à faire un tableau croisé.
 *
 * Une ligne du détail est une **contribution**, pas une tâche : la tâche de
 * deux heures à laquelle un collègue a prêté trente minutes en produit deux,
 * qui portent le même identifiant de tâche. C'est la seule forme où la somme
 * de la colonne « Durée » vaut le temps total mobilisé — et où filtrer sur la
 * colonne « Personne » redonne le temps de quelqu'un.
 *
 * Les colonnes sont déclarées en données et non en code, comme celles des
 * manifestations : c'est ce qui permettra plus tard d'en choisir un
 * sous-ensemble sans toucher à la génération.
 */

export interface LigneExport {
  tacheId: number;
  jour: string;
  heureDebut: string;
  heureFin: string;
  personne: string;
  role: string;
  minutes: number;
  heures: number;
  duree: string;
  categorie: string;
  manifestation: string;
  description: string;
}

export interface DefinitionExport {
  champ: keyof LigneExport;
  libelle: string;
  largeur: number;
}

export const CHAMPS_EXPORT: DefinitionExport[] = [
  { champ: 'jour', libelle: 'Date', largeur: 12 },
  { champ: 'heureDebut', libelle: 'Début', largeur: 8 },
  { champ: 'heureFin', libelle: 'Fin', largeur: 8 },
  { champ: 'personne', libelle: 'Personne', largeur: 26 },
  { champ: 'role', libelle: 'Rôle', largeur: 12 },
  { champ: 'duree', libelle: 'Durée', largeur: 10 },
  { champ: 'heures', libelle: 'Heures', largeur: 9 },
  { champ: 'categorie', libelle: 'Catégorie', largeur: 26 },
  { champ: 'manifestation', libelle: 'Manifestation', largeur: 26 },
  { champ: 'description', libelle: 'Description', largeur: 40 },
  { champ: 'tacheId', libelle: 'N° tâche', largeur: 10 },
];

export interface ResultatExport {
  contenu: Buffer;
  lignes: number;
  nomFichier: string;
}

export const TYPE_MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const SANS_CATEGORIE = 'Sans catégorie';

/**
 * Déplie les tâches en contributions.
 *
 * Le titulaire d'abord, puis ses renforts : c'est l'ordre dans lequel on lit
 * une tâche, et il garde groupées les lignes d'un même numéro.
 */
export function enLignesExport(taches: Tache[]): LigneExport[] {
  const lignes: LigneExport[] = [];

  for (const tache of taches) {
    const socle = {
      tacheId: tache.id,
      jour: tache.jour,
      heureDebut: tache.heureDebut ?? '',
      heureFin: tache.heureFin ?? '',
      categorie: tache.categorie?.nom ?? SANS_CATEGORIE,
      manifestation: tache.manifestation?.titre ?? '',
      description: tache.description ?? '',
    };

    lignes.push({
      ...socle,
      personne: tache.titulaire.nom,
      role: 'Titulaire',
      minutes: tache.minutes,
      heures: enHeuresDecimales(tache.minutes),
      duree: formaterDuree(tache.minutes),
    });

    for (const renfort of tache.participants) {
      lignes.push({
        ...socle,
        personne: renfort.personne?.nom ?? renfort.libelle ?? 'Renfort non nommé',
        role: renfort.personne ? 'Renfort' : 'Renfort non nommé',
        minutes: renfort.minutes,
        heures: enHeuresDecimales(renfort.minutes),
        duree: formaterDuree(renfort.minutes),
        // Les horaires du renfort ne sont pas connus : seule sa durée l'est.
        // Recopier ceux de la tâche laisserait croire qu'il était là de bout
        // en bout, ce qui est faux dès qu'il s'agit d'un soutien partiel.
        heureDebut: '',
        heureFin: '',
      });
    }
  }

  return lignes;
}

async function rassembler(
  bornes: Bornes,
  filtres: Omit<FiltresRapport, 'debut' | 'fin'>,
  perimetre: Perimetre
): Promise<{ lignes: LigneExport[]; rapport: Rapport }> {
  const [taches, rapport] = await Promise.all([
    listerTaches({ ...bornes, ...filtres }, perimetre),
    construireRapport(bornes, filtres, perimetre),
  ]);

  let lignes = enLignesExport(taches);

  // Sur la mesure « personne », le fichier ne doit contenir que les lignes de
  // cette personne : sinon la somme de sa colonne « Heures » ne correspondrait
  // plus au total affiché à l'écran, et c'est le fichier qu'on croirait.
  if (filtres.mesure === 'personne' && filtres.personneId != null) {
    const nomsRetenus = new Set(
      rapport.parPersonne.filter((p) => p.id === Number(filtres.personneId)).map((p) => p.libelle)
    );
    lignes = lignes.filter((l) => nomsRetenus.has(l.personne));
  }

  return { lignes, rapport };
}

export async function genererClasseur(
  bornes: Bornes,
  filtres: Omit<FiltresRapport, 'debut' | 'fin'>,
  perimetre: Perimetre
): Promise<ResultatExport> {
  const { lignes, rapport } = await rassembler(bornes, filtres, perimetre);

  const classeur = new ExcelJS.Workbook();
  classeur.creator = 'Gestion Matériels';
  classeur.created = new Date();

  // ------------------------------------------------------------- synthèse

  const synthese = classeur.addWorksheet('Synthèse');
  synthese.columns = [
    { header: 'Catégorie', key: 'categorie', width: 32 },
    { header: 'Durée', key: 'duree', width: 12 },
    { header: 'Heures', key: 'heures', width: 10 },
    { header: 'Part', key: 'part', width: 10 },
  ];

  synthese.spliceRows(1, 0, [rapport.periode.libelle], [
    rapport.mesure === 'mobilise' ? 'Temps total mobilisé' : 'Temps de la personne',
  ], []);
  synthese.getRow(1).font = { bold: true, size: 14 };

  for (const part of rapport.parCategorie) {
    synthese.addRow({
      categorie: part.libelle,
      duree: formaterDuree(part.minutes),
      heures: enHeuresDecimales(part.minutes),
      part: part.part == null ? '' : `${Math.round(part.part * 1000) / 10} %`,
    });
  }

  synthese.addRow({});
  const total = synthese.addRow({
    categorie: 'Total',
    duree: formaterDuree(rapport.total.minutes),
    heures: enHeuresDecimales(rapport.total.minutes),
    part: rapport.total.minutes > 0 ? '100 %' : '',
  });
  total.font = { bold: true };

  synthese.getRow(4).font = { bold: true };
  synthese.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };

  // --------------------------------------------------------------- détail

  const detail = classeur.addWorksheet('Détail');
  detail.columns = CHAMPS_EXPORT.map((c) => ({ header: c.libelle, key: c.champ, width: c.largeur }));

  detail.getRow(1).font = { bold: true };
  detail.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };

  for (const ligne of lignes) detail.addRow(ligne);

  // Les descriptions tiennent sur plusieurs lignes : sans cet alignement,
  // elles s'affichent tronquées sur une seule.
  detail.eachRow({ includeEmpty: false }, (ligne) => {
    ligne.alignment = { vertical: 'top', wrapText: true };
  });
  detail.views = [{ state: 'frozen', ySplit: 1 }];
  detail.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: CHAMPS_EXPORT.length } };

  return {
    contenu: Buffer.from(await classeur.xlsx.writeBuffer()),
    lignes: lignes.length,
    nomFichier: `plannings_${jourCourant()}.xlsx`,
  };
}

/**
 * Le même détail, en CSV.
 *
 * Séparateur point-virgule et marque d'ordre des octets en tête : c'est ce
 * qu'attend Excel en configuration française. Avec une virgule, tout le
 * fichier atterrit dans la première colonne ; sans la marque, les accents
 * deviennent illisibles.
 */
export async function genererCsv(
  bornes: Bornes,
  filtres: Omit<FiltresRapport, 'debut' | 'fin'>,
  perimetre: Perimetre
): Promise<ResultatExport> {
  const { lignes } = await rassembler(bornes, filtres, perimetre);

  const echapper = (valeur: unknown): string => {
    const texte = String(valeur ?? '');
    return /[";\r\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
  };

  const contenu = [
    CHAMPS_EXPORT.map((c) => echapper(c.libelle)).join(';'),
    ...lignes.map((ligne) => CHAMPS_EXPORT.map((c) => echapper(ligne[c.champ])).join(';')),
  ].join('\r\n');

  return {
    contenu: Buffer.from(`﻿${contenu}`, 'utf8'),
    lignes: lignes.length,
    nomFichier: `plannings_${jourCourant()}.csv`,
  };
}
