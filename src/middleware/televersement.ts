import multer from 'multer';
import path from 'path';
import fs from 'fs';
import type { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Le dépôt de fichiers, écrit une fois pour tous ceux qui en ont besoin.
 *
 * Cette configuration vivait dans `upload.routes.ts`, où elle était liée à ses
 * gardes de rôle : `POST /api/upload/file` exige `requireFieldWrite`, donc
 * administrateur, superviseur ou agent de terrain.
 *
 * C'est le bon réglage pour le parc — un compte en consultation n'a pas à
 * déposer des documents sur du matériel. Ce serait le mauvais pour les
 * demandes : le demandeur d'un ticket est précisément un compte `user` ou
 * `service`, et joindre la photo du rideau cassé est ce qu'on attend de lui.
 *
 * Le module Tickets garde donc **la même mécanique** — même dossier, même
 * nommage par identifiant aléatoire, mêmes types, même plafond — mais la garde
 * autour d'elle n'est plus le rôle : c'est la portée du ticket. Extraire le
 * réglage ici évite de le recopier, donc de le voir diverger le jour où l'on
 * ajoutera un format.
 *
 * À ne pas confondre avec `src/services/upload.service.ts`, qui décrit un
 * rangement par sous-dossiers que `upload.routes.ts` n'emploie pas.
 */

/** Le dossier de dépôt, créé au besoin. */
export function dossierDepot(): string {
  const dossier = path.join(__dirname, '../../uploads');
  if (!fs.existsSync(dossier)) fs.mkdirSync(dossier, { recursive: true });
  return dossier;
}

/**
 * Rangement à plat, nom tiré au hasard.
 *
 * Le nom d'origine n'est jamais repris sur le disque : il porterait des
 * caractères de chemin, et deux personnes qui déposent « photo.jpg » se
 * marcheraient dessus. Il est conservé en base, dans la colonne `name`.
 */
export const stockageDisque = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, dossierDepot()),
  filename: (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
});

/**
 * Types acceptés en pièce jointe.
 *
 * Les formats bureautiques y figurent : un arrêté municipal arrive plus souvent
 * en traitement de texte qu'en PDF.
 */
export const TYPES_ACCEPTES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/plain',
  'text/csv',
];

export const REFUS_TYPE =
  'Type de fichier non autorisé. Utilisez une image, un PDF, un document Word, Excel ou OpenDocument';

export const filtreFichier = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (TYPES_ACCEPTES.includes(file.mimetype)) cb(null, true);
  else cb(new Error(REFUS_TYPE));
};

/** Filet de sécurité : le client réduit déjà les photos avant de les envoyer. */
export const TAILLE_MAX = 25 * 1024 * 1024;

/** Le téléversement d'une pièce jointe, tous formats acceptés. */
export const televersementPiece = multer({
  storage: stockageDisque,
  fileFilter: filtreFichier,
  limits: { fileSize: TAILLE_MAX },
});

// ---------------------------------------------------------- le dépôt privé

/**
 * Le dossier des fichiers qu'on ne sert pas en statique.
 *
 * `/uploads` est servi à tout compte connecté, sur la seule foi de son jeton :
 * quiconque connaît le nom d'un fichier l'ouvre. C'est acceptable pour la photo
 * d'un banc, pas pour le PPMS d'une école, qui décrit où les enfants se
 * cachent. Ces fichiers vont donc sous `uploads/prive/`, que `server.ts` ferme
 * au statique, et ne sortent que par une route qui vérifie les droits.
 *
 * Un sous-dossier de `uploads` et non un dossier à part : Docker ne conserve
 * que `uploads`, `data` et `backups`, et les sauvegardes emportent déjà tout
 * `uploads`. Un dossier neuf à la racine aurait été perdu à la première
 * recréation du conteneur.
 */
export function dossierPrive(sousDossier: string): string {
  const dossier = path.join(dossierDepot(), 'prive', sousDossier);
  if (!fs.existsSync(dossier)) fs.mkdirSync(dossier, { recursive: true });
  return dossier;
}

