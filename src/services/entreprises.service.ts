import bcrypt from 'bcryptjs';
import { db } from '../database';
import { tirerJeton } from '../utils/jetonOpaque';
import { estJourValide } from '../utils/periodes';
import { ErreurBatiment } from './batiments.service';
import { adressesEntreprise } from './batimentsNotify.service';
import { sendEmail } from './email.service';
import { versDateTime } from './tickets.service';

/**
 * Les entreprises extérieures et leur accès au portail des documents.
 *
 * ## Le code ne se relit pas
 *
 * Seule son empreinte bcrypt est gardée — le même traitement qu'un mot de
 * passe, parce qu'il en tient lieu. Il est montré **une fois**, à la
 * génération, à la personne qui l'envoie ; « renvoyer l'accès » en tire donc
 * un nouveau, et l'ancien cesse de fonctionner. C'est aussi ce qui permet de
 * couper l'accès d'un salarié parti : on régénère.
 *
 * Huit caractères dans l'alphabet sans ambiguïté de `jetonOpaque` — ni 0/O ni
 * 1/I —, présentés `ABCD-EFGH` pour se dicter au téléphone. Environ quarante
 * bits : peu contre une empreinte volée, assez contre des essais en ligne, que
 * le portail limite par adresse et par lien.
 */

const ARRONDIS_BCRYPT = () => parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

const COURRIEL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ContactEntreprise {
  id?: number;
  nom: string;
  fonction: string | null;
  telephone: string | null;
  email: string | null;
  recoitAcces: boolean;
}

export interface DroitRubrique {
  rubriqueId: number;
  lecture: boolean;
  depot: boolean;
}

export type EtatAcces = 'aucun' | 'actif' | 'suspendu' | 'expire' | 'bloque' | 'inactive';

export interface Entreprise {
  id: number;
  nom: string;
  email: string;
  telephone: string | null;
  adresse: string | null;
  codePostal: string | null;
  ville: string | null;
  siret: string | null;
  notes: string | null;
  actif: boolean;
  acces: {
    etat: EtatAcces;
    genereLe: string | null;
    fin: string | null;
    suspendu: boolean;
    bloqueJusqua: string | null;
    derniereConnexion: string | null;
  };
  lienJeton: string;
  contacts: ContactEntreprise[];
  sites: number[];
  rubriques: DroitRubrique[];
  documents: number;
}

const texte = (valeur: unknown, max = 255): string | null => {
  if (valeur === undefined || valeur === null) return null;
  const t = String(valeur).trim();
  return t ? t.slice(0, max) : null;
};
const vrai = (valeur: unknown): boolean => Boolean(Number(valeur ?? 0));
const jourLocal = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** L'état de l'accès, tel que l'écran et le portail le disent. */
export function etatAcces(l: any, maintenant = new Date()): EtatAcces {
  if (!vrai(l.actif)) return 'inactive';
  if (!l.code_hash) return 'aucun';
  if (vrai(l.acces_suspendu)) return 'suspendu';
  if (l.acces_fin && String(l.acces_fin) < jourLocal(maintenant)) return 'expire';
  if (l.bloque_jusqu_a && String(l.bloque_jusqu_a) > versDateTime(maintenant)) return 'bloque';
  return 'actif';
}

function enEntreprise(l: any, details: Partial<Entreprise> = {}): Entreprise {
  return {
    id: Number(l.id),
    nom: l.nom,
    email: l.email,
    telephone: l.telephone ?? null,
    adresse: l.adresse ?? null,
    codePostal: l.code_postal ?? null,
    ville: l.ville ?? null,
    siret: l.siret ?? null,
    notes: l.notes ?? null,
    actif: vrai(l.actif),
    acces: {
      etat: etatAcces(l),
      genereLe: l.code_genere_le ? String(l.code_genere_le) : null,
      fin: l.acces_fin ?? null,
      suspendu: vrai(l.acces_suspendu),
      bloqueJusqua: l.bloque_jusqu_a ? String(l.bloque_jusqu_a) : null,
      derniereConnexion: l.derniere_connexion ? String(l.derniere_connexion) : null,
    },
    lienJeton: l.lien_jeton,
    contacts: [],
    sites: [],
    rubriques: [],
    documents: Number(l.nb_documents ?? 0),
    ...details,
  };
}

