import multer from 'multer';
import path from 'path';
import fs from 'fs';
import type { Request } from 'express';
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
