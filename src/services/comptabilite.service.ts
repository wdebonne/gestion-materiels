import fs from 'fs';
import path from 'path';
import { db } from '../database';
import { normaliserLibelle } from '../utils/normaliserLibelle';
import { estJourValide, jourCourant } from '../utils/periodes';
import { ecrireCsv, ecrireXlsx, lireTableau, versJourISO, versMontant, type Encodage } from '../utils/tableurComptable';
import { detecterSelon } from './importMapping.service';
import { moduleOuvert } from './modules.service';
import { deposerFichier, lireConfiguration } from './webdav.service';
import { sendEmail } from './email.service';

/**
 * La passerelle avec la comptabilité (Ciril Finance).
 *
 * Trois mouvements, et un tableau pour les suivre :
 *
 *   1. **Ciril → application** : l'export des immobilisations est importé, puis
 *      chaque ligne est *rangée* — un objet créé dans une catégorie, ou un objet
 *      existant rattaché — en gardant le numéro comptable.
 *   2. **Sortie** : un objet perdu, cassé, vendu… n'est plus supprimé. Il sort
 *      de l'inventaire, avec une date et un motif, et reste consultable.
 *   3. **Application → Ciril** : les sorties partent **groupées**, un fichier
 *      par lot — dix objets retirés dans la journée font un seul mail et un
 *      seul fichier à importer —, déposé sur Nextcloud et/ou envoyé par mail.
 *      La compta confirme ensuite l'avoir intégré.
 *
 * Chaque sortie a donc trois étapes datées : déclarée, envoyée, intégrée. Le
 * tableau de suivi dit en quatre chiffres qui attend qui : l'inventaire qui n'a
 * pas rangé, la compta qui n'a pas intégré.
 *
 * Les dates d'un **jour** sont des chaînes `AAAA-MM-JJ`, les **instants** des
 * chaînes locales `AAAA-MM-JJ HH:MM:SS` : aucune ne passe par un objet `Date`
 * que MySQL rendrait décalé.
 */

// =================================================================== erreurs

/** Une saisie refusée : 400, avec un message à montrer tel quel. */
export class SaisieCompta extends Error {}
/** Un geste qui demande un droit que le compte n'a pas : 403. */
export class RefusCompta extends Error {}
/** Introuvable : 404. */
export class IntrouvableCompta extends Error {}

// =================================================================== outils

