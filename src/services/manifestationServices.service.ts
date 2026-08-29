import { db } from '../database';

/**
 * Qui est concerné par une manifestation — et donc qui est sollicité et alerté.
 *
 * C'est la règle centrale du module. Un service est un groupe de personnes **et**
 * un périmètre de catégories de matériel. Il n'est concerné par une manifestation
 * que si celle-ci demande du matériel de ses catégories.
 *
 * Sans cette règle, le choix se réduisait à « tout le monde reçoit tout » ou
 * « personne ne reçoit rien ». Le service informatique était alerté d'une
 * brocante sans matériel informatique, et le service restauration d'une réunion
 * sans repas : c'est exactement ce qui fait qu'on cesse de lire les alertes, et
 * qu'on rate celle qui comptait.
 *
 * Les services observateurs — direction générale, élus — échappent à cette règle
 * par construction : ils suivent tout, sans rien approuver.
 */

export type StatutApprobation = 'pending' | 'approved' | 'rejected' | 'not_concerned';
export type TypeSollicitation = 'approbation' | 'information';

const marqueurs = (valeurs: readonly unknown[]): string => valeurs.map(() => '?').join(',');

/**
 * Services dont le périmètre couvre au moins une ligne de matériel demandée.
 *
 * Le rattachement suit la catégorie directe de l'article **ou** celle de sa
 * sous-catégorie : les deux colonnes coexistent dans `manifestation_stock` et
 * l'une peut être nulle. Un article sans catégorie ne concerne personne — il ne
 * relève d'aucun service, et l'inventer serait pire que de ne rien dire.
 */
export async function servicesConcernes(manifestationId: number | string): Promise<any[]> {
  return db.query(
    `SELECT DISTINCT s.*
     FROM services s
     JOIN service_categories sc ON sc.service_id = s.id
     JOIN manifestation_stock ms
       ON ms.category_id = sc.category_id
       OR EXISTS (
         SELECT 1 FROM subcategories sub
         WHERE sub.id = ms.subcategory_id AND sub.category_id = sc.category_id
       )
     JOIN manifestation_materials mm ON mm.stock_id = ms.id
     WHERE mm.manifestation_id = ? AND s.is_active = 1 AND mm.quantity_requested > 0
     ORDER BY s.name`,
    [manifestationId]
  );
}

/** Services qui suivent toutes les manifestations sans rien avoir à approuver. */
export async function servicesObservateurs(): Promise<any[]> {
  return db.query('SELECT * FROM services WHERE is_observer = 1 AND is_active = 1 ORDER BY name');
}

/**
 * Crée les approbations manquantes pour les services concernés.
 *
 * Rejouable : appelée à la validation et à chaque modification du matériel, elle
 * n'ajoute que ce qui manque. Une décision déjà rendue n'est jamais effacée —
 * un service qui a approuvé ne doit pas se voir redemander son avis parce que
 * quelqu'un a corrigé une faute de frappe dans le titre.
 *
 * Rend les approbations nouvellement créées, pour que l'appelant sache qui
 * prévenir.
 */
export async function creerApprobationsManquantes(
  manifestationId: number | string,
  demandeurId?: number
): Promise<any[]> {
  const concernes = await servicesConcernes(manifestationId);
  if (concernes.length === 0) return [];

  const existantes = await db.query(
    'SELECT service_id FROM manifestation_approvals WHERE manifestation_id = ? AND service_id IS NOT NULL',
    [manifestationId]
  );
  const dejaSollicites = new Set(existantes.map((a: any) => a.service_id));

  const creees: any[] = [];
  for (const service of concernes) {
    if (dejaSollicites.has(service.id)) continue;

    const resultat = await db.execute(
      `INSERT INTO manifestation_approvals
         (manifestation_id, service_id, kind, status, requested_by, requested_at)
       VALUES (?, ?, 'approbation', 'pending', ?, ?)`,
      [manifestationId, service.id, demandeurId ?? null, new Date().toISOString()]
    );
    creees.push({ id: resultat.lastInsertRowid, service });
  }

  return creees;
}

/**
 * Approbations d'une manifestation, avec le nom du service et du décideur.
 */
export async function approbationsDe(manifestationId: number | string): Promise<any[]> {
  return db.query(
    `SELECT a.*, s.name as service_name, s.slug as service_slug,
            (d.first_name || ' ' || d.last_name) as decided_by_name,
            (u.first_name || ' ' || u.last_name) as user_name
     FROM manifestation_approvals a
     LEFT JOIN services s ON s.id = a.service_id
     LEFT JOIN users d ON d.id = a.decided_by
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.manifestation_id = ?
     ORDER BY a.requested_at, a.id`,
    [manifestationId]
  );
}

/**
 * Approbations encore attendues.
 *
 * Seules les sollicitations de type « approbation » comptent : une demande
 * d'information laissée sans réponse ne doit pas bloquer une manifestation.
 */
export async function approbationsEnAttente(manifestationId: number | string): Promise<any[]> {
  return db.query(
    `SELECT a.*, s.name as service_name
     FROM manifestation_approvals a
     LEFT JOIN services s ON s.id = a.service_id
     WHERE a.manifestation_id = ? AND a.kind = 'approbation' AND a.status = 'pending'`,
    [manifestationId]
  );
}

