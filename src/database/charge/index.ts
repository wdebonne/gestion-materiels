import bcrypt from 'bcryptjs';
import { db } from '../index';
import { Alea, Contexte } from './outils';
import { genererServices, genererUtilisateurs } from './utilisateurs';
import { genererParc } from './parc';
import { genererLieux } from './lieux';
import { genererCles } from './cles';
import { genererVehicules } from './vehicules';
import { genererReservations } from './reservations';
import { genererAgenda } from './agenda';
import { genererManifestations } from './manifestations';
import { genererTickets } from './tickets';
import { genererPlannings } from './plannings';
import { genererEspacesVerts } from './espacesVerts';
import { genererMobilier } from './mobilier';
import { genererJournal } from './journal';
import { dejaCharge, purger } from './purge';

/**
 * Jeu de données de test : le point d'entrée commun à la ligne de commande
 * (`npm run db:charge`) et à l'écran d'administration.
 */

export const MOT_DE_PASSE_TEST = 'Charge2026!';

const ETAPES: Array<[nom: string, generer: (ctx: Contexte) => Promise<void>]> = [
  ['Utilisateurs', genererUtilisateurs],
  ['Services', genererServices],
  ['Parc et plugins', genererParc],
  ['Sites et pièces', genererLieux],
  ['Clés', genererCles],
  ['Véhicules', genererVehicules],
  ['Réservations', genererReservations],
  ['Agenda et alertes', genererAgenda],
  ['Manifestations et salles', genererManifestations],
  ['Tickets', genererTickets],
  ['Plannings', genererPlannings],
  ['Espaces verts', genererEspacesVerts],
  ['Mobilier urbain', genererMobilier],
  ["Journal d'activité", genererJournal],
];

export const NOMBRE_ETAPES = ETAPES.length + 1;

export interface OptionsChargement {
  echelle: number;
  graine: number;
}

/** Appelé au début de chaque étape, puis une fois à la fin avec `null`. */
export type SuiviEtape = (etape: string | null, rang: number, dureeMs?: number) => void;

/**
 * Remplace le jeu de test précédent, s'il y en a un, par un nouveau.
 *
 * Chaque domaine tient dans sa propre transaction : une erreur au milieu des
 * tickets laisse les domaines précédents en place, que la purge sait retirer.
 */
export async function chargerDonneesTest(options: OptionsChargement, suivi: SuiviEtape = () => undefined): Promise<void> {
  if (!Number.isFinite(options.echelle) || options.echelle <= 0 || options.echelle > 50) {
    throw new Error("L'échelle doit être comprise entre 0 (exclu) et 50.");
  }

  const debutPurge = Date.now();
  suivi('Retrait du jeu précédent', 0);
  if (await dejaCharge()) await purger();
  suivi('Retrait du jeu précédent', 0, Date.now() - debutPurge);

  const admin = await db.queryOne<{ id: number }>("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  if (!admin) throw new Error('Aucun administrateur en base.');

  const ctx: Contexte = {
    alea: new Alea(options.graine),
    echelle: options.echelle,
    maintenant: new Date(),
    adminId: admin.id,
    motDePasse: await bcrypt.hash(MOT_DE_PASSE_TEST, 12),
    utilisateurs: [],
    services: [],
    categories: [],
    sousCategories: [],
    materiels: [],
    sites: [],
    pieces: [],
    ouvrants: [],
    manifestations: [],
    tickets: [],
  };

  for (const [rang, [nom, generer]] of ETAPES.entries()) {
    const debut = Date.now();
    suivi(nom, rang + 1);
    await db.transaction(() => generer(ctx));
    suivi(nom, rang + 1, Date.now() - debut);
  }
  suivi(null, NOMBRE_ETAPES);
}

export { dejaCharge, purger };
