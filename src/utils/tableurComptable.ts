import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

/**
 * Lire et écrire les fichiers échangés avec un logiciel de comptabilité.
 *
 * L'import des matériels lit ses CSV par ExcelJS, qui suppose la virgule et
 * l'UTF-8. Un logiciel de gestion publique exporte presque toujours autre
 * chose : des points-virgules — la virgule y est le séparateur décimal —, un
 * encodage Windows, des montants « 1 234,56 » et des dates « 18/03/2026 ».
 * Lu par ExcelJS, un tel fichier arrive en une seule colonne aux accents
 * brouillés, et l'import échoue sur chaque ligne sans rien dire d'utile.
 *
 * Même chose à l'aller : le fichier des sorties doit s'ouvrir tel quel dans le
 * logiciel qui le reçoit. Séparateur et encodage sont donc réglables.
 */

export type Encodage = 'utf8' | 'windows-1252';

// ------------------------------------------------------------------ lecture

/**
 * Décode un fichier texte : UTF-8 s'il est valide, sinon Windows-1252.
 *
 * Un fichier Windows-1252 n'est presque jamais de l'UTF-8 valide dès qu'il
 * contient un accent : l'essai strict suffit à trancher, sans heuristique.
 */
export function decoderTexte(contenu: Buffer): string {
  let texte: string;
  try {
    texte = new TextDecoder('utf-8', { fatal: true }).decode(contenu);
  } catch {
    texte = new TextDecoder('windows-1252').decode(contenu);
  }
  return texte.charCodeAt(0) === 0xfeff ? texte.slice(1) : texte;
}

/** Le séparateur le plus fréquent de la première ligne, hors guillemets. */
export function detecterSeparateur(texte: string): string {
  const premiere = texte.split(/\r?\n/, 1)[0] ?? '';
  const comptes: Record<string, number> = { ';': 0, '\t': 0, ',': 0 };
  // La première ligne est celle des intitulés : un guillemet n'y protège un
  // champ que s'il l'ouvre, comme dans `analyserCsv`.
  let entreGuillemets = false;
  let debutChamp = true;
  for (const c of premiere) {
    if (entreGuillemets) {
      if (c === '"') entreGuillemets = false;
    } else if (c === '"' && debutChamp) {
      entreGuillemets = true;
    } else if (c in comptes) {
      comptes[c]++;
      debutChamp = true;
      continue;
    }
    debutChamp = false;
  }
  // À égalité, et sans aucun séparateur, le point-virgule : c'est l'usage des
  // logiciels français. Le tri est stable et `;` vient en premier.
  const [separateur, nombre] = Object.entries(comptes).sort((a, b) => b[1] - a[1])[0];
  return nombre > 0 ? separateur : ';';
}

/**
 * Découpe un CSV : guillemets doublés, retours à la ligne dans un champ.
 *
 * Un guillemet ne protège un champ que s'il l'**ouvre**. Au milieu d'un champ,
 * il est un caractère comme un autre : « Ordinateur portable 14" » arrive
 * ainsi d'un logiciel qui n'échappe pas le signe des pouces. Le prendre pour
 * une ouverture avalait la ligne suivante dans la désignation.
 */
export function analyserCsv(texte: string, separateur: string): string[][] {
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = '';
  let entreGuillemets = false;
  let debutChamp = true;

  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (entreGuillemets) {
      if (c === '"' && texte[i + 1] === '"') {
        champ += '"';
        i++;
      } else if (c === '"') {
        entreGuillemets = false;
      } else {
        champ += c;
      }
    } else if (c === '"' && debutChamp) {
      entreGuillemets = true;
      debutChamp = false;
    } else if (c === separateur) {
      ligne.push(champ);
      champ = '';
      debutChamp = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++;
      ligne.push(champ);
      lignes.push(ligne);
      ligne = [];
      champ = '';
      debutChamp = true;
    } else {
      champ += c;
      debutChamp = false;
    }
  }
  if (champ !== '' || ligne.length > 0) {
    ligne.push(champ);
    lignes.push(ligne);
  }

  // Les lignes vides — souvent la dernière — ne sont pas des lignes.
  return lignes.filter((l) => l.some((v) => v.trim() !== ''));
}

/** Le texte d'une cellule ExcelJS, les dates en jour ISO. */
function texteCellule(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return '';
  if (valeur instanceof Date) {
    // ExcelJS rend les dates d'un classeur à minuit UTC.
    return valeur.toISOString().slice(0, 10);
  }
  if (typeof valeur === 'object') {
    const v = valeur as any;
    if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('');
    if (v.result !== undefined) return texteCellule(v.result);
    if (v.text !== undefined) return String(v.text);
    if (v.hyperlink !== undefined) return String(v.hyperlink);
  }
  return String(valeur);
}

/**
 * Un fichier téléversé, en tableau de lignes de texte (index à partir de 0).
 * La première ligne est celle des intitulés.
 */