/** Maintenant, en heure locale, au format des colonnes d'instant. */
export function horodatage(d: Date = new Date()): string {
  const x = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${x(d.getMonth() + 1)}-${x(d.getDate())} ${x(d.getHours())}:${x(d.getMinutes())}:${x(d.getSeconds())}`;
}

/** Le jour d'un instant, quelle que soit sa forme (chaîne ou `Date` de MySQL). */
function jourDe(instant: unknown): string | null {
  if (!instant) return null;
  if (instant instanceof Date) return jourCourant(instant);
  const texte = String(instant);
  return /^\d{4}-\d{2}-\d{2}/.test(texte) ? texte.slice(0, 10) : null;
}

/** Nombre de jours entiers entre deux jours ISO. */
function joursEntre(debut: string, fin: string): number {
  const [a, b] = [debut, fin].map((j) => {
    const [an, mo, jo] = j.split('-').map(Number);
    return Date.UTC(an, mo - 1, jo);
  });
  return Math.round((b - a) / 86400000);
}

function nomDe(ligne: any, prefixe = ''): string | null {
  const prenom = ligne?.[`${prefixe}first_name`];
  const nom = ligne?.[`${prefixe}last_name`];
  const complet = [prenom, nom].filter(Boolean).join(' ').trim();
  return complet || ligne?.[`${prefixe}email`] || null;
}

/** Une ligne dans le journal d'activité, lue par « Derniers mouvements ». */
async function journaliser(userId: number | null, action: string, details: string, entityId: number | null = null) {
  await db.execute(
    'INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, action, 'comptabilite', entityId, details, horodatage()]
  );
}

// =================================================================== droits

export const GESTES = ['importer', 'ranger', 'sortir', 'envoyer', 'integrer', 'regler'] as const;
export type GesteCompta = (typeof GESTES)[number];

export const LIBELLES_GESTES: Record<GesteCompta, string> = {
  importer: 'Importer l’export Ciril',
  ranger: 'Ranger dans les catégories',
  sortir: 'Déclarer des sorties',
  envoyer: 'Envoyer les sorties à la compta',
  integrer: 'Confirmer l’intégration dans Ciril',
  regler: 'Régler le module',
};

export type DroitsCompta = Record<GesteCompta, boolean> & { recoitMail: boolean };

const COLONNES_DROITS: Record<keyof DroitsCompta, string> = {
  importer: 'peut_importer',
  ranger: 'peut_ranger',
  sortir: 'peut_sortir',
  envoyer: 'peut_envoyer',
  integrer: 'peut_integrer',
  regler: 'peut_regler',
  recoitMail: 'recoit_mail',
};

export const AUCUN_DROIT: DroitsCompta = {
  importer: false,
  ranger: false,
  sortir: false,
  envoyer: false,
  integrer: false,
  regler: false,
  recoitMail: false,
};

/**
 * Ce qu'une personne peut faire dans le module, en plus de consulter.
 *
 * Un administrateur a tous les gestes ; recevoir le mail reste un choix, lu sur
 * sa ligne comme pour tout le monde. Sans ligne : consultation seule.
 */
export async function droitsComptaDe(userId: number, role: string): Promise<DroitsCompta> {
  const ligne = await db.queryOne('SELECT * FROM comptabilite_droits WHERE user_id = ?', [userId]).catch(() => null);
  const droits = { ...AUCUN_DROIT };
  for (const cle of Object.keys(COLONNES_DROITS) as Array<keyof DroitsCompta>) {
    droits[cle] = Boolean(Number(ligne?.[COLONNES_DROITS[cle]] ?? 0));
  }
  if (role === 'admin') for (const g of GESTES) droits[g] = true;
  return droits;
}

/** Remplace les droits comptables d'une personne ; rien de coché, aucune ligne. */
export async function definirDroitsCompta(userId: number, saisie: Partial<DroitsCompta> | null): Promise<void> {
  await db.execute('DELETE FROM comptabilite_droits WHERE user_id = ?', [userId]);
  if (!saisie) return;
  const cles = Object.keys(COLONNES_DROITS) as Array<keyof DroitsCompta>;
  if (!cles.some((c) => saisie[c] === true)) return;
  await db.execute(
    `INSERT INTO comptabilite_droits (user_id, ${cles.map((c) => COLONNES_DROITS[c]).join(', ')}, updated_at)
     VALUES (?, ${cles.map(() => '?').join(', ')}, ?)`,
    [userId, ...cles.map((c) => (saisie[c] === true ? 1 : 0)), horodatage()]
  );
}

/** Refuse le geste si le compte ne l'a pas coché. */
export async function exigerGeste(appelant: { userId: number; role: string }, geste: GesteCompta): Promise<void> {
  const droits = await droitsComptaDe(appelant.userId, appelant.role);
  if (!droits[geste]) throw new RefusCompta(`Ce geste demande le droit : ${LIBELLES_GESTES[geste]}`);
}

// =================================================================== réglages

export const MOTIFS = {
  perdu: 'Perdu',
  casse: 'Cassé',
  vole: 'Volé',
  vendu: 'Vendu',
  reforme: 'Réformé',
  don: 'Donné',
  autre: 'Autre',
} as const;
export type Motif = keyof typeof MOTIFS;
export const estMotif = (v: unknown): v is Motif => typeof v === 'string' && v in MOTIFS;

export const COLONNES_EXPORT = {
  numero: 'N° immobilisation',
  libelle: 'Désignation',
  date_sortie: 'Date de sortie',
  motif: 'Motif',
  motif_libelle: 'Motif (libellé)',
  valeur_acquisition: 'Valeur d’acquisition',
  valeur_cession: 'Valeur de cession',
  quantite: 'Quantité sortie',
  quantite_totale: 'Quantité totale',
  commentaire: 'Commentaire',
  inventaire_interne: 'N° d’inventaire interne',
  objet: 'Objet dans l’application',
  categorie: 'Catégorie',
  localisation: 'Localisation',
  declare_par: 'Déclaré par',
} as const;
export type ColonneExport = keyof typeof COLONNES_EXPORT;

export type Frequence = 'quotidien' | 'hebdomadaire' | 'manuel';

export interface ReglagesCompta {
  envoi: {
    frequence: Frequence;
    /** Heure locale de l'envoi automatique, de 0 à 23. */
    heure: number;
    /** Jour de la semaine en hebdomadaire : 1 = lundi … 7 = dimanche. */
    jour: number;
    nextcloud: { actif: boolean; dossier: string };
    mail: { actif: boolean; adresses: string };
  };
  format: {
    extension: 'csv' | 'xlsx';
    separateur: ';' | ',' | '\t';
    encodage: Encodage;
    formatDate: 'jj/mm/aaaa' | 'aaaa-mm-jj';
    colonnes: ColonneExport[];
    codesMotif: Record<Motif, string>;
  };
  /** Au-delà, un compteur du tableau de suivi passe au rouge. */
  seuilRetardJours: number;
  /** Colonnes retenues au dernier import, par intitulé : l'ordre peut changer. */
  correspondanceImport: Partial<Record<ChampImmobilisation, string>> | null;
}

export const REGLAGES_PAR_DEFAUT: ReglagesCompta = {
  envoi: {
    frequence: 'quotidien',
    heure: 18,
    jour: 5,
    nextcloud: { actif: false, dossier: 'Compta/A traiter' },
    mail: { actif: false, adresses: '' },
  },
  format: {
    extension: 'csv',
    separateur: ';',
    encodage: 'windows-1252',
    formatDate: 'jj/mm/aaaa',
    colonnes: ['numero', 'libelle', 'date_sortie', 'motif', 'valeur_acquisition', 'valeur_cession', 'commentaire', 'inventaire_interne'],
    codesMotif: {
      perdu: 'PERTE',
      casse: 'CASSE',
      vole: 'VOL',
      vendu: 'CESSION',
      reforme: 'REFORME',
      don: 'DON',
      autre: 'AUTRE',
    },
  },
  seuilRetardJours: 7,
  correspondanceImport: null,
};

const CLE_REGLAGES = 'compta_reglages';
const CLE_DERNIER_ENVOI = 'compta_dernier_envoi';

async function lireReglage(cle: string): Promise<string | null> {
  const ligne = await db.queryOne('SELECT setting_value FROM settings WHERE setting_key = ?', [cle]).catch(() => null);
  return ligne?.setting_value ?? null;
}

async function ecrireReglage(cle: string, valeur: string, description: string): Promise<void> {
  const deja = await db.queryOne('SELECT id FROM settings WHERE setting_key = ?', [cle]);
  if (deja) {
    await db.execute('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [valeur, cle]);
  } else {
    await db.execute(
      'INSERT INTO settings (setting_key, setting_value, setting_type, description) VALUES (?, ?, ?, ?)',
      [cle, valeur, 'json', description]
    );
  }
}

/** Les réglages enregistrés, complétés par les valeurs par défaut. */
export async function lireReglages(): Promise<ReglagesCompta> {
  let lus: any = {};
  try {
    lus = JSON.parse((await lireReglage(CLE_REGLAGES)) ?? '{}') ?? {};
  } catch {
    lus = {};
  }
  const d = REGLAGES_PAR_DEFAUT;
  return {
    envoi: {
      ...d.envoi,
      ...(lus.envoi ?? {}),
      nextcloud: { ...d.envoi.nextcloud, ...(lus.envoi?.nextcloud ?? {}) },
      mail: { ...d.envoi.mail, ...(lus.envoi?.mail ?? {}) },
    },
    format: {
      ...d.format,
      ...(lus.format ?? {}),
      codesMotif: { ...d.format.codesMotif, ...(lus.format?.codesMotif ?? {}) },
    },
    seuilRetardJours: Number(lus.seuilRetardJours) > 0 ? Number(lus.seuilRetardJours) : d.seuilRetardJours,
    correspondanceImport: lus.correspondanceImport ?? null,
  };
}

/** Valide et enregistre ; rend les réglages tels qu'ils seront appliqués. */
export async function enregistrerReglages(saisie: any): Promise<ReglagesCompta> {
  const actuels = await lireReglages();
  const envoi = saisie?.envoi ?? {};
  const format = saisie?.format ?? {};

  const frequence: Frequence = ['quotidien', 'hebdomadaire', 'manuel'].includes(envoi.frequence)
    ? envoi.frequence
    : actuels.envoi.frequence;
  const heure = envoi.heure === undefined ? actuels.envoi.heure : Number(envoi.heure);
  if (!Number.isInteger(heure) || heure < 0 || heure > 23) throw new SaisieCompta('L’heure d’envoi doit être comprise entre 0 et 23.');
  const jour = envoi.jour === undefined ? actuels.envoi.jour : Number(envoi.jour);
  if (!Number.isInteger(jour) || jour < 1 || jour > 7) throw new SaisieCompta('Jour d’envoi inconnu.');

  const adresses = String(envoi.mail?.adresses ?? actuels.envoi.mail.adresses)
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter(Boolean);
  const invalide = adresses.find((a) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a));
  if (invalide) throw new SaisieCompta(`Adresse de courriel invalide : ${invalide}`);

  const dossier = String(envoi.nextcloud?.dossier ?? actuels.envoi.nextcloud.dossier)
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (dossier.includes('..')) throw new SaisieCompta('Dossier Nextcloud invalide.');

  const colonnes: ColonneExport[] = Array.isArray(format.colonnes)
    ? format.colonnes.filter((c: unknown): c is ColonneExport => typeof c === 'string' && c in COLONNES_EXPORT)
    : actuels.format.colonnes;
  if (colonnes.length === 0) throw new SaisieCompta('Le fichier des sorties doit avoir au moins une colonne.');
  if (!colonnes.includes('numero')) throw new SaisieCompta('Le numéro d’immobilisation doit figurer dans le fichier : c’est lui que Ciril rapproche.');

  const codesMotif = { ...actuels.format.codesMotif };
  for (const m of Object.keys(MOTIFS) as Motif[]) {
    if (typeof format.codesMotif?.[m] === 'string') codesMotif[m] = format.codesMotif[m].trim() || m.toUpperCase();
  }

  const reglages: ReglagesCompta = {
    envoi: {
      frequence,
      heure,
      jour,
      nextcloud: {
        actif: envoi.nextcloud?.actif === undefined ? actuels.envoi.nextcloud.actif : Boolean(envoi.nextcloud.actif),
        dossier: dossier || REGLAGES_PAR_DEFAUT.envoi.nextcloud.dossier,
      },
      mail: {
        actif: envoi.mail?.actif === undefined ? actuels.envoi.mail.actif : Boolean(envoi.mail.actif),
        adresses: adresses.join(', '),
      },
    },
    format: {
      extension: format.extension === 'xlsx' ? 'xlsx' : format.extension === 'csv' ? 'csv' : actuels.format.extension,
      separateur: [';', ',', '\t'].includes(format.separateur) ? format.separateur : actuels.format.separateur,
      encodage: format.encodage === 'utf8' || format.encodage === 'windows-1252' ? format.encodage : actuels.format.encodage,
      formatDate: format.formatDate === 'aaaa-mm-jj' || format.formatDate === 'jj/mm/aaaa' ? format.formatDate : actuels.format.formatDate,
      colonnes,
      codesMotif,
    },
    seuilRetardJours:
      saisie?.seuilRetardJours === undefined
        ? actuels.seuilRetardJours
        : Math.min(365, Math.max(1, Math.round(Number(saisie.seuilRetardJours) || actuels.seuilRetardJours))),
    correspondanceImport: actuels.correspondanceImport,
  };

  await ecrireReglage(CLE_REGLAGES, JSON.stringify(reglages), 'Passerelle comptable : envoi, format, seuil de retard.');
  return reglages;
}

async function memoriserCorrespondance(correspondance: Partial<Record<ChampImmobilisation, string>>) {
  const reglages = await lireReglages();
  reglages.correspondanceImport = correspondance;
  await ecrireReglage(CLE_REGLAGES, JSON.stringify(reglages), 'Passerelle comptable : envoi, format, seuil de retard.');
}

// =================================================================== import

export type ChampImmobilisation =
  | 'numero'
  | 'libelle'
  | 'date_acquisition'
  | 'valeur_acquisition'
  | 'compte'
  | 'fournisseur'
  | 'numero_facture'
  | 'affectation';

/**
 * Les colonnes attendues d'un export d'immobilisations.
 *
 * Le format de Ciril n'est pas encore connu : les intitulés reconnus sont ceux
 * qu'emploient couramment les logiciels de gestion publique. Une colonne non
 * reconnue se choisit à l'écran, et le choix est retenu pour la fois suivante.
 */
export const CHAMPS_IMMOBILISATION: Array<{
  champ: ChampImmobilisation;
  libelle: string;
  obligatoire: boolean;
  alias: string[];
}> = [
  {
    champ: 'numero',
    libelle: 'N° d’immobilisation',
    obligatoire: true,
    alias: [
      'n immobilisation', 'no immobilisation', 'numero immobilisation', 'numero d immobilisation', 'n d immobilisation',
      'code immobilisation', 'immobilisation', 'n immo', 'no immo', 'num immo', 'numero immo', 'code immo',
      'n inventaire', 'no inventaire', 'numero inventaire', 'numero d inventaire', 'n d inventaire', 'inventaire',
      'n bien', 'numero de bien', 'numero bien', 'code bien', 'reference', 'numero',
    ],
  },
  {
    champ: 'libelle',
    libelle: 'Désignation',
    obligatoire: true,
    alias: ['designation', 'libelle', 'libelle immobilisation', 'libelle du bien', 'intitule', 'nom', 'objet', 'description'],
  },
  {
    champ: 'date_acquisition',
    libelle: 'Date d’acquisition',
    obligatoire: false,
    alias: [
      'date acquisition', 'date d acquisition', 'date de mise en service', 'date mise en service', 'mise en service',
      'date d entree', 'date entree', 'date achat', 'date d achat', 'date',
    ],
  },
  {
    champ: 'valeur_acquisition',
    libelle: 'Valeur d’acquisition',
    obligatoire: false,
    alias: [
      'valeur acquisition', 'valeur d acquisition', 'valeur brute', 'valeur d origine', 'valeur origine', 'valeur',
      'montant', 'montant ttc', 'montant ht', 'cout', 'prix', 'prix d achat',
    ],
  },
  {
    champ: 'compte',
    libelle: 'Compte',
    obligatoire: false,
    alias: ['compte', 'compte d imputation', 'imputation', 'n compte', 'numero de compte', 'nature', 'article'],
  },
  {
    champ: 'fournisseur',
    libelle: 'Fournisseur',
    obligatoire: false,
    alias: ['fournisseur', 'tiers', 'nom du fournisseur', 'raison sociale'],
  },
  {
    champ: 'numero_facture',
    libelle: 'N° de facture',
    obligatoire: false,
    alias: ['n facture', 'no facture', 'numero facture', 'numero de facture', 'facture', 'mandat', 'n mandat', 'numero de mandat'],
  },
  {
    champ: 'affectation',
    libelle: 'Affectation',
    obligatoire: false,
    alias: ['affectation', 'service', 'service gestionnaire', 'localisation', 'site', 'lieu', 'emplacement'],
  },
];

export type CorrespondanceImmo = Partial<Record<ChampImmobilisation, number>>;

/**
 * Les colonnes à lire : celles choisies à l'écran, sinon celles retenues la
 * dernière fois (retrouvées par leur intitulé), sinon celles reconnues.
 */
export function resoudreColonnes(
  entetes: string[],
  imposee: CorrespondanceImmo | null,
  retenue: Partial<Record<ChampImmobilisation, string>> | null
): CorrespondanceImmo {
  if (imposee && Object.keys(imposee).length > 0) return imposee;

  const detectee = detecterSelon(CHAMPS_IMMOBILISATION, entetes, 0);
  if (retenue) {
    const normalises = entetes.map((e) => normaliserLibelle(e));
    for (const [champ, intitule] of Object.entries(retenue) as Array<[ChampImmobilisation, string]>) {
      const i = normalises.indexOf(normaliserLibelle(intitule));
      if (i >= 0) detectee[champ] = i;
    }
  }
  return detectee;
}

function manquants(correspondance: CorrespondanceImmo): string[] {
  return CHAMPS_IMMOBILISATION.filter((c) => c.obligatoire && correspondance[c.champ] === undefined).map((c) => c.libelle);
}

interface ImmoLue {
  numero: string;
  libelle: string | null;
  date_acquisition: string | null;
  valeur_acquisition: number | null;
  compte: string | null;
  fournisseur: string | null;
  numero_facture: string | null;
  affectation: string | null;
}

function lireLigne(ligne: string[], correspondance: CorrespondanceImmo): ImmoLue {
  const v = (champ: ChampImmobilisation) => {
    const i = correspondance[champ];
    const brut = i === undefined ? '' : String(ligne[i] ?? '').trim();
    return brut === '' ? null : brut;
  };
  return {
    numero: v('numero') ?? '',
    libelle: v('libelle'),
    date_acquisition: versJourISO(v('date_acquisition')),
    valeur_acquisition: versMontant(v('valeur_acquisition')),
    compte: v('compte'),
    fournisseur: v('fournisseur'),
    numero_facture: v('numero_facture'),
    affectation: v('affectation'),
  };
}

/** Ce que l'import va lire, avant d'écrire quoi que ce soit. */
export async function analyserFichier(chemin: string, nomOriginal: string) {
  const tableau = await lireTableau(chemin, nomOriginal);
  if (tableau.length === 0) throw new SaisieCompta('Le fichier est vide.');
  const entetes = tableau[0];
  const { correspondanceImport } = await lireReglages();
  const correspondance = resoudreColonnes(entetes, null, correspondanceImport);

  const numeros = tableau
    .slice(1)
    .map((l) => lireLigne(l, correspondance).numero)
    .filter(Boolean);
  const connus = numeros.length
    ? new Set(
        (await db.query(`SELECT numero FROM immobilisations WHERE numero IN (${numeros.map(() => '?').join(', ')})`, numeros)).map(
          (l: any) => String(l.numero)
        )
      )
    : new Set<string>();

  return {
    entetes,
    correspondance,
    champs: CHAMPS_IMMOBILISATION.map(({ champ, libelle, obligatoire }) => ({ champ, libelle, obligatoire })),
    manquants: manquants(correspondance),
    lignes: tableau.length - 1,
    nouvelles: numeros.filter((n) => !connus.has(n)).length,
    apercu: tableau.slice(1, 6).map((l) => lireLigne(l, correspondance)),
  };
}

export interface ResultatImport {
  importId: number;
  lignes: number;
  creees: number;
  misesAJour: number;
  inchangees: number;
  erreurs: Array<{ ligne: number; message: string }>;
}

/**
 * Importe l'export des immobilisations. Rejouable : chaque ligne est rapprochée
 * par son numéro. Une immobilisation inconnue arrive « à ranger » ; une connue
 * voit ses données mises à jour, jamais son rangement.
 */
export async function importerFichier(
  chemin: string,
  nomOriginal: string,
  imposee: CorrespondanceImmo | null,
  userId: number
): Promise<ResultatImport> {
  const tableau = await lireTableau(chemin, nomOriginal);
  if (tableau.length === 0) throw new SaisieCompta('Le fichier est vide.');
  const entetes = tableau[0];
  const reglages = await lireReglages();
  const correspondance = resoudreColonnes(entetes, imposee, reglages.correspondanceImport);
  const absents = manquants(correspondance);
  if (absents.length) throw new SaisieCompta(`Colonne obligatoire non trouvée : ${absents.join(', ')}.`);

  const resultat: ResultatImport = { importId: 0, lignes: tableau.length - 1, creees: 0, misesAJour: 0, inchangees: 0, erreurs: [] };
  const maintenant = horodatage();

  await db.transaction(async () => {
    const trace = await db.execute(
      'INSERT INTO imports_comptables (user_id, nom_fichier, nb_lignes, created_at) VALUES (?, ?, ?, ?)',
      [userId, nomOriginal, resultat.lignes, maintenant]
    );
    resultat.importId = trace.lastInsertRowid;
    const vus = new Set<string>();

    for (let i = 1; i < tableau.length; i++) {
      const ligne = tableau[i];
      const lue = lireLigne(ligne, correspondance);
      const numeroLigne = i + 1;
      if (!lue.numero) {
        resultat.erreurs.push({ ligne: numeroLigne, message: 'Numéro d’immobilisation vide' });
        continue;
      }
      if (lue.numero.length > 50) {
        resultat.erreurs.push({ ligne: numeroLigne, message: 'Numéro d’immobilisation trop long' });
        continue;
      }
      if (vus.has(lue.numero)) {
        resultat.erreurs.push({ ligne: numeroLigne, message: `Numéro ${lue.numero} en double dans le fichier` });
        continue;
      }
      vus.add(lue.numero);

      const source = JSON.stringify(Object.fromEntries(entetes.map((e, k) => [e || `Colonne ${k + 1}`, ligne[k] ?? ''])));
      const existante = await db.queryOne('SELECT * FROM immobilisations WHERE numero = ?', [lue.numero]);

      if (!existante) {
        if (!lue.libelle) {
          resultat.erreurs.push({ ligne: numeroLigne, message: `Désignation vide pour ${lue.numero}` });
          continue;
        }
        await db.execute(
          `INSERT INTO immobilisations (numero, libelle, date_acquisition, valeur_acquisition, compte, fournisseur,
             numero_facture, affectation, donnees_source, etat, import_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'a_ranger', ?, ?, ?)`,
          [
            lue.numero, lue.libelle, lue.date_acquisition, lue.valeur_acquisition, lue.compte, lue.fournisseur,
            lue.numero_facture, lue.affectation, source, resultat.importId, maintenant, maintenant,
          ]
        );
        resultat.creees++;
        continue;
      }

      // Une colonne vide n'efface pas ce qu'on savait déjà.
      const champs: Array<keyof ImmoLue> = ['libelle', 'date_acquisition', 'valeur_acquisition', 'compte', 'fournisseur', 'numero_facture', 'affectation'];
      const changes = champs.filter((c) => {
        const nouvelle = lue[c];
        if (nouvelle === null) return false;
        const ancienne = existante[c];
        return c === 'valeur_acquisition' ? Number(ancienne) !== Number(nouvelle) : String(ancienne ?? '') !== String(nouvelle);
      });
      if (changes.length === 0) {
        resultat.inchangees++;
        continue;
      }
      await db.execute(
        `UPDATE immobilisations SET ${changes.map((c) => `${c} = ?`).join(', ')}, donnees_source = ?, updated_at = ? WHERE id = ?`,
        [...changes.map((c) => lue[c]), source, maintenant, existante.id]
      );
      resultat.misesAJour++;
    }

    await db.execute('UPDATE imports_comptables SET nb_creees = ?, nb_mises_a_jour = ?, nb_erreurs = ? WHERE id = ?', [
      resultat.creees,
      resultat.misesAJour,
      resultat.erreurs.length,
      resultat.importId,
    ]);
  });

  // Retenir les colonnes par leur intitulé : le prochain export de Ciril les
  // retrouvera même si leur ordre a changé.
  await memoriserCorrespondance(
    Object.fromEntries(
      Object.entries(correspondance)
        .filter(([, i]) => i !== undefined && entetes[i as number])
        .map(([champ, i]) => [champ, entetes[i as number]])
    )
  );

  await journaliser(
    userId,
    'import',
    `Import de l’export Ciril « ${nomOriginal} » : ${resultat.creees} nouvelle(s), ${resultat.misesAJour} mise(s) à jour` +
      (resultat.erreurs.length ? `, ${resultat.erreurs.length} erreur(s)` : ''),
    resultat.importId
  );
  return resultat;
}

// =================================================================== immobilisations

export type EtatImmo = 'a_ranger' | 'rangee' | 'ignoree';

export async function listerImmobilisations(filtre: { etat?: string; recherche?: string; page?: number; limite?: number }) {
  const conditions: string[] = [];
  const params: any[] = [];
  if (filtre.etat && ['a_ranger', 'rangee', 'ignoree'].includes(filtre.etat)) {
    conditions.push('i.etat = ?');
    params.push(filtre.etat);
  }
  if (filtre.recherche?.trim()) {
    const motif = `%${filtre.recherche.trim()}%`;
    conditions.push('(i.numero LIKE ? OR i.libelle LIKE ? OR i.fournisseur LIKE ? OR i.numero_facture LIKE ?)');
    params.push(motif, motif, motif, motif);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limite = Math.min(200, Math.max(1, Number(filtre.limite) || 50));
  const page = Math.max(1, Number(filtre.page) || 1);

  const total = await db.queryOne(`SELECT COUNT(*) AS n FROM immobilisations i ${where}`, params);
  const lignes = await db.query(
    `SELECT i.id, i.numero, i.libelle, i.date_acquisition, i.valeur_acquisition, i.compte, i.fournisseur,
            i.numero_facture, i.affectation, i.etat, i.created_at, i.rangee_le,
            u.first_name, u.last_name, u.email,
            (SELECT COUNT(*) FROM objects o WHERE o.immobilisation_id = i.id) AS nb_objets
       FROM immobilisations i
       LEFT JOIN users u ON u.id = i.rangee_par
       ${where}
      ORDER BY i.created_at ASC, i.id ASC
      LIMIT ${limite} OFFSET ${(page - 1) * limite}`,
    params
  );

  return {
    total: Number(total?.n ?? 0),
    page,
    limite,
    immobilisations: lignes.map((l: any) => ({
      id: Number(l.id),
      numero: l.numero,
      libelle: l.libelle,
      dateAcquisition: l.date_acquisition,
      valeurAcquisition: l.valeur_acquisition === null ? null : Number(l.valeur_acquisition),
      compte: l.compte,
      fournisseur: l.fournisseur,
      numeroFacture: l.numero_facture,
      affectation: l.affectation,
      etat: l.etat as EtatImmo,
      importeeLe: l.created_at,
      rangeeLe: l.rangee_le,
      rangeePar: nomDe(l),
      nbObjets: Number(l.nb_objets ?? 0),
    })),
  };
}

async function immobilisation(id: number) {
  const immo = await db.queryOne('SELECT * FROM immobilisations WHERE id = ?', [id]);
  if (!immo) throw new IntrouvableCompta('Immobilisation introuvable');
  return immo;
}

/**
 * Crée les objets d'une ou plusieurs immobilisations dans une catégorie ou une
 * sous-catégorie. « N exemplaires » couvre la facture qui n'aurait produit
 * qu'un seul code pour plusieurs objets : chacun est lié au même numéro, avec
 * sa part de la valeur, et chacun pourra sortir seul.
 */
export async function rangerImmobilisations(
  saisie: { ids: number[]; categoryId?: number | null; subcategoryId?: number | null; exemplaires?: number; location?: string | null },
  userId: number
): Promise<{ objets: number[] }> {
  const ids = [...new Set((saisie.ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) throw new SaisieCompta('Aucune immobilisation choisie.');
  const exemplaires = Math.round(Number(saisie.exemplaires ?? 1));
  if (!Number.isInteger(exemplaires) || exemplaires < 1 || exemplaires > 500) throw new SaisieCompta('Nombre d’exemplaires invalide (1 à 500).');

  let categoryId: number | null = null;
  let subcategoryId: number | null = null;
  let destination = '';
  if (saisie.subcategoryId) {
    const sous = await db.queryOne(
      'SELECT s.id, s.name, c.name AS categorie FROM subcategories s LEFT JOIN categories c ON c.id = s.category_id WHERE s.id = ?',
      [saisie.subcategoryId]
    );
    if (!sous) throw new SaisieCompta('Sous-catégorie introuvable.');
    subcategoryId = Number(sous.id);
    destination = `${sous.categorie ?? ''} › ${sous.name}`;
  } else if (saisie.categoryId) {
    const cat = await db.queryOne('SELECT id, name FROM categories WHERE id = ?', [saisie.categoryId]);
    if (!cat) throw new SaisieCompta('Catégorie introuvable.');
    categoryId = Number(cat.id);
    destination = cat.name;
  } else {
    throw new SaisieCompta('Choisissez une catégorie ou une sous-catégorie.');
  }

  const image = (await db.queryOne("SELECT setting_value FROM settings WHERE setting_key = 'default_image'"))?.setting_value || '';
  const objets: number[] = [];
  const maintenant = horodatage();

  await db.transaction(async () => {
    for (const id of ids) {
      const immo = await immobilisation(id);
      if (immo.etat !== 'a_ranger') throw new SaisieCompta(`L’immobilisation ${immo.numero} n’est plus à ranger.`);
      const valeur = immo.valeur_acquisition === null ? null : Math.round((Number(immo.valeur_acquisition) / exemplaires) * 100) / 100;

      for (let n = 0; n < exemplaires; n++) {
        const r = await db.execute(
          `INSERT INTO objects (category_id, subcategory_id, name, image, purchase_date, purchase_price, status, location,
             notes, material_type, quantity_total, unit_cost, immobilisation_id)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 'unique', 0, 0, ?)`,
          [
            categoryId,
            subcategoryId,
            immo.libelle || immo.numero,
            image,
            immo.date_acquisition,
            valeur,
            saisie.location || immo.affectation || null,
            `Immobilisation ${immo.numero}${immo.numero_facture ? ` — facture ${immo.numero_facture}` : ''}${immo.fournisseur ? ` — ${immo.fournisseur}` : ''}`,
            immo.id,
          ]
        );
        objets.push(r.lastInsertRowid);
      }
      await db.execute("UPDATE immobilisations SET etat = 'rangee', rangee_le = ?, rangee_par = ?, updated_at = ? WHERE id = ?", [
        maintenant,
        userId,
        maintenant,
        immo.id,
      ]);
    }
  });

  await journaliser(
    userId,
    'rangement',
    ids.length === 1
      ? `${objets.length > 1 ? `${objets.length} objets créés` : 'Objet créé'} dans ${destination} depuis l’immobilisation n° ${(await immobilisation(ids[0])).numero}`
      : `${ids.length} immobilisations rangées dans ${destination} (${objets.length} objets)`
  );
  return { objets };
}

/** Recalcule l'état d'une immobilisation d'après ses objets liés. */
async function recalculerEtat(immoId: number) {
  const immo = await db.queryOne('SELECT etat FROM immobilisations WHERE id = ?', [immoId]);
  if (!immo || immo.etat === 'ignoree') return;
  const n = Number((await db.queryOne('SELECT COUNT(*) AS n FROM objects WHERE immobilisation_id = ?', [immoId]))?.n ?? 0);
  await db.execute('UPDATE immobilisations SET etat = ?, updated_at = ? WHERE id = ?', [n > 0 ? 'rangee' : 'a_ranger', horodatage(), immoId]);
}

/**
 * Lie un objet existant à une immobilisation, ou le délie (`null`).
 * C'est le cas de l'inventaire déjà saisi à la main avant la passerelle.
 */
export async function lierObjet(objectId: number, immoId: number | null, userId: number): Promise<void> {
  const objet = await db.queryOne('SELECT id, name, immobilisation_id FROM objects WHERE id = ?', [objectId]);
  if (!objet) throw new IntrouvableCompta('Objet introuvable');
  const ancienne = objet.immobilisation_id === null || objet.immobilisation_id === undefined ? null : Number(objet.immobilisation_id);
  const sortie = await db.queryOne('SELECT export_id FROM sorties_inventaire WHERE object_id = ?', [objectId]);
  if (sortie?.export_id) throw new SaisieCompta('Cet objet est sorti et déjà envoyé à la compta : son numéro ne peut plus changer.');

  let immo: any = null;
  if (immoId !== null) {
    immo = await immobilisation(immoId);
    if (immo.etat === 'ignoree') throw new SaisieCompta(`L’immobilisation ${immo.numero} est ignorée : rétablissez-la d’abord.`);
  }

  await db.transaction(async () => {
    await db.execute('UPDATE objects SET immobilisation_id = ?, updated_at = ? WHERE id = ?', [immoId, horodatage(), objectId]);
    if (immo) {
      await db.execute('UPDATE immobilisations SET rangee_le = COALESCE(rangee_le, ?), rangee_par = COALESCE(rangee_par, ?) WHERE id = ?', [
        horodatage(),
        userId,
        immo.id,
      ]);
      await recalculerEtat(immo.id);
    }
    if (ancienne !== null && ancienne !== immoId) await recalculerEtat(ancienne);
  });

  await journaliser(
    userId,
    'rattachement',
    immo ? `« ${objet.name} » rattaché à l’immobilisation n° ${immo.numero}` : `« ${objet.name} » n’est plus lié à une immobilisation`,
    objectId
  );
}

export async function ignorerImmobilisation(id: number, userId: number): Promise<void> {
  const immo = await immobilisation(id);
  const n = Number((await db.queryOne('SELECT COUNT(*) AS n FROM objects WHERE immobilisation_id = ?', [id]))?.n ?? 0);
  if (n > 0) throw new SaisieCompta('Des objets sont liés à cette immobilisation : déliez-les avant de l’ignorer.');
  await db.execute("UPDATE immobilisations SET etat = 'ignoree', rangee_le = ?, rangee_par = ?, updated_at = ? WHERE id = ?", [
    horodatage(),
    userId,
    horodatage(),
    id,
  ]);
  await journaliser(userId, 'ignorer', `Immobilisation n° ${immo.numero} ignorée (pas du matériel à inventorier)`, id);
}

export async function retablirImmobilisation(id: number, userId: number): Promise<void> {
  const immo = await immobilisation(id);
  await db.execute("UPDATE immobilisations SET etat = 'a_ranger', rangee_le = NULL, rangee_par = NULL, updated_at = ? WHERE id = ?", [
    horodatage(),
    id,
  ]);
  await recalculerEtat(id);
  await journaliser(userId, 'retablir', `Immobilisation n° ${immo.numero} remise à ranger`, id);
}

// =================================================================== sorties

export interface SaisieSortie {
  date?: string;
  motif?: string;
  commentaire?: string | null;
  valeurCession?: number | string | null;
  quantite?: number | string | null;
}

/**
 * Sort un objet de l'inventaire. Il reste en base, au statut `sorti`, et sa
 * sortie rejoint la file du prochain envoi à la compta.
 */
export async function sortirObjet(objectId: number, saisie: SaisieSortie, userId: number): Promise<void> {
  const objet = await db.queryOne('SELECT id, name, status, material_type, quantity_total FROM objects WHERE id = ?', [objectId]);
  if (!objet) throw new IntrouvableCompta('Objet introuvable');
  if (objet.status === 'sorti' || (await db.queryOne('SELECT id FROM sorties_inventaire WHERE object_id = ?', [objectId]))) {
    throw new SaisieCompta('Cet objet est déjà sorti de l’inventaire.');
  }

  const date = saisie.date?.trim() || jourCourant();
  if (!estJourValide(date)) throw new SaisieCompta('Date de sortie invalide.');
  if (date > jourCourant()) throw new SaisieCompta('La date de sortie ne peut pas être dans le futur.');
  if (!estMotif(saisie.motif)) throw new SaisieCompta('Choisissez le motif de la sortie.');

  let valeurCession: number | null = null;
  if (saisie.valeurCession !== undefined && saisie.valeurCession !== null && String(saisie.valeurCession).trim() !== '') {
    valeurCession = versMontant(saisie.valeurCession);
    if (valeurCession === null || valeurCession < 0) throw new SaisieCompta('Valeur de cession invalide.');
  }

  const total = objet.material_type === 'lot' ? Math.max(1, Number(objet.quantity_total) || 1) : 1;
  const quantite = saisie.quantite === undefined || saisie.quantite === null || saisie.quantite === '' ? total : Math.round(Number(saisie.quantite));
  if (!Number.isInteger(quantite) || quantite < 1 || quantite > total) throw new SaisieCompta(`Quantité sortie invalide (1 à ${total}).`);

  const commentaire = saisie.commentaire?.toString().trim() || null;

  await db.transaction(async () => {
    await db.execute(
      `INSERT INTO sorties_inventaire (object_id, date_sortie, motif, commentaire, valeur_cession, quantite_sortie,
         statut_precedent, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [objectId, date, saisie.motif, commentaire, valeurCession, quantite, objet.status ?? null, userId, horodatage()]
    );
    await db.execute("UPDATE objects SET status = 'sorti', updated_at = ? WHERE id = ?", [horodatage(), objectId]);
  });

  await journaliser(userId, 'sortie', `« ${objet.name} » sorti de l’inventaire (${MOTIFS[saisie.motif as Motif].toLowerCase()})`, objectId);
}