/** Services auxquels appartient un compte. */
export async function servicesDe(userId: number): Promise<any[]> {
  return db.query(
    `SELECT s.*, sm.is_manager
     FROM services s
     JOIN service_members sm ON sm.service_id = s.id
     WHERE sm.user_id = ? AND s.is_active = 1`,
    [userId]
  );
}

/**
 * Ce compte peut-il décider à la place de ce service ?
 *
 * Un administrateur le peut toujours : c'est lui qui débloque une manifestation
 * quand un service ne répond pas. Sinon, il faut être membre du service.
 */
export async function peutDeciderPour(
  userId: number,
  role: string,
  serviceId: number
): Promise<boolean> {
  if (role === 'admin') return true;

  const membre = await db.queryOne(
    'SELECT id FROM service_members WHERE user_id = ? AND service_id = ?',
    [userId, serviceId]
  );
  return Boolean(membre);
}

/**
 * Destinataires d'une notification, adresses dédupliquées.
 *
 * L'adresse du service prime quand elle existe : une boîte partagée survit aux
 * départs, contrairement à l'adresse d'un agent. Les membres la reçoivent aussi,
 * sinon un service sans boîte partagée ne recevrait rien du tout.
 */
export async function destinatairesDuService(serviceId: number): Promise<string[]> {
  const service = await db.queryOne('SELECT email FROM services WHERE id = ?', [serviceId]);
  const membres = await db.query(
    `SELECT u.email FROM users u
     JOIN service_members sm ON sm.user_id = u.id
     WHERE sm.service_id = ? AND u.is_active = 1 AND u.email IS NOT NULL`,
    [serviceId]
  );

  const adresses = new Set<string>();
  if (service?.email) adresses.add(service.email);
  for (const membre of membres) adresses.add(membre.email);

  return [...adresses];
}

/**
 * Tous ceux qui suivent une manifestation : services sollicités, observateurs,
 * personnes mises en copie, et le service dont l'utilisateur est membre.
 *
 * `evenement` filtre selon les réglages de chaque service : celui qui a coupé
 * les avis de changement de statut ne doit pas en recevoir, sans pour autant
 * perdre les demandes d'approbation qui le concernent.
 */
export async function destinatairesManifestation(
  manifestationId: number | string,
  evenement: 'new_request' | 'status_change' | 'material_change' | 'message'
): Promise<string[]> {
  const colonne = `notify_${evenement}`;

  const services = await db.query(
    `SELECT DISTINCT s.id
     FROM services s
     WHERE s.is_active = 1 AND s.${colonne} = 1
       AND (
         s.is_observer = 1
         OR EXISTS (
           SELECT 1 FROM manifestation_approvals a
           WHERE a.manifestation_id = ? AND a.service_id = s.id
         )
         OR EXISTS (
           SELECT 1 FROM manifestation_watchers w
           WHERE w.manifestation_id = ? AND w.service_id = s.id
         )
       )`,
    [manifestationId, manifestationId]
  );

  const adresses = new Set<string>();
  for (const service of services) {
    for (const adresse of await destinatairesDuService(service.id)) adresses.add(adresse);
  }

  // Personnes mises en copie à titre individuel : un DGS, un élu.
  const suiveurs = await db.query(
    `SELECT u.email FROM manifestation_watchers w
     JOIN users u ON u.id = w.user_id
     WHERE w.manifestation_id = ? AND u.is_active = 1 AND u.email IS NOT NULL`,
    [manifestationId]
  );
  for (const suiveur of suiveurs) adresses.add(suiveur.email);

  // Personnes sollicitées nommément.
  const sollicites = await db.query(
    `SELECT u.email FROM manifestation_approvals a
     JOIN users u ON u.id = a.user_id
     WHERE a.manifestation_id = ? AND u.is_active = 1 AND u.email IS NOT NULL`,
    [manifestationId]
  );
  for (const sollicite of sollicites) adresses.add(sollicite.email);

  return [...adresses];
}

/**
 * Identifiants des manifestations qu'un compte « service » a le droit de voir.
 *
 * Un service voit une manifestation dès qu'il y est sollicité, qu'il en est
 * observateur, ou qu'on l'y a mis en copie. Il voit alors la manifestation
 * **entière** — dates, matériel, échanges — parce qu'il doit pouvoir en discuter
 * avec les autres services ; il ne peut en revanche décider que de sa part.
 *
 * Rend `null` quand le compte n'est rattaché à aucun service : il ne voit rien,
 * ce qui vaut mieux que de tout voir par défaut.
 */
export async function manifestationsVisiblesParService(userId: number): Promise<number[]> {
  const services = await servicesDe(userId);
  if (services.length === 0) return [];

  const ids = services.map((s: any) => s.id);
  const observateur = services.some((s: any) => s.is_observer);

  if (observateur) {
    const toutes = await db.query('SELECT id FROM manifestations');
    return toutes.map((m: any) => m.id);
  }

  const lignes = await db.query(
    `SELECT DISTINCT manifestation_id FROM (
       SELECT manifestation_id FROM manifestation_approvals WHERE service_id IN (${marqueurs(ids)})
       UNION
       SELECT manifestation_id FROM manifestation_watchers WHERE service_id IN (${marqueurs(ids)})
       UNION
       SELECT manifestation_id FROM manifestation_watchers WHERE user_id = ?
     ) AS visibles`,
    [...ids, ...ids, userId]
  );

  return lignes.map((l: any) => l.manifestation_id);
}
