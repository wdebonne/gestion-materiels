import { db } from '../database';

/**
 * Consigner un entretien d'espace vert, écrit une seule fois.
 *
 * Le geste existait déjà dans la fiche d'un espace vert : un chantier — une
 * tonte, un élagage, une reprise de peinture — daté, chiffré, rattaché aux
 * éléments concernés, et qui pose un rendez-vous au calendrier quand une
 * prochaine échéance est donnée.
 *
 * La cartographie a eu besoin du même geste, sur **un** élément, depuis le
 * terrain : quelqu'un qui passe devant le banc du square doit pouvoir noter
 * qu'il vient d'être repeint sans rouvrir le module des espaces verts, retrouver
 * le parc, ouvrir l'onglet Entretien et cocher l'élément dans une liste.
 *
 * Recopier les soixante lignes de la route aurait fait deux écritures de la même
 * chose — et la seconde aurait oublié, au premier ajout, la mise à jour des
 * dates sur l'élément ou l'événement de calendrier. D'où ce service, appelé par
 * les deux.
 */

export interface EntretienASaisir {
  maintenance_type: string;
  title?: string;
  description?: string;
  performed_date?: string | null;
  next_maintenance_date?: string | null;
  performed_by?: string;
  duration_minutes?: number | null;
  cost?: number | null;
  notes?: string;
  /** Les éléments du parc que ce chantier a touchés. */
  element_ids?: number[];
  document_ids?: number[];
}

/** Message unique, pour que le refus se lise pareil des deux côtés. */
export const REFUS_TYPE_ENTRETIEN = "Le type d'entretien est requis";

/**
 * Enregistre l'entretien et tout ce qui en découle, puis le rend.
 *
 * Ce qui en découle, précisément : le rattachement aux éléments, la recopie des
 * dates sur ces éléments — c'est elle qui fait qu'un arbre sait quand il a été
 * taillé sans relire tous les chantiers du parc —, les pièces jointes, et le
 * rendez-vous au calendrier.
 */
export async function consignerEntretien(
  greenSpaceId: number | string,
  corps: EntretienASaisir,
  userId?: number
): Promise<any> {
  const {
    maintenance_type,
    title,
    description,
    performed_date,
    next_maintenance_date,
    performed_by,
    duration_minutes,
    cost,
    notes,
    element_ids,
    document_ids,
  } = corps;

  const now = new Date().toISOString();
  const result = await db.execute(
    `INSERT INTO green_space_maintenances (green_space_id, maintenance_type, title, description, performed_date, next_maintenance_date, performed_by, duration_minutes, cost, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      greenSpaceId,
      maintenance_type,
      title || '',
      description || '',
      performed_date || null,
      next_maintenance_date || null,
      performed_by || '',
      duration_minutes || null,
      cost || null,
      notes || '',
      now,
      now,
    ]
  );

  const maintenanceId = result.lastInsertRowid;

  // Lier les éléments
  if (Array.isArray(element_ids)) {
    for (const eid of element_ids) {
      await db.execute(
        'INSERT INTO green_space_maintenance_elements (maintenance_id, element_id) VALUES (?, ?)',
        [maintenanceId, eid]
      );
    }
    // Mettre à jour la date de dernier entretien des éléments
    if (performed_date) {
      for (const eid of element_ids) {
        await db.execute('UPDATE green_space_elements SET last_maintenance_date = ? WHERE id = ?', [
          performed_date,
          eid,
        ]);
      }
    }
    if (next_maintenance_date) {
      for (const eid of element_ids) {
        await db.execute('UPDATE green_space_elements SET next_maintenance_date = ? WHERE id = ?', [
          next_maintenance_date,
          eid,
        ]);
      }
    }
  }

  // Lier les documents
  if (Array.isArray(document_ids)) {
    for (const did of document_ids) {
      await db.execute(
        'INSERT INTO green_space_maintenance_documents (maintenance_id, document_id) VALUES (?, ?)',
        [maintenanceId, did]
      );
    }
  }

  // Créer un événement calendrier si prochaine date d'entretien
  if (next_maintenance_date) {
    const space = await db.queryOne('SELECT name FROM green_spaces WHERE id = ?', [greenSpaceId]);
    const spaceName = space?.name || 'Espace vert';
    await db.execute(
      `INSERT INTO calendar_events (title, description, event_type, start_date, end_date, all_day, color, plugin_reference, plugin_reference_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `🌿 ${spaceName}: ${maintenance_type}`,
        `Entretien prévu - ${title || maintenance_type}${performed_by ? `\nIntervenant: ${performed_by}` : ''}`,
        'maintenance',
        next_maintenance_date,
        next_maintenance_date,
        1,
        '#16a34a',
        'green-space-maintenance',
        maintenanceId,
        userId,
      ]
    );
  }

  return db.queryOne('SELECT * FROM green_space_maintenances WHERE id = ?', [maintenanceId]);
}