/** Annule une sortie tant qu'elle n'est pas partie à la compta. */
export async function annulerSortie(objectId: number, userId: number): Promise<void> {
  const sortie = await db.queryOne(
    'SELECT s.*, o.name FROM sorties_inventaire s JOIN objects o ON o.id = s.object_id WHERE s.object_id = ?',
    [objectId]
  );
  if (!sortie) throw new IntrouvableCompta('Cet objet n’est pas sorti de l’inventaire.');
  if (sortie.export_id) throw new SaisieCompta('Cette sortie a déjà été envoyée à la compta : elle ne peut plus être annulée ici.');

  await db.transaction(async () => {
    await db.execute('DELETE FROM sorties_inventaire WHERE id = ?', [sortie.id]);
    const statut = sortie.statut_precedent && sortie.statut_precedent !== 'sorti' ? sortie.statut_precedent : 'active';
    await db.execute('UPDATE objects SET status = ?, updated_at = ? WHERE id = ?', [statut, horodatage(), objectId]);
  });
  await journaliser(userId, 'sortie_annulee', `Sortie de « ${sortie.name} » annulée : l’objet revient à l’inventaire`, objectId);
}

/** La sortie d'un objet et ses trois étapes ; `null` s'il n'est pas sorti. */
export async function sortieDe(objectId: number) {
  const s = await db.queryOne(
    `SELECT s.*, u.first_name, u.last_name, u.email, e.envoye_le, e.integre_le,
            ui.first_name AS i_first_name, ui.last_name AS i_last_name, ui.email AS i_email
       FROM sorties_inventaire s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN exports_comptables e ON e.id = s.export_id
       LEFT JOIN users ui ON ui.id = e.integre_par
      WHERE s.object_id = ?`,
    [objectId]
  ).catch(() => null);
  return s ? formaterSortie(s) : null;
}