// ================================================================== lectures

export async function listerEntreprises(): Promise<
  Array<Entreprise & { nbSites: number; nbRubriques: number; nbContacts: number }>
> {
  const lignes = await db.query(
    `SELECT e.*,
            (SELECT COUNT(*) FROM entreprise_sites s WHERE s.entreprise_id = e.id) AS nb_sites,
            (SELECT COUNT(*) FROM entreprise_rubriques r WHERE r.entreprise_id = e.id) AS nb_rubriques,
            (SELECT COUNT(*) FROM entreprise_contacts c WHERE c.entreprise_id = e.id) AS nb_contacts,
            (SELECT COUNT(*) FROM batiment_documents d WHERE d.entreprise_id = e.id) AS nb_documents
       FROM entreprises e
      ORDER BY e.actif DESC, e.nom`
  );
  return lignes.map((l: any) => ({
    ...enEntreprise(l),
    nbSites: Number(l.nb_sites),
    nbRubriques: Number(l.nb_rubriques),
    nbContacts: Number(l.nb_contacts),
  }));
}

export async function lireEntreprise(id: number | string): Promise<Entreprise | null> {
  const ligne = await db.queryOne(
    `SELECT e.*, (SELECT COUNT(*) FROM batiment_documents d WHERE d.entreprise_id = e.id) AS nb_documents
       FROM entreprises e WHERE e.id = ?`,
    [id]
  );
  if (!ligne) return null;

  const [contacts, sites, rubriques] = await Promise.all([
    db.query('SELECT * FROM entreprise_contacts WHERE entreprise_id = ? ORDER BY sort_order, id', [id]),
    db.query('SELECT site_id FROM entreprise_sites WHERE entreprise_id = ?', [id]),
    db.query('SELECT rubrique_id, lecture, depot FROM entreprise_rubriques WHERE entreprise_id = ?', [id]),
  ]);

  return enEntreprise(ligne, {
    contacts: contacts.map((c: any) => ({
      id: Number(c.id),
      nom: c.nom,
      fonction: c.fonction ?? null,
      telephone: c.telephone ?? null,
      email: c.email ?? null,
      recoitAcces: vrai(c.recoit_acces),
    })),
    sites: sites.map((s: any) => Number(s.site_id)),
    rubriques: rubriques.map((r: any) => ({
      rubriqueId: Number(r.rubrique_id),
      lecture: vrai(r.lecture),
      depot: vrai(r.depot),
    })),
  });
}

// ================================================================== écritures

export interface EntrepriseSaisie {
  nom?: unknown;
  email?: unknown;
  telephone?: unknown;
  adresse?: unknown;
  codePostal?: unknown;
  ville?: unknown;
  siret?: unknown;
  notes?: unknown;
  actif?: unknown;
}

function lireCourriel(valeur: unknown): string {
  const email = texte(valeur);
  if (!email || !COURRIEL.test(email)) throw new ErreurBatiment(400, 'Une adresse électronique valide est obligatoire');
  return email;
}

/** Un lien neuf, qu'aucune autre entreprise ne porte. */
async function lienLibre(): Promise<string> {
  for (let essai = 0; essai < 5; essai++) {
    const lien = tirerJeton(22);
    if (!(await db.queryOne('SELECT id FROM entreprises WHERE lien_jeton = ?', [lien]))) return lien;
  }
  throw new Error('Impossible de tirer un lien de portail libre');
}

