import { db } from '../database';
import type { Destinataire } from './notificationPreferences.service';

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
  const lignes = await db.query(
    'SELECT stock_id FROM manifestation_materials WHERE manifestation_id = ? AND quantity_requested > 0',
    [manifestationId]
  );
  // Une demande porte deux natures de matériel, et les deux relèvent d'un
  // service. `manifestation_items` était ignorée ici : une manifestation qui ne
  // demandait que du matériel du parc — ou les prestations qu'un service y tient
  // — ne sollicitait personne, et sa validation passait sans que quiconque ait
  // eu son mot à dire.
  const duParc = await db.query(
    'SELECT object_id FROM manifestation_items WHERE manifestation_id = ?',
    [manifestationId]
  );

  const services = [
    ...(await servicesPourArticles(lignes.map((l: any) => l.stock_id))),
    ...(await servicesPourObjetsDuParc(duParc.map((l: any) => l.object_id))),
  ];

  // Les deux sources peuvent désigner le même service : le dédoublonner ici
  // évite de lui créer deux approbations pour la même manifestation.
  const parId = new Map<number, any>();
  for (const service of services) parId.set(service.id, service);
  return [...parId.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/**
 * Services dont le périmètre couvre au moins un de ces articles.
 *
 * Extrait de `servicesConcernes` pour servir aussi à l'essai d'un webhook, qui
 * doit dire qui serait sollicité **sans rien créer**. La règle de rattachement
 * n'est écrite qu'ici : la recopier dans l'écran d'essai aurait fini par mentir
 * le jour où l'une des deux copies aurait évolué.
 */
export async function servicesPourArticles(stockIds: Array<number | string>): Promise<any[]> {
  if (stockIds.length === 0) return [];

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
     WHERE ms.id IN (${marqueurs(stockIds)}) AND s.is_active = 1
     ORDER BY s.name`,
    stockIds
  );
}

/**
 * Restreint des articles de stock au périmètre d'un service.
 *
 * La même règle de rattachement que `servicesPourArticles`, prise dans l'autre sens : là on
 * partait des articles pour trouver les services concernés, ici on part du service pour ne garder
 * que ses articles. Elle reste écrite une seule fois — un formulaire qui ne proposerait pas
 * exactement le matériel dont le service a la charge poserait des questions auxquelles personne
 * n'aurait à répondre.
 *
 * Un service se désigne par son identifiant, son slug ou son nom : ce qui interroge le catalogue
 * enregistre la désignation qui lui parle, et un identifiant numérique ne survit pas au passage
 * d'une instance à une autre.
 */
export function conditionPerimetreService(
  service: string | number,
  alias = 'ms'
): { sql: string; params: any[] } {
  const reference = String(service ?? '').trim();
  if (!reference) return { sql: '', params: [] };

  const numerique = /^\d+$/.test(reference);
  const designation = numerique ? 's.id = ?' : '(s.slug = ? OR s.name = ?)';
  const params = numerique ? [Number(reference)] : [reference, reference];

  return {
    sql: ` AND EXISTS (
        SELECT 1 FROM service_categories sc_perim
        JOIN services s ON s.id = sc_perim.service_id
        WHERE s.is_active = 1 AND ${designation}
          AND (sc_perim.category_id = ${alias}.category_id
               OR EXISTS (
                 SELECT 1 FROM subcategories sub_perim
                 WHERE sub_perim.id = ${alias}.subcategory_id
                   AND sub_perim.category_id = sc_perim.category_id
               ))
      )`,
    params,
  };
}

/**
 * Services dont le périmètre couvre au moins un de ces matériels du parc.
 *
 * La même règle que pour le stock, sur l'autre table : un service est concerné
 * par ce qui relève de ses catégories, que ce soit une quantité prêtable, un
 * exemplaire identifié, ou une prestation qu'il tient dans son propre parc.
 *
 * C'est ce qui fait tenir l'organisation où la **catégorie est le service** :
 * « Urbanisme › Prestation » sollicite l'urbanisme sans une ligne de plus.
 */
export async function servicesPourObjetsDuParc(
  objectIds: Array<number | string>
): Promise<any[]> {
  if (objectIds.length === 0) return [];

  return db.query(
    `SELECT DISTINCT s.*
     FROM services s
     JOIN service_categories sc ON sc.service_id = s.id
     JOIN objects o
       ON o.category_id = sc.category_id
       OR EXISTS (
         SELECT 1 FROM subcategories sub
         WHERE sub.id = o.subcategory_id AND sub.category_id = sc.category_id
       )
     WHERE o.id IN (${marqueurs(objectIds)}) AND s.is_active = 1
     ORDER BY s.name`,
    objectIds
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

  // Le service coordinateur est sollicité sur **toute** manifestation, même
  // celle qui ne demande aucun matériel de son périmètre : c'est lui qui
  // prononce la validation finale, il ne peut donc jamais être absent du
  // tableau des approbations.
  const coordinateur = await serviceCoordinateur();
  if (coordinateur && !concernes.some((s: any) => s.id === coordinateur.id)) {
    concernes.push(coordinateur);
  }

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
            (CONCAT_WS(' ', d.first_name, d.last_name)) as decided_by_name,
            (CONCAT_WS(' ', u.first_name, u.last_name)) as user_name
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

/**
 * Approbations attendues **des autres** que le coordinateur.
 *
 * Le coordinateur tranche en dernier : lui demander son avis avant que les
 * services aient répondu le ferait valider à l'aveugle, ce qui viderait sa
 * signature de son sens.
 */
export async function approbationsEnAttenteHorsCoordinateur(
  manifestationId: number | string
): Promise<any[]> {
  const attendues = await approbationsEnAttente(manifestationId);
  const coordinateur = await serviceCoordinateur();
  if (!coordinateur) return attendues;

  return attendues.filter((a: any) => a.service_id !== coordinateur.id);
}

/** Toutes les approbations hors coordinateur sont-elles favorables ? */
export async function toutEstApprouve(manifestationId: number | string): Promise<boolean> {
  const coordinateur = await serviceCoordinateur();

  const bloquantes = await db.query(
    `SELECT a.status, a.service_id FROM manifestation_approvals a
     WHERE a.manifestation_id = ? AND a.kind = 'approbation'`,
    [manifestationId]
  );

  return bloquantes
    .filter((a: any) => !coordinateur || a.service_id !== coordinateur.id)
    // « Non concerné » vaut accord : le service a répondu, il ne bloque rien.
    .every((a: any) => a.status === 'approved' || a.status === 'not_concerned');
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
 * Approuver engage la collectivité. Ce n'était jusqu'ici l'affaire de personne
 * en particulier : `is_manager` était enregistré et relu, mais n'entrait dans
 * aucune décision, si bien que tout membre pouvait approuver au nom de son
 * service. Trois portes, et trois seulement :
 *
 * - **l'administrateur**, qui débloque une manifestation quand un service ne
 *   répond pas ;
 * - **le responsable du service**, à qui la décision revient ;
 * - **un délégataire**, que le responsable a désigné pour une période — le cas
 *   des congés, et celui de l'adjoint permanent.
 *
 * Être simple membre ne suffit plus : on reçoit les avis du service, on n'engage
 * pas sa signature.
 */
export async function peutDeciderPour(
  userId: number,
  role: string,
  serviceId: number
): Promise<boolean> {
  if (role === 'admin') return true;

  const responsable = await db.queryOne(
    'SELECT id FROM service_members WHERE user_id = ? AND service_id = ? AND is_manager = 1',
    [userId, serviceId]
  );
  if (responsable) return true;

  return delegationActive(userId, serviceId);
}

/**
 * Une délégation en cours couvre-t-elle ce compte pour ce service ?
 *
 * Les bornes sont facultatives et comparées au jour : sans elles, la délégation
 * vaut jusqu'à révocation. Les comparer en SQL laisserait le dialecte décider du
 * format ; la date du jour est passée en paramètre, comme partout ailleurs.
 */
export async function delegationActive(userId: number, serviceId: number): Promise<boolean> {
  const jour = new Date().toISOString().split('T')[0];

  const delegation = await db.queryOne(
    `SELECT id FROM service_delegations
     WHERE delegate_user_id = ? AND service_id = ?
       AND (start_date IS NULL OR start_date <= ?)
       AND (end_date IS NULL OR end_date >= ?)`,
    [userId, serviceId, jour, jour]
  );
  return Boolean(delegation);
}

/**
 * Ce compte peut-il gérer les délégations de ce service ?
 *
 * Le responsable, et lui seul — pas ses délégataires : une délégation ne se
 * redélègue pas, sans quoi la chaîne de responsabilité deviendrait
 * inconnaissable. L'administrateur reste maître, comme partout.
 */
export async function peutDeleguerPour(
  userId: number,
  role: string,
  serviceId: number
): Promise<boolean> {
  if (role === 'admin') return true;

  const responsable = await db.queryOne(
    'SELECT id FROM service_members WHERE user_id = ? AND service_id = ? AND is_manager = 1',
    [userId, serviceId]
  );
  return Boolean(responsable);
}

/** Délégations en cours et à venir d'un service, avec le nom du délégataire. */
export async function delegationsDe(serviceId: number | string): Promise<any[]> {
  return db.query(
    `SELECT d.*, (CONCAT_WS(' ', u.first_name, u.last_name)) as delegate_name, u.email as delegate_email,
            (CONCAT_WS(' ', g.first_name, g.last_name)) as granted_by_name
     FROM service_delegations d
     JOIN users u ON u.id = d.delegate_user_id
     LEFT JOIN users g ON g.id = d.granted_by
     WHERE d.service_id = ?
     ORDER BY d.start_date, d.id`,
    [serviceId]
  );
}

/** Service qui pilote toutes les manifestations, s'il en existe un. */
export async function serviceCoordinateur(): Promise<any | null> {
  return db.queryOne('SELECT * FROM services WHERE is_coordinator = 1 AND is_active = 1');
}

/**
 * Destinataires d'une notification pour un service.
 *
 * L'adresse du service prime quand elle existe : une boîte partagée survit aux
 * départs, contrairement à l'adresse d'un agent. Les membres la reçoivent aussi,
 * sinon un service sans boîte partagée ne recevrait rien du tout.
 *
 * Chaque destinataire porte son compte quand il en a un, pour que ses
 * préférences personnelles puissent être respectées ensuite. La boîte partagée
 * n'appartient à personne : elle n'en a pas, et suit le seul réglage du service.
 */
export async function destinatairesDuService(serviceId: number): Promise<Destinataire[]> {
  const service = await db.queryOne('SELECT email FROM services WHERE id = ?', [serviceId]);
  const membres = await db.query(
    `SELECT u.id, u.email, u.role FROM users u
     JOIN service_members sm ON sm.user_id = u.id
     WHERE sm.service_id = ? AND u.is_active = 1 AND u.email IS NOT NULL`,
    [serviceId]
  );

  const destinataires: Destinataire[] = [];
  if (service?.email) destinataires.push({ email: service.email });
  for (const membre of membres) {
    destinataires.push({ email: membre.email, userId: membre.id, role: membre.role });
  }

  return destinataires;
}

/**
 * Colonne de réglage du service correspondant à un événement.
 *
 * Les services portent quatre interrupteurs, le catalogue compte huit
 * événements : cette table dit lequel gouverne lequel. Un événement inconnu
 * retombe sur le suivi de statut, le plus général — mieux vaut une notification
 * de trop qu'un silence sur un événement qu'on vient d'ajouter.
 */
const COLONNE_SERVICE: Record<string, string> = {
  new_request: 'notify_new_request',
  approval_requested: 'notify_new_request',
  approval_decided: 'notify_status_change',
  message: 'notify_message',
  dates_changed: 'notify_status_change',
  material_changed: 'notify_material_change',
  delivery_reminder: 'notify_status_change',
  recovery_overdue: 'notify_status_change',
};

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
  evenement: string
): Promise<Destinataire[]> {
  const colonne = COLONNE_SERVICE[evenement] ?? 'notify_status_change';

  const services = await db.query(
    `SELECT DISTINCT s.id
     FROM services s
     WHERE s.is_active = 1 AND s.${colonne} = 1
       AND (
         s.is_observer = 1
         OR s.is_coordinator = 1
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

  const destinataires: Destinataire[] = [];
  for (const service of services) {
    destinataires.push(...(await destinatairesDuService(service.id)));
  }

  // Personnes mises en copie à titre individuel : un DGS, un élu.
  const suiveurs = await db.query(
    `SELECT u.id, u.email, u.role FROM manifestation_watchers w
     JOIN users u ON u.id = w.user_id
     WHERE w.manifestation_id = ? AND u.is_active = 1 AND u.email IS NOT NULL`,
    [manifestationId]
  );
  for (const suiveur of suiveurs) {
    destinataires.push({ email: suiveur.email, userId: suiveur.id, role: suiveur.role });
  }

  // Personnes sollicitées nommément.
  const sollicites = await db.query(
    `SELECT u.id, u.email, u.role FROM manifestation_approvals a
     JOIN users u ON u.id = a.user_id
     WHERE a.manifestation_id = ? AND u.is_active = 1 AND u.email IS NOT NULL`,
    [manifestationId]
  );
  for (const sollicite of sollicites) {
    destinataires.push({ email: sollicite.email, userId: sollicite.id, role: sollicite.role });
  }

  return destinataires;
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
  // Observateur ou coordinateur : les deux suivent l'intégralité des
  // manifestations, l'un sans pouvoir, l'autre parce qu'il les valide.
  const observateur = services.some((s: any) => s.is_observer || s.is_coordinator);

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