function formaterSortie(s: any) {
  return {
    id: Number(s.id),
    objectId: Number(s.object_id),
    date: s.date_sortie,
    motif: s.motif as Motif,
    motifLibelle: MOTIFS[s.motif as Motif] ?? s.motif,
    commentaire: s.commentaire ?? null,
    valeurCession: s.valeur_cession === null || s.valeur_cession === undefined ? null : Number(s.valeur_cession),
    quantite: Number(s.quantite_sortie ?? 1),
    declareeLe: s.created_at,
    declareePar: nomDe(s),
    exportId: s.export_id ? Number(s.export_id) : null,
    envoyeeLe: s.envoye_le ?? null,
    integreeLe: s.integre_le ?? null,
    integreePar: nomDe(s, 'i_'),
  };
}

export type FiltreSorties = 'a_envoyer' | 'a_integrer' | 'integrees' | 'hors_compta' | 'toutes';

export async function listerSorties(filtre: FiltreSorties = 'toutes', limite = 200) {
  const conditions: Record<FiltreSorties, string> = {
    a_envoyer: 's.export_id IS NULL AND o.immobilisation_id IS NOT NULL',
    a_integrer: 's.export_id IS NOT NULL AND e.integre_le IS NULL',
    integrees: 'e.integre_le IS NOT NULL',
    hors_compta: 's.export_id IS NULL AND o.immobilisation_id IS NULL',
    toutes: '1 = 1',
  };
  const lignes = await db.query(
    `SELECT s.*, o.name AS objet, o.inventaire_interne, o.location,
            i.numero, i.libelle, i.valeur_acquisition,
            COALESCE(c.name, c2.name) AS categorie,
            u.first_name, u.last_name, u.email, e.envoye_le, e.integre_le,
            ui.first_name AS i_first_name, ui.last_name AS i_last_name, ui.email AS i_email
       FROM sorties_inventaire s
       JOIN objects o ON o.id = s.object_id
       LEFT JOIN immobilisations i ON i.id = o.immobilisation_id
       LEFT JOIN categories c ON c.id = o.category_id
       LEFT JOIN subcategories sc ON sc.id = o.subcategory_id
       LEFT JOIN categories c2 ON c2.id = sc.category_id
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN exports_comptables e ON e.id = s.export_id
       LEFT JOIN users ui ON ui.id = e.integre_par
      WHERE ${conditions[filtre] ?? conditions.toutes}
      ORDER BY s.date_sortie DESC, s.id DESC
      LIMIT ${Math.min(1000, Math.max(1, limite))}`
  );
  return lignes.map((l: any) => ({
    ...formaterSortie(l),
    objet: l.objet,
    inventaireInterne: l.inventaire_interne ?? null,
    localisation: l.location ?? null,
    categorie: l.categorie ?? null,
    numero: l.numero ?? null,
    libelle: l.libelle ?? null,
    valeurAcquisition: l.valeur_acquisition === null || l.valeur_acquisition === undefined ? null : Number(l.valeur_acquisition),
  }));
}