export async function creerEntreprise(saisie: EntrepriseSaisie, userId: number): Promise<number> {
  const nom = texte(saisie.nom);
  if (!nom) throw new ErreurBatiment(400, "Le nom de l'entreprise est obligatoire");
  const maintenant = versDateTime();
  const resultat = await db.execute(
    `INSERT INTO entreprises
       (nom, email, telephone, adresse, code_postal, ville, siret, notes, actif, lien_jeton,
        created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [
      nom,
      lireCourriel(saisie.email),
      texte(saisie.telephone, 50),
      texte(saisie.adresse, 500),
      texte(saisie.codePostal, 10),
      texte(saisie.ville, 120),
      texte(saisie.siret, 20),
      texte(saisie.notes, 5000),
      await lienLibre(),
      userId,
      maintenant,
      maintenant,
    ]
  );
  return Number(resultat.lastInsertRowid);
}

export async function modifierEntreprise(id: number, saisie: EntrepriseSaisie): Promise<void> {
  if (!(await db.queryOne('SELECT id FROM entreprises WHERE id = ?', [id]))) {
    throw new ErreurBatiment(404, 'Entreprise introuvable');
  }
  const champs: string[] = [];
  const valeurs: unknown[] = [];
  const poser = (colonne: string, valeur: unknown) => {
    champs.push(`${colonne} = ?`);
    valeurs.push(valeur);
  };

  if (saisie.nom !== undefined) {
    const nom = texte(saisie.nom);
    if (!nom) throw new ErreurBatiment(400, "Le nom de l'entreprise est obligatoire");
    poser('nom', nom);
  }
  if (saisie.email !== undefined) poser('email', lireCourriel(saisie.email));
  if (saisie.telephone !== undefined) poser('telephone', texte(saisie.telephone, 50));
  if (saisie.adresse !== undefined) poser('adresse', texte(saisie.adresse, 500));
  if (saisie.codePostal !== undefined) poser('code_postal', texte(saisie.codePostal, 10));
  if (saisie.ville !== undefined) poser('ville', texte(saisie.ville, 120));
  if (saisie.siret !== undefined) poser('siret', texte(saisie.siret, 20));
  if (saisie.notes !== undefined) poser('notes', texte(saisie.notes, 5000));
  if (saisie.actif !== undefined) poser('actif', saisie.actif ? 1 : 0);
  if (champs.length === 0) return;

  poser('updated_at', versDateTime());
  await db.execute(`UPDATE entreprises SET ${champs.join(', ')} WHERE id = ?`, [...valeurs, id]);
  // Désactivée, elle n'a plus de session ouverte.
  if (saisie.actif !== undefined && !saisie.actif) await fermerSessions(id);
}

/**
 * Supprime une entreprise qui n'a rien déposé.
 *
 * Ses rapports restent des pièces du dossier du bâtiment : on ne les détache
 * pas de leur auteur. Une entreprise qui en a remis se désactive.
 */
export async function supprimerEntreprise(id: number): Promise<void> {
  const entreprise = await lireEntreprise(id);
  if (!entreprise) throw new ErreurBatiment(404, 'Entreprise introuvable');
  if (entreprise.documents > 0) {
    throw new ErreurBatiment(
      409,
      `Cette entreprise a déposé ${entreprise.documents} document(s) : désactivez-la plutôt`
    );
  }
  await db.execute('DELETE FROM entreprises WHERE id = ?', [id]);
}

/** Remplace la liste des contacts. */
export async function definirContacts(id: number, contacts: unknown): Promise<void> {
  if (!Array.isArray(contacts)) throw new ErreurBatiment(400, 'Liste de contacts attendue');
  if (!(await db.queryOne('SELECT id FROM entreprises WHERE id = ?', [id]))) {
    throw new ErreurBatiment(404, 'Entreprise introuvable');
  }
  const lus = contacts.map((c: any, rang) => {
    const nom = texte(c?.nom);
    if (!nom) throw new ErreurBatiment(400, `Contact n° ${rang + 1} : le nom est obligatoire`);
    const email = texte(c?.email);
    if (email && !COURRIEL.test(email)) throw new ErreurBatiment(400, `Contact « ${nom} » : adresse invalide`);
    return { nom, fonction: texte(c?.fonction, 120), telephone: texte(c?.telephone, 50), email, recoit: c?.recoitAcces ? 1 : 0 };
  });

  await db.transaction(async () => {
    await db.execute('DELETE FROM entreprise_contacts WHERE entreprise_id = ?', [id]);
    for (const [rang, c] of lus.entries()) {
      await db.execute(
        `INSERT INTO entreprise_contacts (entreprise_id, nom, fonction, telephone, email, recoit_acces, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, c.nom, c.fonction, c.telephone, c.email, c.recoit, rang]
      );
    }
  });
}