export async function lireTableau(chemin: string, nomOriginal: string): Promise<string[][]> {
  const ext = path.extname(nomOriginal).toLowerCase();

  if (ext === '.csv' || ext === '.txt') {
    const texte = decoderTexte(fs.readFileSync(chemin));
    return analyserCsv(texte, detecterSeparateur(texte)).map((l) => l.map((v) => v.trim()));
  }

  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.readFile(chemin);
  const feuille = classeur.worksheets[0];
  if (!feuille) return [];

  const lignes: string[][] = [];
  feuille.eachRow({ includeEmpty: false }, (row) => {
    const valeurs = (row.values as unknown[]) ?? [];
    // ExcelJS numérote à partir de 1 et laisse la case 0 vide.
    lignes.push(valeurs.slice(1).map((v) => texteCellule(v).trim()));
  });
  return lignes.filter((l) => l.some((v) => v !== ''));
}

/**
 * « 1 234,56 € », « 1234.56 », « -12,5 » → nombre ; `null` si illisible.
 *
 * Point et virgule sont tous deux admis comme séparateur décimal : c'est le
 * dernier des deux qui l'est, l'autre sépare les milliers.
 */
export function versMontant(brut: unknown): number | null {
  if (typeof brut === 'number') return Number.isFinite(brut) ? brut : null;
  let texte = String(brut ?? '')
    .replace(/[\s  €]/g, '')
    .replace(/EUR$/i, '');
  if (!texte) return null;

  const virgule = texte.lastIndexOf(',');
  const point = texte.lastIndexOf('.');
  if (virgule > point) texte = texte.replace(/\./g, '').replace(',', '.');
  else if (point > virgule && virgule !== -1) texte = texte.replace(/,/g, '');

  if (!/^-?\d+(\.\d+)?$/.test(texte)) return null;
  return Math.round(Number(texte) * 100) / 100;
}

/** Le jour ISO d'une date UTC. */
function enJour(annee: number, mois: number, jour: number): string | null {
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  if (d.getUTCFullYear() !== annee || d.getUTCMonth() !== mois - 1 || d.getUTCDate() !== jour) return null;
  return `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

/**
 * « 18/03/2026 », « 18-03-26 », « 2026-03-18 », « 2026-03-18T00:00:00 » ou un
 * numéro de série Excel → « 2026-03-18 » ; `null` si illisible.
 */
export function versJourISO(brut: unknown): string | null {
  const texte = String(brut ?? '').trim();
  if (!texte) return null;

  let m = texte.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return enJour(Number(m[1]), Number(m[2]), Number(m[3]));

  m = texte.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    let annee = Number(m[3]);
    if (m[3].length === 2) annee += annee < 70 ? 2000 : 1900;
    return enJour(annee, Number(m[2]), Number(m[1]));
  }

  // Numéro de série Excel : jours depuis le 30/12/1899. Borné pour ne pas
  // prendre un montant ou un numéro pour une date.
  if (/^\d{5}(\.\d+)?$/.test(texte)) {
    const serie = Math.floor(Number(texte));
    if (serie > 20000 && serie < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serie * 86400000);
      return enJour(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }
  return null;
}

// ------------------------------------------------------------------ écriture

/**
 * Windows-1252 : Latin-1, plus les caractères que Windows a logés entre 0x80 et
 * 0x9F — l'euro et les guillemets typographiques en tête.
 */
const WINDOWS_1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Encode en Windows-1252 ; un caractère hors table devient « ? ». */
export function encoderWindows1252(texte: string): Buffer {
  const octets: number[] = [];
  for (const c of texte) {
    const code = c.codePointAt(0)!;
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) octets.push(code);
    else octets.push(WINDOWS_1252[code] ?? 0x3f);
  }
  return Buffer.from(octets);
}

/**
 * Un CSV prêt à importer : lignes terminées par CRLF, champs entre guillemets
 * seulement quand il le faut. En UTF-8, une marque d'ordre en tête, sans
 * laquelle Excel lit les accents de travers.
 */
export function ecrireCsv(lignes: Array<Array<string | number | null>>, separateur: string, encodage: Encodage): Buffer {
  const echapper = (v: string | number | null) => {
    const texte = v === null || v === undefined ? '' : String(v);
    return /["\r\n]/.test(texte) || texte.includes(separateur) ? `"${texte.replace(/"/g, '""')}"` : texte;
  };
  const texte = lignes.map((l) => l.map(echapper).join(separateur)).join('\r\n') + '\r\n';
  return encodage === 'windows-1252' ? encoderWindows1252(texte) : Buffer.from('﻿' + texte, 'utf8');
}

/** Le même tableau en classeur Excel, première ligne en gras. */
export async function ecrireXlsx(lignes: Array<Array<string | number | null>>, nomFeuille: string): Promise<Buffer> {
  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet(nomFeuille);
  for (const l of lignes) feuille.addRow(l);
  feuille.getRow(1).font = { bold: true };
  feuille.columns.forEach((c) => {
    c.width = 18;
  });
  return Buffer.from(await classeur.xlsx.writeBuffer());
}