// =================================================================== fichier des sorties

type SortieListee = Awaited<ReturnType<typeof listerSorties>>[number];

function formaterMontant(n: number | null, separateur: string): string {
  if (n === null || n === undefined) return '';
  const texte = n.toFixed(2);
  // Avec un point-virgule ou une tabulation, la virgule est décimale : c'est ce
  // qu'attend un tableur ou un logiciel réglé en français.
  return separateur === ',' ? texte : texte.replace('.', ',');
}

function formaterJour(jour: string | null, format: ReglagesCompta['format']['formatDate']): string {
  if (!jour) return '';
  const [a, m, j] = jour.slice(0, 10).split('-');
  return format === 'jj/mm/aaaa' ? `${j}/${m}/${a}` : `${a}-${m}-${j}`;
}

/** Les lignes du fichier, en-tête comprise, selon les colonnes réglées. */
export async function lignesFichier(sorties: SortieListee[], format: ReglagesCompta['format']): Promise<Array<Array<string | number | null>>> {
  const totaux = new Map<number, number>();
  for (const s of sorties) {
    if (s.numero && !totaux.has(s.objectId)) {
      const r = await db.queryOne(
        `SELECT COUNT(*) AS n FROM objects o2 WHERE o2.immobilisation_id = (SELECT immobilisation_id FROM objects WHERE id = ?)`,
        [s.objectId]
      );
      totaux.set(s.objectId, Number(r?.n ?? 1));
    }
  }
  const xlsx = format.extension === 'xlsx';
  const montant = (n: number | null) => (xlsx ? n : formaterMontant(n, format.separateur));

  const valeur = (s: SortieListee, c: ColonneExport): string | number | null => {
    switch (c) {
      case 'numero': return s.numero;
      case 'libelle': return s.libelle ?? s.objet;
      case 'date_sortie': return formaterJour(s.date, format.formatDate);
      case 'motif': return format.codesMotif[s.motif] ?? s.motif;
      case 'motif_libelle': return s.motifLibelle;
      case 'valeur_acquisition': return montant(s.valeurAcquisition);
      case 'valeur_cession': return montant(s.valeurCession);
      case 'quantite': return s.quantite;
      case 'quantite_totale': return totaux.get(s.objectId) ?? 1;
      case 'commentaire': return s.commentaire;
      case 'inventaire_interne': return s.inventaireInterne;
      case 'objet': return s.objet;
      case 'categorie': return s.categorie;
      case 'localisation': return s.localisation;
      case 'declare_par': return s.declareePar;
    }
  };

  return [format.colonnes.map((c) => COLONNES_EXPORT[c]), ...sorties.map((s) => format.colonnes.map((c) => valeur(s, c)))];
}

/** Où sont gardés les fichiers envoyés ; réglable pour les tests. */
const dossierExports = () =>
  process.env.DOSSIER_EXPORTS_COMPTABLES || path.join(__dirname, '../../uploads/exports-comptables');

async function ecrireFichier(sorties: SortieListee[], reglages: ReglagesCompta, jour: string) {
  const lignes = await lignesFichier(sorties, reglages.format);
  const extension = reglages.format.extension;
  const contenu =
    extension === 'xlsx'
      ? await ecrireXlsx(lignes, 'Sorties')
      : ecrireCsv(lignes, reglages.format.separateur, reglages.format.encodage);

  const DOSSIER_EXPORTS = dossierExports();
  if (!fs.existsSync(DOSSIER_EXPORTS)) fs.mkdirSync(DOSSIER_EXPORTS, { recursive: true });
  let nomFichier = `sorties_${jour}.${extension}`;
  for (let n = 2; fs.existsSync(path.join(DOSSIER_EXPORTS, nomFichier)); n++) nomFichier = `sorties_${jour}_${n}.${extension}`;
  const cheminLocal = path.join(DOSSIER_EXPORTS, nomFichier);
  fs.writeFileSync(cheminLocal, contenu);

  const type =
    extension === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : `text/csv; charset=${reglages.format.encodage === 'utf8' ? 'utf-8' : 'windows-1252'}`;
  return { contenu, nomFichier, cheminLocal, type };
}