/**
 * Ferme `uploads/prive/` au service statique de `/uploads`.
 *
 * Un jeton valide ouvrirait sinon n'importe lequel de ses fichiers, dont les
 * PPMS des écoles ; ils sortent par des routes qui vérifient les droits
 * (`batiment.routes.ts`). Posé **avant** `express.static`.
 *
 * Le chemin est décodé et normalisé comme le fera `send` avant d'être comparé :
 * un simple préfixe laisserait passer `/uploads/%70rive/…`, `/uploads/./prive/…`
 * ou `/uploads/PRIVE/…` sur un disque insensible à la casse — tous résolus
 * ensuite vers le même fichier.
 */
export function fermerDossierPrive(req: Request, res: Response, next: NextFunction): void {
  let chemin: string;
  try {
    chemin = path.posix.normalize(decodeURIComponent(req.path).replace(/\\/g, '/'));
  } catch {
    res.status(400).end();
    return;
  }
  if (/^\/+prive(\/|$)/i.test(chemin)) {
    res.status(404).end();
    return;
  }
  next();
}

/**
 * Types acceptés dans le dépôt privé — **sans SVG**.
 *
 * Un SVG peut porter du script. Ouvert depuis l'application, il s'exécuterait
 * sous son origine, avec la session de l'agent qui l'ouvre ; et ces fichiers-là
 * arrivent d'entreprises extérieures. L'extension est vérifiée en plus du type
 * annoncé, que le navigateur de l'expéditeur choisit seul.
 */
export const TYPES_DOCUMENTS_PRIVES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/jpg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.oasis.opendocument.text': ['.odt'],
  'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
};

export const REFUS_TYPE_PRIVE =
  'Type de fichier non autorisé. Utilisez un PDF, une image JPEG ou PNG, un document Word, Excel ou OpenDocument';

/**
 * Les plans d'étage : des images seulement. Un plan reçu en PDF est converti en
 * image par le navigateur avant l'envoi — le serveur n'a pas de moteur de rendu
 * PDF —, et un plan DWG s'exporte d'abord en PDF.
 */
export const TYPES_PLANS: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/jpg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
};

export const REFUS_TYPE_PLAN = 'Le plan doit être une image PNG, JPEG ou WebP (un PDF est converti avant l’envoi)';

/**
 * Le nom d'origine d'un fichier déposé, accents compris.
 *
 * busboy décode l'en-tête `filename` en latin-1 alors que les navigateurs
 * l'envoient en UTF-8 : « Rapport électrique.pdf » arrivait en
 * « Rapport Ã©lectrique.pdf ». On relit donc les octets en UTF-8 — sauf si le
 * nom porte déjà des caractères hors latin-1 (il a alors été bien décodé), ou
 * si la relecture produit un caractère de remplacement (ce n'était pas de
 * l'UTF-8).
 */
export function nomDOrigine(fichier: Express.Multer.File): string {
  const brut = fichier.originalname ?? '';
  if (/[^\u0000-ÿ]/.test(brut)) return brut;
  const relu = Buffer.from(brut, 'latin1').toString('utf8');
  return relu.includes('�') ? brut : relu;
}

/**
 * Un téléversement vers `uploads/prive/<sousDossier>`.
 *
 * Le nom sur le disque est tiré au hasard et porte l'extension **vérifiée** :
 * jamais le nom d'origine, qui pourrait contenir un chemin.
 */
export function televersementPrive(
  sousDossier: string,
  types: Record<string, string[]> = TYPES_DOCUMENTS_PRIVES,
  refus: string = REFUS_TYPE_PRIVE
) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, dossierPrive(sousDossier)),
      filename: (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    fileFilter: (_req, file, cb) => {
      const extensions = types[file.mimetype];
      const extension = path.extname(file.originalname).toLowerCase();
      if (extensions && extensions.includes(extension)) cb(null, true);
      else cb(new Error(refus));
    },
    limits: { fileSize: TAILLE_MAX },
  });
}

/**
 * Rend le message d'une erreur multer en français.
 *
 * Sans lui, un fichier trop gros ressort en « LIMIT_FILE_SIZE », que personne
 * ne peut interpréter depuis un écran.
 */
export function messageErreurDepot(erreur: any): string {
  if (erreur instanceof multer.MulterError) {
    if (erreur.code === 'LIMIT_FILE_SIZE') {
      return `Fichier trop volumineux (maximum ${Math.round(TAILLE_MAX / 1024 / 1024)} Mo)`;
    }
    return `Dépôt refusé : ${erreur.message}`;
  }
  return String(erreur?.message ?? 'Dépôt refusé');
}
