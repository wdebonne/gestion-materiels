import fs from 'fs';
import path from 'path';
import { db } from '../database';

/**
 * Pièces jointes d'une manifestation : arrêtés, plans, constats, photos.
 *
 * Ce sont ces pièces qui font la différence en cas de litige, des mois plus
 * tard — la photo de la chaise revenue cassée, l'arrêté de circulation, le
 * constat du trottoir abîmé sur le lieu. Rien ne permettait de les conserver.
 *
 * Deux choix méritent d'être dits.
 *
 * **Le lien vers le matériel porte sur l'article, pas sur la ligne.**
 * `manifestation_materials` est supprimée puis réinsérée à chaque modification
 * d'une manifestation : un lien vers l'identifiant de ligne serait rompu au
 * premier changement de quantité. `stock_id` survit, et c'est déjà le
 * contournement retenu pour conserver les pertes.
 *
 * **Supprimer un document retire le fichier.** Partout ailleurs dans
 * l'application, supprimer un document ne supprime que la ligne et laisse le
 * fichier orphelin pour toujours — seul l'avatar fait exception. Un dossier de
 * manifestation contient des photos de sinistre : ne pas les effacer vraiment
 * est un manquement, et le disque n'a pas à conserver ce qu'on a demandé de
 * retirer.
 */

/** Type retenu quand celui qui est proposé n'existe pas ou plus. */
const TYPE_PAR_DEFAUT = 'autre';

export interface DocumentAJoindre {
  name: string;
  doc_type?: string | null;
  description?: string | null;
  file_path: string;
  mime_type?: string | null;
  size?: number | null;
  /** Article du stock concerné, facultatif. */
  stock_id?: number | null;
  /** Matériel unique du parc concerné, facultatif. */
  object_id?: number | null;
}

/**
 * Documents d'une manifestation, du plus récent au plus ancien.
 *
 * `q` filtre sur le libellé et la description — ce que l'on retient d'une pièce
 * des mois après, rarement son nom de fichier.
 */
export async function documentsDe(
  manifestationId: number | string,
  q?: string
): Promise<any[]> {
  let sql = `
    SELECT d.*, t.label as doc_type_label,
           ms.name as stock_name, o.name as object_name,
           (u.first_name || ' ' || u.last_name) as uploaded_by_name
    FROM manifestation_documents d
    LEFT JOIN manifestation_doc_types t ON t.value = d.doc_type
    LEFT JOIN manifestation_stock ms ON ms.id = d.stock_id
    LEFT JOIN objects o ON o.id = d.object_id
    LEFT JOIN users u ON u.id = d.uploaded_by
    WHERE d.manifestation_id = ?
  `;
  const params: any[] = [manifestationId];

  if (q) {
    sql += ' AND (d.name LIKE ? OR d.description LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }

  sql += ' ORDER BY d.created_at DESC, d.id DESC';
  return db.query(sql, params);
}

/** Un document précis, avec sa manifestation, pour les contrôles d'accès. */
export async function documentPrecis(docId: number | string): Promise<any | null> {
  return db.queryOne('SELECT * FROM manifestation_documents WHERE id = ?', [docId]);
}

/**
 * Type valide, ou repli.
 *
 * Un type désactivé depuis l'enregistrement, ou inventé par un appel direct, ne
 * doit pas rendre le document invisible dans les filtres : il retombe sur
 * « autre » plutôt que de porter une valeur que plus rien ne nomme.
 */
export async function typeValide(propose?: string | null): Promise<string> {
  if (!propose) return TYPE_PAR_DEFAUT;

  const connu = await db.queryOne(
    'SELECT value FROM manifestation_doc_types WHERE value = ? AND disabled = 0',
    [propose]
  );
  return connu ? propose : TYPE_PAR_DEFAUT;
}

/** Enregistre une pièce déjà téléversée, et rend son identifiant. */
export async function joindre(
  manifestationId: number | string,
  document: DocumentAJoindre,
  userId?: number
): Promise<number> {
  const resultat = await db.execute(
    `INSERT INTO manifestation_documents
       (manifestation_id, name, doc_type, description, file_path, mime_type, size,
        stock_id, object_id, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      manifestationId,
      document.name.trim(),
      await typeValide(document.doc_type),
      document.description?.trim() || null,
      document.file_path,
      document.mime_type ?? null,
      document.size ?? null,
      document.stock_id || null,
      document.object_id || null,
      userId ?? null,
      new Date().toISOString(),
    ]
  );
  return resultat.lastInsertRowid;
}

/**
 * Retire le fichier du disque.
 *
 * `file_path` est une URL publique (`/uploads/…`) : elle est ramenée à un chemin
 * relatif au projet, et tout ce qui sortirait du dossier des téléversements est
 * refusé — un `file_path` fabriqué ne doit pas pouvoir faire supprimer un
 * fichier de l'application.
 *
 * L'échec n'est jamais fatal : mieux vaut un fichier oublié qu'une suppression
 * qui refuse d'aboutir.
 */
export function supprimerFichier(filePath: string | null | undefined): boolean {
  if (!filePath) return false;

  try {
    const dossierUploads = path.resolve(process.cwd(), 'uploads');
    const relatif = filePath.replace(/^\/+/, '').replace(/^uploads[/\\]/, '');
    const complet = path.resolve(dossierUploads, relatif);

    if (!complet.startsWith(dossierUploads + path.sep)) return false;
    if (!fs.existsSync(complet)) return false;

    fs.unlinkSync(complet);
    return true;
  } catch (erreur: any) {
    console.error('Fichier joint non supprimé :', erreur?.message ?? erreur);
    return false;
  }
}

/** Supprime la ligne et le fichier. Rend `false` si le document n'existait pas. */
export async function detacher(docId: number | string): Promise<boolean> {
  const document = await documentPrecis(docId);
  if (!document) return false;

  await db.execute('DELETE FROM manifestation_documents WHERE id = ?', [docId]);
  supprimerFichier(document.file_path);
  return true;
}

/** Types proposés au choix ; `tous` inclut ceux qui sont désactivés, pour l'écran de gestion. */
export async function typesDocuments(tous = false): Promise<any[]> {
  const sql = tous
    ? 'SELECT * FROM manifestation_doc_types ORDER BY label'
    : 'SELECT * FROM manifestation_doc_types WHERE disabled = 0 ORDER BY label';

  const types = await db.query(sql);
  // `ORDER BY label` trie par octets en SQLite : « Élagage » passerait après
  // « Photo ». Le tri définitif se fait en français, à la lecture.
  return types.sort((a: any, b: any) => a.label.localeCompare(b.label, 'fr'));
}