/**
 * Remplace les droits : les bâtiments ouverts, et les objets avec lecture
 * et/ou dépôt. Un objet ni lu ni déposé n'est pas gardé.
 */
export async function definirDroits(id: number, droits: { sites?: unknown; rubriques?: unknown }): Promise<void> {
  if (!(await db.queryOne('SELECT id FROM entreprises WHERE id = ?', [id]))) {
    throw new ErreurBatiment(404, 'Entreprise introuvable');
  }
  const sites = [...new Set((Array.isArray(droits.sites) ? droits.sites : []).map(Number))].filter(
    (s) => Number.isInteger(s) && s > 0
  );
  const rubriques = (Array.isArray(droits.rubriques) ? droits.rubriques : [])
    .map((r: any) => ({ rubriqueId: Number(r?.rubriqueId), lecture: Boolean(r?.lecture), depot: Boolean(r?.depot) }))
    .filter((r) => Number.isInteger(r.rubriqueId) && r.rubriqueId > 0 && (r.lecture || r.depot));

  if (sites.length > 0) {
    const connus = await db.query(`SELECT id FROM cle_sites WHERE id IN (${sites.map(() => '?').join(', ')})`, sites);
    if (connus.length !== sites.length) throw new ErreurBatiment(400, 'Bâtiment inconnu');
  }
  const idsRubriques = [...new Set(rubriques.map((r) => r.rubriqueId))];
  if (idsRubriques.length > 0) {
    const connues = await db.query(
      `SELECT id FROM batiment_rubriques WHERE id IN (${idsRubriques.map(() => '?').join(', ')})`,
      idsRubriques
    );
    if (connues.length !== idsRubriques.length) throw new ErreurBatiment(400, 'Objet inconnu');
  }

  await db.transaction(async () => {
    await db.execute('DELETE FROM entreprise_sites WHERE entreprise_id = ?', [id]);
    await db.execute('DELETE FROM entreprise_rubriques WHERE entreprise_id = ?', [id]);
    for (const siteId of sites) {
      await db.execute('INSERT INTO entreprise_sites (entreprise_id, site_id) VALUES (?, ?)', [id, siteId]);
    }
    const vues = new Set<number>();
    for (const r of rubriques) {
      if (vues.has(r.rubriqueId)) continue;
      vues.add(r.rubriqueId);
      await db.execute(
        'INSERT INTO entreprise_rubriques (entreprise_id, rubrique_id, lecture, depot) VALUES (?, ?, ?, ?)',
        [id, r.rubriqueId, r.lecture ? 1 : 0, r.depot ? 1 : 0]
      );
    }
  });
}

// ===================================================================== l'accès