// =================================================================== envoi

type StatutDestination = 'ok' | 'echec' | 'retenu' | null;

export interface ResultatLot {
  exportId: number | null;
  lignes: number;
  nomFichier: string | null;
  nextcloud: StatutDestination;
  mail: StatutDestination;
  erreurs: string[];
  /** Les sorties ont-elles quitté la file ? */
  envoye: boolean;
}

/** Destinataires du mail : les adresses réglées, et les comptes qui l'ont coché. */
export async function destinatairesMail(reglages: ReglagesCompta): Promise<string[]> {
  const adresses = new Set(
    reglages.envoi.mail.adresses
      .split(/[,;\s]+/)
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean)
  );
  const comptes = await db.query(
    `SELECT u.id, u.email, u.role FROM comptabilite_droits d JOIN users u ON u.id = d.user_id
      WHERE d.recoit_mail = 1 AND u.is_active = 1 AND u.email IS NOT NULL`
  );
  for (const c of comptes) {
    // Un compte qui a perdu l'accès au module ne reçoit plus le fichier.
    if (await moduleOuvert({ userId: Number(c.id), role: c.role }, 'comptabilite')) adresses.add(String(c.email).toLowerCase());
  }
  return [...adresses];
}

async function livrer(
  exp: { id: number; nomFichier: string; cheminLocal: string; contenu: Buffer; type: string },
  sorties: SortieListee[],
  reglages: ReglagesCompta,
  seulement?: { nextcloud: boolean; mail: boolean }
) {
  const erreurs: string[] = [];
  let nextcloud: StatutDestination = null;
  let mail: StatutDestination = null;
  const dossier = reglages.envoi.nextcloud.dossier;

  if (reglages.envoi.nextcloud.actif && (seulement?.nextcloud ?? true)) {
    const depot = await deposerFichier(`${dossier}/${exp.nomFichier}`, exp.contenu, exp.type);
    nextcloud = depot.success ? 'ok' : 'echec';
    if (!depot.success) erreurs.push(`Nextcloud : ${depot.error ?? 'dépôt refusé'}`);
  }

  if (reglages.envoi.mail.actif && (seulement?.mail ?? true)) {
    const destinataires = await destinatairesMail(reglages);
    if (destinataires.length === 0) {
      mail = 'echec';
      erreurs.push('Mail : aucun destinataire réglé');
    } else {
      try {
        const parti = await sendEmail(
          'compta_sorties',
          destinataires.join(', '),
          {
            nombre: sorties.length,
            pluriel: sorties.length > 1 ? 's' : '',
            fichier: exp.nomFichier,
            dossier_nextcloud: nextcloud === 'ok' ? dossier : '',
            sorties: sorties.map((s) => ({
              numero: s.numero,
              libelle: s.libelle ?? s.objet,
              motif: s.motifLibelle,
              date: formaterJour(s.date, 'jj/mm/aaaa'),
            })),
          },
          [{ filename: exp.nomFichier, path: exp.cheminLocal }]
        );
        mail = parti ? 'ok' : 'retenu';
        if (!parti) erreurs.push('Mail : envois automatiques suspendus');
      } catch (e: any) {
        mail = 'echec';
        erreurs.push(`Mail : ${e?.message ?? e}`);
      }
    }
  }
  return { nextcloud, mail, erreurs };
}

/**
 * Le lot : toutes les sorties en attente, dans **un seul** fichier.
 *
 * `telechargement` : le fichier est rendu à la personne, qui l'importe elle-même ;
 * `envoi` : il est déposé et/ou envoyé selon les réglages.
 *
 * File vide : rien n'est produit — ni fichier vide, ni mail. Si toutes les
 * destinations échouent, les sorties restent dans la file et repartiront au
 * lot suivant ; l'échec reste lisible dans l'historique.
 */
export async function envoyerLot(
  mode: 'envoi' | 'telechargement',
  origine: 'manuel' | 'automatique',
  userId: number | null
): Promise<ResultatLot & { contenu?: Buffer; type?: string }> {
  const reglages = await lireReglages();
  const vide: ResultatLot = { exportId: null, lignes: 0, nomFichier: null, nextcloud: null, mail: null, erreurs: [], envoye: false };

  if (mode === 'envoi' && !reglages.envoi.nextcloud.actif && !reglages.envoi.mail.actif) {
    throw new SaisieCompta('Aucune destination d’envoi n’est réglée : activez Nextcloud ou le mail dans les réglages.');
  }
  if (mode === 'envoi' && reglages.envoi.nextcloud.actif && !(await lireConfiguration()) && !reglages.envoi.mail.actif) {
    throw new SaisieCompta('Nextcloud n’est pas configuré (Paramètres › Nextcloud).');
  }

  const sorties = await listerSorties('a_envoyer', 1000);
  if (sorties.length === 0) return vide;

  const fichier = await ecrireFichier(sorties, reglages, jourCourant());
  const creation = await db.execute(
    `INSERT INTO exports_comptables (user_id, origine, nb_lignes, format, nom_fichier, chemin_local, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, mode === 'telechargement' ? 'telechargement' : origine, sorties.length, reglages.format.extension, fichier.nomFichier, fichier.cheminLocal, horodatage()]
  );
  const exportId = creation.lastInsertRowid;
  const ids = sorties.map((s) => s.id);
  const marquer = () =>
    db.execute(`UPDATE sorties_inventaire SET export_id = ? WHERE id IN (${ids.map(() => '?').join(', ')})`, [exportId, ...ids]);

  if (mode === 'telechargement') {
    await marquer();
    await db.execute('UPDATE exports_comptables SET envoye_le = ? WHERE id = ?', [horodatage(), exportId]);
    await journaliser(userId, 'export', `Fichier des sorties téléchargé : ${sorties.length} bien(s) (${fichier.nomFichier})`, exportId);
    return { ...vide, exportId, lignes: sorties.length, nomFichier: fichier.nomFichier, envoye: true, contenu: fichier.contenu, type: fichier.type };
  }

  const livraison = await livrer({ id: exportId, ...fichier }, sorties, reglages);
  const reussies = [livraison.nextcloud, livraison.mail].filter((s) => s === 'ok').length;
  const envoye = reussies > 0;

  await db.execute(
    'UPDATE exports_comptables SET statut_nextcloud = ?, statut_mail = ?, erreur = ?, envoye_le = ? WHERE id = ?',
    [livraison.nextcloud, livraison.mail, livraison.erreurs.join(' — ') || null, envoye ? horodatage() : null, exportId]
  );

  if (envoye) {
    await marquer();
  } else {
    // Rien n'est parti : le fichier ne sert à rien, la ligne garde l'erreur.
    try { fs.unlinkSync(fichier.cheminLocal); } catch (_) {}
    await db.execute('UPDATE exports_comptables SET chemin_local = NULL WHERE id = ?', [exportId]);
  }

  const destinations = [livraison.nextcloud === 'ok' ? 'déposé sur Nextcloud' : null, livraison.mail === 'ok' ? 'envoyé par mail' : null]
    .filter(Boolean)
    .join(' et ');
  await journaliser(
    userId,
    envoye ? 'envoi' : 'envoi_echec',
    envoye
      ? `${origine === 'automatique' ? 'Envoi automatique' : 'Envoi'} à la compta : ${sorties.length} sortie(s), ${destinations}` +
          (livraison.erreurs.length ? ` (${livraison.erreurs.join(' — ')})` : '')
      : `Échec de l’envoi à la compta : ${livraison.erreurs.join(' — ')}. Les ${sorties.length} sortie(s) restent dans la file.`,
    exportId
  );

  return { exportId, lignes: sorties.length, nomFichier: fichier.nomFichier, ...livraison, envoye };
}

/** Renvoie un lot vers la destination qui avait échoué. */
export async function renvoyerLot(exportId: number, userId: number): Promise<ResultatLot> {
  const exp = await db.queryOne('SELECT * FROM exports_comptables WHERE id = ?', [exportId]);
  if (!exp) throw new IntrouvableCompta('Envoi introuvable');
  if (!exp.chemin_local || !fs.existsSync(exp.chemin_local)) throw new SaisieCompta('Le fichier de cet envoi n’est plus disponible.');
  const reglages = await lireReglages();
  const seulement = {
    nextcloud: exp.statut_nextcloud !== 'ok',
    mail: exp.statut_mail !== 'ok',
  };
  if (!seulement.nextcloud && !seulement.mail) throw new SaisieCompta('Cet envoi est déjà arrivé partout.');

  const sorties = (await listerSorties('toutes', 1000)).filter((s) => s.exportId === exportId);
  const contenu = fs.readFileSync(exp.chemin_local);
  const type = exp.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv';
  const livraison = await livrer({ id: exportId, nomFichier: exp.nom_fichier, cheminLocal: exp.chemin_local, contenu, type }, sorties, reglages, seulement);

  const nextcloud = livraison.nextcloud ?? exp.statut_nextcloud ?? null;
  const mail = livraison.mail ?? exp.statut_mail ?? null;
  await db.execute('UPDATE exports_comptables SET statut_nextcloud = ?, statut_mail = ?, erreur = ? WHERE id = ?', [
    nextcloud,
    mail,
    livraison.erreurs.join(' — ') || null,
    exportId,
  ]);
  await journaliser(
    userId,
    'renvoi',
    livraison.erreurs.length ? `Nouvel échec du renvoi de ${exp.nom_fichier} : ${livraison.erreurs.join(' — ')}` : `${exp.nom_fichier} renvoyé à la compta`,
    exportId
  );
  return { exportId, lignes: Number(exp.nb_lignes), nomFichier: exp.nom_fichier, nextcloud, mail, erreurs: livraison.erreurs, envoye: true };
}

/** Le jour de la semaine ISO : 1 = lundi … 7 = dimanche. */
const jourIso = (d: Date) => ((d.getDay() + 6) % 7) + 1;

/** Le prochain envoi automatique, en instant local ; `null` en mode manuel. */
export function prochainEnvoi(reglages: ReglagesCompta, dernierEnvoi: string | null, maintenant: Date = new Date()): string | null {
  const { frequence, heure, jour } = reglages.envoi;
  if (frequence === 'manuel' || (!reglages.envoi.nextcloud.actif && !reglages.envoi.mail.actif)) return null;
  const aujourdhui = jourCourant(maintenant);
  for (let n = 0; n < 8; n++) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() + n);
    const cle = jourCourant(d);
    if (frequence === 'hebdomadaire' && jourIso(d) !== jour) continue;
    if (cle === aujourdhui && dernierEnvoi === aujourdhui) continue;
    // Aujourd'hui, heure passée et pas encore envoyé : au prochain passage horaire.
    if (cle === aujourdhui && maintenant.getHours() >= heure) {
      const suivant = new Date(maintenant);
      suivant.setMinutes(10, 0, 0);
      if (suivant <= maintenant) suivant.setHours(suivant.getHours() + 1);
      return horodatage(suivant);
    }
    return `${cle} ${String(heure).padStart(2, '0')}:10:00`;
  }
  return null;
}

/**
 * Le passage horaire de la tâche planifiée : envoie le lot du jour si l'heure
 * réglée est atteinte et qu'aucun lot n'est encore parti aujourd'hui.
 *
 * L'heure est lue à chaque passage : la changer ne demande pas de redémarrer.
 * Un serveur arrêté à l'heure dite rattrape l'envoi à son prochain passage.
 * Le jour est marqué dès que l'échéance est traitée — file vide comprise —, pour
 * qu'une sortie déclarée le soir parte avec le lot du lendemain plutôt que
 * seule ; il ne l'est pas si toutes les destinations ont échoué, pour réessayer.
 */
export async function envoyerLotSiEcheance(maintenant: Date = new Date()): Promise<ResultatLot | null> {
  const reglages = await lireReglages();
  const { frequence, heure, jour } = reglages.envoi;
  if (frequence === 'manuel') return null;
  if (!reglages.envoi.nextcloud.actif && !reglages.envoi.mail.actif) return null;
  if (frequence === 'hebdomadaire' && jourIso(maintenant) !== jour) return null;
  if (maintenant.getHours() < heure) return null;
  const aujourdhui = jourCourant(maintenant);
  if ((await lireReglage(CLE_DERNIER_ENVOI)) === aujourdhui) return null;

  const resultat = await envoyerLot('envoi', 'automatique', null);
  if (resultat.lignes === 0 || resultat.envoye) {
    await ecrireReglage(CLE_DERNIER_ENVOI, aujourdhui, 'Passerelle comptable : jour du dernier envoi automatique.');
  }
  return resultat;
}

/** Un fichier d'essai, vers les destinations réglées. */
export async function testerEnvoi(): Promise<{ nextcloud: StatutDestination; mail: StatutDestination; erreurs: string[] }> {
  const reglages = await lireReglages();
  if (!reglages.envoi.nextcloud.actif && !reglages.envoi.mail.actif) throw new SaisieCompta('Aucune destination d’envoi n’est activée.');
  const lignes = [[...reglages.format.colonnes.map((c) => COLONNES_EXPORT[c])]];
  const contenu = ecrireCsv(lignes, reglages.format.separateur, reglages.format.encodage);
  const DOSSIER_EXPORTS = dossierExports();
  if (!fs.existsSync(DOSSIER_EXPORTS)) fs.mkdirSync(DOSSIER_EXPORTS, { recursive: true });
  const nomFichier = `essai_${jourCourant()}.csv`;
  const cheminLocal = path.join(DOSSIER_EXPORTS, nomFichier);
  fs.writeFileSync(cheminLocal, contenu);
  try {
    return await livrer({ id: 0, nomFichier, cheminLocal, contenu, type: 'text/csv' }, [], reglages);
  } finally {
    try { fs.unlinkSync(cheminLocal); } catch (_) {}
  }
}

// =================================================================== historique et intégration

export async function listerExports(limite = 50) {
  const lignes = await db.query(
    `SELECT e.*, u.first_name, u.last_name, u.email,
            ui.first_name AS i_first_name, ui.last_name AS i_last_name, ui.email AS i_email
       FROM exports_comptables e
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN users ui ON ui.id = e.integre_par
      ORDER BY e.id DESC
      LIMIT ${Math.min(500, Math.max(1, limite))}`
  );
  return lignes.map((e: any) => ({
    id: Number(e.id),
    origine: e.origine,
    creeLe: e.created_at,
    par: nomDe(e),
    lignes: Number(e.nb_lignes ?? 0),
    nomFichier: e.nom_fichier,
    fichierDisponible: Boolean(e.chemin_local),
    nextcloud: e.statut_nextcloud ?? null,
    mail: e.statut_mail ?? null,
    erreur: e.erreur ?? null,
    envoyeLe: e.envoye_le ?? null,
    integreLe: e.integre_le ?? null,
    integrePar: nomDe(e, 'i_'),
    integreParId: e.integre_par ? Number(e.integre_par) : null,
  }));
}

export async function fichierExport(exportId: number): Promise<{ chemin: string; nom: string }> {
  const exp = await db.queryOne('SELECT nom_fichier, chemin_local FROM exports_comptables WHERE id = ?', [exportId]);
  if (!exp) throw new IntrouvableCompta('Envoi introuvable');
  if (!exp.chemin_local || !fs.existsSync(exp.chemin_local)) throw new IntrouvableCompta('Le fichier de cet envoi n’est plus disponible.');
  return { chemin: exp.chemin_local, nom: exp.nom_fichier };
}

/** La compta confirme avoir intégré le fichier dans Ciril. */
export async function confirmerIntegration(exportId: number, userId: number): Promise<void> {
  const exp = await db.queryOne('SELECT * FROM exports_comptables WHERE id = ?', [exportId]);
  if (!exp) throw new IntrouvableCompta('Envoi introuvable');
  if (!exp.envoye_le) throw new SaisieCompta('Cet envoi n’est pas parti : il n’y a rien à intégrer.');
  if (exp.integre_le) throw new SaisieCompta('Cet envoi est déjà marqué intégré.');
  await db.execute('UPDATE exports_comptables SET integre_le = ?, integre_par = ? WHERE id = ?', [horodatage(), userId, exportId]);
  await journaliser(userId, 'integration', `Intégration dans Ciril confirmée : ${exp.nom_fichier} (${exp.nb_lignes} bien(s))`, exportId);
}

/** Revient sur une confirmation faite par erreur : son auteur, ou un administrateur. */
export async function annulerIntegration(exportId: number, appelant: { userId: number; role: string }): Promise<void> {
  const exp = await db.queryOne('SELECT * FROM exports_comptables WHERE id = ?', [exportId]);
  if (!exp) throw new IntrouvableCompta('Envoi introuvable');
  if (!exp.integre_le) throw new SaisieCompta('Cet envoi n’est pas marqué intégré.');
  if (appelant.role !== 'admin' && Number(exp.integre_par) !== appelant.userId) {
    throw new RefusCompta('Seule la personne qui a confirmé, ou un administrateur, peut revenir sur cette confirmation.');
  }
  await db.execute('UPDATE exports_comptables SET integre_le = NULL, integre_par = NULL WHERE id = ?', [exportId]);
  await journaliser(appelant.userId, 'integration_annulee', `Confirmation d’intégration retirée : ${exp.nom_fichier}`, exportId);
}

/** Administrateur : annule un envoi et remet ses sorties dans la file. */
export async function annulerExport(exportId: number, userId: number): Promise<void> {
  const exp = await db.queryOne('SELECT * FROM exports_comptables WHERE id = ?', [exportId]);
  if (!exp) throw new IntrouvableCompta('Envoi introuvable');
  if (exp.integre_le) throw new SaisieCompta('Cet envoi est intégré dans Ciril : retirez d’abord la confirmation.');
  await db.transaction(async () => {
    await db.execute('UPDATE sorties_inventaire SET export_id = NULL WHERE export_id = ?', [exportId]);
    await db.execute('DELETE FROM exports_comptables WHERE id = ?', [exportId]);
  });
  if (exp.chemin_local) {
    try { fs.unlinkSync(exp.chemin_local); } catch (_) {}
  }
  await journaliser(userId, 'export_annule', `Envoi ${exp.nom_fichier} annulé : ses ${exp.nb_lignes} sortie(s) reviennent dans la file`, null);
}

// =================================================================== biens

export async function listerBiens(filtre: { recherche?: string; sortis?: string; page?: number; limite?: number }) {
  const conditions = ['o.immobilisation_id IS NOT NULL'];
  const params: any[] = [];
  if (filtre.recherche?.trim()) {
    const motif = `%${filtre.recherche.trim()}%`;
    conditions.push('(i.numero LIKE ? OR i.libelle LIKE ? OR o.name LIKE ? OR o.inventaire_interne LIKE ? OR o.location LIKE ?)');
    params.push(motif, motif, motif, motif, motif);
  }
  if (filtre.sortis === 'oui') conditions.push("o.status = 'sorti'");
  else if (filtre.sortis === 'non') conditions.push("o.status <> 'sorti'");
  const limite = Math.min(200, Math.max(1, Number(filtre.limite) || 50));
  const page = Math.max(1, Number(filtre.page) || 1);
  const where = `WHERE ${conditions.join(' AND ')}`;
  const depuis = `FROM objects o
       JOIN immobilisations i ON i.id = o.immobilisation_id
       LEFT JOIN categories c ON c.id = o.category_id
       LEFT JOIN subcategories sc ON sc.id = o.subcategory_id
       LEFT JOIN categories c2 ON c2.id = sc.category_id
       LEFT JOIN sorties_inventaire s ON s.object_id = o.id
       LEFT JOIN exports_comptables e ON e.id = s.export_id`;

  const total = await db.queryOne(`SELECT COUNT(*) AS n ${depuis} ${where}`, params);
  const lignes = await db.query(
    `SELECT o.id, o.name, o.status, o.location, o.inventaire_interne, o.purchase_price,
            i.id AS immo_id, i.numero, i.libelle, i.valeur_acquisition, i.date_acquisition,
            COALESCE(c.name, c2.name) AS categorie, sc.name AS sous_categorie,
            s.date_sortie, s.motif, s.export_id, e.envoye_le, e.integre_le
       ${depuis} ${where}
      ORDER BY i.numero ASC, o.id ASC
      LIMIT ${limite} OFFSET ${(page - 1) * limite}`,
    params
  );
  return {
    total: Number(total?.n ?? 0),
    page,
    limite,
    biens: lignes.map((l: any) => ({
      id: Number(l.id),
      nom: l.name,
      statut: l.status,
      localisation: l.location ?? null,
      inventaireInterne: l.inventaire_interne ?? null,
      categorie: l.categorie ?? null,
      sousCategorie: l.sous_categorie ?? null,
      immobilisation: {
        id: Number(l.immo_id),
        numero: l.numero,
        libelle: l.libelle,
        valeur: l.valeur_acquisition === null ? null : Number(l.valeur_acquisition),
        dateAcquisition: l.date_acquisition,
      },
      sortie: l.date_sortie
        ? { date: l.date_sortie, motif: l.motif, motifLibelle: MOTIFS[l.motif as Motif] ?? l.motif, envoyeeLe: l.envoye_le ?? null, integreeLe: l.integre_le ?? null }
        : null,
    })),
  };
}

/** Fiche en lecture seule d'un bien immobilisé, pour qui n'a pas accès à sa catégorie. */
export async function ficheBien(objectId: number) {
  const o = await db.queryOne(
    `SELECT o.id, o.name, o.description, o.status, o.location, o.inventaire_interne, o.serial_number, o.reference,
            o.purchase_date, o.purchase_price, o.image,
            COALESCE(c.name, c2.name) AS categorie, sc.name AS sous_categorie,
            i.id AS immo_id, i.numero, i.libelle, i.valeur_acquisition, i.date_acquisition, i.compte, i.fournisseur,
            i.numero_facture, i.affectation
       FROM objects o
       JOIN immobilisations i ON i.id = o.immobilisation_id
       LEFT JOIN categories c ON c.id = o.category_id
       LEFT JOIN subcategories sc ON sc.id = o.subcategory_id
       LEFT JOIN categories c2 ON c2.id = sc.category_id
      WHERE o.id = ?`,
    [objectId]
  );
  if (!o) throw new IntrouvableCompta('Bien immobilisé introuvable');
  return {
    id: Number(o.id),
    nom: o.name,
    description: o.description ?? null,
    statut: o.status,
    localisation: o.location ?? null,
    inventaireInterne: o.inventaire_interne ?? null,
    numeroSerie: o.serial_number ?? null,
    reference: o.reference ?? null,
    image: o.image ?? null,
    categorie: o.categorie ?? null,
    sousCategorie: o.sous_categorie ?? null,
    immobilisation: {
      id: Number(o.immo_id),
      numero: o.numero,
      libelle: o.libelle,
      valeur: o.valeur_acquisition === null ? null : Number(o.valeur_acquisition),
      dateAcquisition: o.date_acquisition,
      compte: o.compte ?? null,
      fournisseur: o.fournisseur ?? null,
      numeroFacture: o.numero_facture ?? null,
      affectation: o.affectation ?? null,
    },
    sortie: await sortieDe(objectId),
  };
}

/** L'immobilisation liée à un objet, pour sa fiche ; `null` sans lien. */
export async function immobilisationDeObjet(objectId: number) {
  const i = await db
    .queryOne(
      `SELECT i.id, i.numero, i.libelle, i.valeur_acquisition, i.date_acquisition, i.fournisseur, i.numero_facture
         FROM objects o JOIN immobilisations i ON i.id = o.immobilisation_id WHERE o.id = ?`,
      [objectId]
    )
    .catch(() => null);
  return i
    ? {
        id: Number(i.id),
        numero: i.numero,
        libelle: i.libelle,
        valeur: i.valeur_acquisition === null ? null : Number(i.valeur_acquisition),
        dateAcquisition: i.date_acquisition,
        fournisseur: i.fournisseur ?? null,
        numeroFacture: i.numero_facture ?? null,
      }
    : null;
}

// =================================================================== suivi

export type Couleur = 'vert' | 'orange' | 'rouge';

function couleur(nombre: number, jours: number | null, seuil: number): Couleur {
  if (nombre === 0) return 'vert';
  return jours !== null && jours > seuil ? 'rouge' : 'orange';
}

/**
 * Le tableau de suivi : qui attend qui, en quatre chiffres.
 *
 *   à ranger             → l'inventaire ;
 *   sorties à envoyer    → l'envoi automatique, ou un envoi manuel ;
 *   envoyées à intégrer  → la compta ;
 *   dernier import Ciril → la compta, qui apporte ses nouvelles immobilisations.
 */
export async function lireSuivi(maintenant: Date = new Date()) {
  const reglages = await lireReglages();
  const seuil = reglages.seuilRetardJours;
  const aujourdhui = jourCourant(maintenant);
  const depuis = (instant: unknown) => {
    const j = jourDe(instant);
    return j ? Math.max(0, joursEntre(j, aujourdhui)) : null;
  };

  const [aRanger, aEnvoyer, horsCompta, aIntegrer, dernierImport, dernierEchec, mouvements, dernierEnvoi] = await Promise.all([
    db.queryOne("SELECT COUNT(*) AS n, MIN(created_at) AS plus_ancien FROM immobilisations WHERE etat = 'a_ranger'"),
    db.queryOne(
      `SELECT COUNT(*) AS n, MIN(s.created_at) AS plus_ancien FROM sorties_inventaire s
         JOIN objects o ON o.id = s.object_id WHERE s.export_id IS NULL AND o.immobilisation_id IS NOT NULL`
    ),
    db.queryOne(
      `SELECT COUNT(*) AS n FROM sorties_inventaire s JOIN objects o ON o.id = s.object_id
        WHERE s.export_id IS NULL AND o.immobilisation_id IS NULL`
    ),
    db.queryOne(
      `SELECT COUNT(*) AS n, COALESCE(SUM(nb_lignes), 0) AS biens, MIN(envoye_le) AS plus_ancien
         FROM exports_comptables WHERE envoye_le IS NOT NULL AND integre_le IS NULL`
    ),
    db.queryOne(
      `SELECT ic.*, u.first_name, u.last_name, u.email FROM imports_comptables ic
         LEFT JOIN users u ON u.id = ic.user_id ORDER BY ic.id DESC LIMIT 1`
    ),
    // Le dernier envoi dit si l'envoi est en panne : un succès depuis efface l'échec.
    db.queryOne(
      `SELECT created_at, erreur, envoye_le FROM exports_comptables
        WHERE origine <> 'telechargement' ORDER BY id DESC LIMIT 1`
    ),
    db.query(
      `SELECT a.id, a.action, a.details, a.created_at, u.first_name, u.last_name, u.email
         FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.entity_type = 'comptabilite' ORDER BY a.id DESC LIMIT 15`
    ),
    lireReglage(CLE_DERNIER_ENVOI),
  ]);

  const echecCourant =
    dernierEchec && !dernierEchec.envoye_le
      ? { le: dernierEchec.created_at, erreur: dernierEchec.erreur ?? 'Échec de l’envoi' }
      : null;

  const nRanger = Number(aRanger?.n ?? 0);
  const nEnvoyer = Number(aEnvoyer?.n ?? 0);
  const nIntegrer = Number(aIntegrer?.n ?? 0);
  const jRanger = nRanger ? depuis(aRanger?.plus_ancien) : null;
  const jEnvoyer = nEnvoyer ? depuis(aEnvoyer?.plus_ancien) : null;
  const jIntegrer = nIntegrer ? depuis(aIntegrer?.plus_ancien) : null;
  const jImport = dernierImport ? depuis(dernierImport.created_at) : null;

  return {
    seuil,
    aRanger: { nombre: nRanger, plusAncien: nRanger ? aRanger?.plus_ancien : null, jours: jRanger, couleur: couleur(nRanger, jRanger, seuil) },
    aEnvoyer: {
      nombre: nEnvoyer,
      plusAncienne: nEnvoyer ? aEnvoyer?.plus_ancien : null,
      jours: jEnvoyer,
      prochainEnvoi: prochainEnvoi(reglages, dernierEnvoi, maintenant),
      echec: echecCourant,
      couleur: echecCourant && nEnvoyer ? ('rouge' as Couleur) : couleur(nEnvoyer, jEnvoyer, Math.min(seuil, 2)),
    },
    horsCompta: Number(horsCompta?.n ?? 0),
    aIntegrer: {
      envois: nIntegrer,
      biens: Number(aIntegrer?.biens ?? 0),
      plusAncien: nIntegrer ? aIntegrer?.plus_ancien : null,
      jours: jIntegrer,
      couleur: couleur(nIntegrer, jIntegrer, seuil),
    },
    dernierImport: dernierImport
      ? {
          le: dernierImport.created_at,
          par: nomDe(dernierImport),
          lignes: Number(dernierImport.nb_lignes ?? 0),
          creees: Number(dernierImport.nb_creees ?? 0),
          misesAJour: Number(dernierImport.nb_mises_a_jour ?? 0),
          jours: jImport,
        }
      : null,
    mouvements: mouvements.map((m: any) => ({
      id: Number(m.id),
      action: m.action,
      details: m.details,
      le: m.created_at,
      par: nomDe(m),
    })),
  };
}