/** `abcd efgh`, `ABCD-EFGH` : le code tel qu'on le compare. */
export function normaliserCode(code: unknown): string {
  return String(code ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export const presenterCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

export async function fermerSessions(entrepriseId: number): Promise<void> {
  await db.execute('DELETE FROM entreprise_sessions WHERE entreprise_id = ?', [entrepriseId]);
}

/**
 * Tire un code neuf et le rend **en clair, une seule fois**.
 *
 * L'ancien code cesse de fonctionner et les sessions ouvertes sont fermées :
 * c'est le geste qui coupe l'accès d'un salarié parti. Le compteur d'échecs et
 * le verrou repartent de zéro.
 */
export async function genererAcces(id: number): Promise<string> {
  const entreprise = await db.queryOne('SELECT id, actif FROM entreprises WHERE id = ?', [id]);
  if (!entreprise) throw new ErreurBatiment(404, 'Entreprise introuvable');
  if (!vrai(entreprise.actif)) throw new ErreurBatiment(409, "L'entreprise est désactivée : réactivez-la d'abord");

  const code = tirerJeton(8);
  await db.execute(
    `UPDATE entreprises
        SET code_hash = ?, code_genere_le = ?, tentatives_echouees = 0, bloque_jusqu_a = NULL, updated_at = ?
      WHERE id = ?`,
    [await bcrypt.hash(code, ARRONDIS_BCRYPT()), versDateTime(), versDateTime(), id]
  );
  await fermerSessions(id);
  return presenterCode(code);
}

/** Date de fin et suspension. Suspendre ferme les sessions ouvertes. */
export async function reglerAcces(id: number, reglage: { fin?: unknown; suspendu?: unknown }): Promise<void> {
  if (!(await db.queryOne('SELECT id FROM entreprises WHERE id = ?', [id]))) {
    throw new ErreurBatiment(404, 'Entreprise introuvable');
  }
  const champs: string[] = [];
  const valeurs: unknown[] = [];
  if (reglage.fin !== undefined) {
    const fin = reglage.fin === null || reglage.fin === '' ? null : reglage.fin;
    if (fin !== null && !estJourValide(fin)) throw new ErreurBatiment(400, 'Date de fin invalide');
    champs.push('acces_fin = ?');
    valeurs.push(fin);
  }
  if (reglage.suspendu !== undefined) {
    champs.push('acces_suspendu = ?');
    valeurs.push(reglage.suspendu ? 1 : 0);
  }
  if (champs.length === 0) return;
  await db.execute(`UPDATE entreprises SET ${champs.join(', ')}, updated_at = ? WHERE id = ?`, [
    ...valeurs,
    versDateTime(),
    id,
  ]);
  if (reglage.suspendu) await fermerSessions(id);
}

/** Lève le verrou posé après trop d'essais manqués. */
export async function deverrouiller(id: number): Promise<void> {
  await db.execute('UPDATE entreprises SET tentatives_echouees = 0, bloque_jusqu_a = NULL WHERE id = ?', [id]);
}

/**
 * L'adresse du portail d'une entreprise.
 *
 * Même source que le lien de réinitialisation du mot de passe — `CLIENT_URL`,
 * l'adresse de l'interface —, puis l'URL du site réglée dans les paramètres,
 * puis `APP_URL`, puis l'hôte de la requête. L'écran d'accès montre l'adresse
 * obtenue : une installation mal réglée se voit avant qu'on l'envoie.
 */
export async function urlPortail(lienJeton: string, hote?: string): Promise<string> {
  const reglage = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key = 'site_url'");
  const base = (process.env.CLIENT_URL || reglage?.setting_value || process.env.APP_URL || hote || '').replace(/\/+$/, '');
  return `${base}/prestataires/${lienJeton}`;
}

export type ResultatEnvoi = 'envoye' | 'retenu' | 'echec';

/**
 * Envoie le lien — et le code, sauf si l'on préfère le donner de vive voix —
 * à l'entreprise et à ses contacts qui reçoivent l'accès.
 *
 * `retenu` : aucune adresse n'a été remise (domaine réservé aux essais,
 * suspension). `echec` : pas de serveur de courrier, ou il a refusé. Dans les
 * deux cas l'écran montre le lien et le code, à copier.
 */
export async function envoyerAcces(
  id: number,
  code: string,
  options: { inclureCode: boolean; hote?: string }
): Promise<{ resultat: ResultatEnvoi; destinataires: string[]; message?: string }> {
  const entreprise = await lireEntreprise(id);
  if (!entreprise) throw new ErreurBatiment(404, 'Entreprise introuvable');
  const destinataires = await adressesEntreprise(id);

  try {
    const parti = await sendEmail('entreprise_acces', destinataires.join(', '), {
      entreprise: entreprise.nom,
      lien: await urlPortail(entreprise.lienJeton, options.hote),
      code: options.inclureCode ? code : '',
      avec_code: options.inclureCode,
      fin: entreprise.acces.fin ? entreprise.acces.fin.split('-').reverse().join('/') : '',
    });
    return { resultat: parti ? 'envoye' : 'retenu', destinataires };
  } catch (erreur) {
    return { resultat: 'echec', destinataires, message: (erreur as Error).message };
  }
}
