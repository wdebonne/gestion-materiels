import { db } from '../database';

/**
 * Ce qui part vers quel carnet, et ce qui n'en part pas.
 *
 * Brancher l'agenda de l'application sur un CalDAV déversait tout dans le même
 * carnet : les entretiens de véhicules, les contrôles techniques, les échéances
 * du matériel de manifestation et les tontes des espaces verts. Le carnet du
 * service technique devenait illisible, et la seule réaction possible était de
 * couper la synchronisation.
 *
 * Deux axes suffisent à trancher, parce que ce sont ceux selon lesquels une
 * commune découpe son travail : la **nature** de l'événement — d'où il vient —
 * et la **catégorie** du matériel qu'il concerne. Le service technique veut les
 * entretiens et les contrôles des véhicules ; les espaces verts veulent leurs
 * tontes ; le régisseur des salles veut les manifestations.
 *
 * Ce que ce service **ne touche pas** : la vue du calendrier dans
 * l'application. Elle continue de tout montrer, filtré par les seuls droits du
 * compte (`calendar.routes.ts`). L'aiguillage décide de ce qui **sort**, jamais
 * de ce qui s'affiche — confondre les deux ferait disparaître de l'écran des
 * échéances qu'on a seulement choisi de ne pas exporter.
 */

// ---------------------------------------------------------------- vocabulaire

export interface Nature {
  valeur: string;
  libelle: string;
  description: string;
}

/**
 * D'où vient un événement.
 *
 * Reconnue à ce qui l'a produit (`plugin_reference`) plutôt qu'à son
 * `event_type`, qui vaut « maintenance » aussi bien pour la vidange d'un camion
 * que pour la taille d'une haie : une distinction que personne ne peut faire à
 * la lecture, et qui est précisément celle qu'on veut régler ici.
 */
export const NATURES: readonly Nature[] = [
  {
    valeur: 'entretien',
    libelle: 'Entretien du parc',
    description: 'Les entretiens programmés depuis la fiche d’un matériel',
  },
  {
    valeur: 'controle',
    libelle: 'Contrôle technique',
    description: 'Les échéances de contrôle des véhicules et engins',
  },
  {
    valeur: 'espace_vert',
    libelle: 'Espaces verts',
    description: 'Tontes, tailles et chantiers des parcs et massifs',
  },
  {
    valeur: 'voirie',
    libelle: 'Mobilier de voie publique',
    description: 'Les interventions programmées depuis la cartographie',
  },
  {
    valeur: 'manifestation',
    libelle: 'Manifestations',
    description: 'Livraisons, récupérations et jalons des manifestations',
  },
  {
    valeur: 'rendez_vous',
    libelle: 'Rendez-vous saisis à la main',
    description: 'Ce qui a été créé directement dans le calendrier',
  },
  {
    valeur: 'autre',
    libelle: 'Autre',
    description: 'Ce qui ne relève d’aucune des natures ci-dessus',
  },
];

/** Ce qui a produit l'événement, traduit en nature. */
export function natureDe(evenement: {
  plugin_reference?: string | null;
  event_type?: string | null;
}): string {
  switch (evenement.plugin_reference) {
    case 'maintenance':
      return 'entretien';
    case 'technical-control':
      return 'controle';
    case 'green-space-maintenance':
      return 'espace_vert';
    case 'street-furniture-intervention':
      return 'voirie';
    case 'manifestation-recovery':
      return 'manifestation';
    default:
      break;
  }
  // Sans producteur identifié, c'est un rendez-vous saisi dans le calendrier —
  // sauf si son type dit autre chose.
  if (!evenement.plugin_reference) return 'rendez_vous';
  return 'autre';
}

/** Les deux sens possibles, et leur nom en clair. */
export const DIRECTIONS: readonly Nature[] = [
  {
    valeur: 'export',
    libelle: 'Envoyer vers ce carnet',
    description: 'Les échéances de l’application partent dans l’agenda externe',
  },
  {
    valeur: 'import',
    libelle: 'Recevoir de ce carnet',
    description: 'Les événements de l’agenda externe apparaissent dans le calendrier',
  },
  {
    valeur: 'deux_sens',
    libelle: 'Les deux',
    description: 'Envoyer et recevoir',
  },
];

// ---------------------------------------------------------------- destinations

export interface Destination {
  id: number;
  name: string;
  kind: 'caldav' | 'outlook';
  server_url: string;
  username: string;
  password: string;
  calendar_path: string;
  client_id: string;
  client_secret: string;
  tenant_id: string;
  direction: 'import' | 'export' | 'deux_sens';
  natures: string[];
  category_ids: number[];
  include_uncategorized: boolean;
  color: string;
  enabled: boolean;
  last_sync: string | null;
  last_error: string | null;
}

/** Une liste JSON relue sans jamais lever : une colonne abîmée ne doit pas bloquer une synchro. */
function liste(brut: unknown): any[] {
  if (Array.isArray(brut)) return brut;
  if (typeof brut !== 'string' || !brut.trim()) return [];
  try {
    const lu = JSON.parse(brut);
    return Array.isArray(lu) ? lu : [];
  } catch {
    return [];
  }
}

/** Une ligne de base relue en destination. */
export function lireDestination(ligne: any): Destination {
  return {
    id: Number(ligne.id),
    name: ligne.name ?? '',
    kind: ligne.kind === 'outlook' ? 'outlook' : 'caldav',
    server_url: ligne.server_url ?? '',
    username: ligne.username ?? '',
    password: ligne.password ?? '',
    calendar_path: ligne.calendar_path ?? '',
    client_id: ligne.client_id ?? '',
    client_secret: ligne.client_secret ?? '',
    tenant_id: ligne.tenant_id ?? '',
    direction:
      ligne.direction === 'import' || ligne.direction === 'deux_sens' ? ligne.direction : 'export',
    natures: liste(ligne.natures).map(String),
    category_ids: liste(ligne.category_ids).map(Number).filter(Number.isFinite),
    include_uncategorized: ligne.include_uncategorized === 0 ? false : true,
    color: ligne.color ?? '#10b981',
    enabled: !!ligne.enabled,
    last_sync: ligne.last_sync ?? null,
    last_error: ligne.last_error ?? null,
  };
}

/** Toutes les destinations, les mots de passe compris — usage serveur uniquement. */
export async function destinations(): Promise<Destination[]> {
  const lignes = await db.query('SELECT * FROM calendar_destinations ORDER BY name');
  return lignes.map(lireDestination);
}

export async function destination(id: number | string): Promise<Destination | null> {
  const ligne = await db.queryOne('SELECT * FROM calendar_destinations WHERE id = ?', [id]);
  return ligne ? lireDestination(ligne) : null;
}

/** Ce qu'un écran a le droit de voir : tout, sauf les secrets. */
export function sansSecrets(d: Destination) {
  const { password, client_secret, ...reste } = d;
  return { ...reste, password: password ? '••••••••' : '', client_secret: client_secret ? '••••••••' : '' };
}

// ------------------------------------------------------------------ aiguillage

/**
 * Un événement à exporter, tel que l'aiguillage a besoin de le connaître.
 *
 * `category_id` est la catégorie du matériel concerné — directe ou via sa
 * sous-catégorie —, et vaut `null` pour ce qui n'en désigne aucun : une tonte
 * de parc, un rendez-vous saisi à la main.
 */
export interface EvenementExportable {
  id: number;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  all_day: number | boolean;
  event_type: string | null;
  plugin_reference: string | null;
  plugin_reference_id: number | null;
  object_id: number | null;
  category_id: number | null;
  source: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

/**
 * Cet événement part-il vers ce carnet ?
 *
 * Deux ensembles, et la même règle pour les deux : **vide veut dire tout**.
 * C'est ce qui permet de brancher un premier carnet sans rien régler, puis
 * d'affiner le jour où un second arrive.
 */
export function concerne(d: Destination, evenement: EvenementExportable): boolean {
  // Ce qui vient d'un carnet n'y retourne pas : la boucle recopierait
  // indéfiniment les mêmes rendez-vous d'un agenda à l'autre.
  if (evenement.source && evenement.source !== 'local') return false;

  if (d.natures.length > 0 && !d.natures.includes(natureDe(evenement))) return false;

  if (d.category_ids.length > 0) {
    if (evenement.category_id === null) return d.include_uncategorized;
    if (!d.category_ids.includes(Number(evenement.category_id))) return false;
  }

  return true;
}

/**
 * Les événements candidats à l'export, dans une fenêtre bornée.
 *
 * Bornée à dessein : un carnet d'agenda n'a pas vocation à recevoir dix ans
 * d'historique, et repousser chaque passage l'intégralité du passé coûterait
 * autant que la première fois. Un mois en arrière suffit à rattraper ce qui
 * vient d'être saisi, un an en avant couvre les échéances annuelles.
 */
export async function evenementsExportables(): Promise<EvenementExportable[]> {
  const debut = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const fin = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

  return db.query(
    `SELECT ce.id, ce.title, ce.description, ce.start_date, ce.end_date, ce.all_day,
            ce.event_type, ce.plugin_reference, ce.plugin_reference_id, ce.object_id,
            ce.source, ce.created_at,
            COALESCE(o.category_id, sc.category_id) as category_id
     FROM calendar_events ce
     LEFT JOIN objects o ON o.id = ce.object_id
     LEFT JOIN subcategories sc ON sc.id = o.subcategory_id
     WHERE ce.start_date >= ? AND ce.start_date <= ?
     ORDER BY ce.start_date`,
    [debut, fin]
  );
}

// ------------------------------------------------------------------ iCalendar

/** Un horodatage iCalendar en UTC : `20260912T080000Z`. */
function versICalDateHeure(valeur: string): string {
  const date = new Date(valeur);
  const utilisable = Number.isNaN(date.getTime()) ? new Date() : date;
  return utilisable.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Une date iCalendar sans heure : `20260912`. */
function versICalDate(valeur: string): string {
  return String(valeur).slice(0, 10).replace(/-/g, '');
}

/**
 * Échappe ce qui a un sens dans iCalendar.
 *
 * Une description qui contient une virgule ou un saut de ligne — et elles en
 * contiennent toutes — casse le fichier sans cet échappement : le rendez-vous
 * arrive tronqué dans le carnet, ou pas du tout.
 */
function echapper(texte: string): string {
  return String(texte ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** L'identifiant que le carnet distant connaîtra, stable dans le temps. */
export const uidDe = (evenement: { id: number }): string =>
  `gestmat-${evenement.id}@gestion-materiels`;

/**
 * Le VEVENT complet, prêt à être déposé.
 *
 * `DTSTAMP` et `UID` ne sont pas décoratifs : sans eux, la plupart des serveurs
 * CalDAV refusent le dépôt, et ceux qui l'acceptent créent un doublon à chaque
 * passage au lieu de remplacer.
 */
export function versICS(evenement: EvenementExportable): string {
  const journeeEntiere = !!evenement.all_day;
  const debut = journeeEntiere
    ? `DTSTART;VALUE=DATE:${versICalDate(evenement.start_date)}`
    : `DTSTART:${versICalDateHeure(evenement.start_date)}`;

  const finBrute = evenement.end_date || evenement.start_date;
  const fin = journeeEntiere
    ? `DTEND;VALUE=DATE:${versICalDate(prochainJour(finBrute))}`
    : `DTEND:${versICalDateHeure(finBrute)}`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gestion Materiels//FR',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uidDe(evenement)}`,
    `DTSTAMP:${versICalDateHeure(new Date().toISOString())}`,
    debut,
    fin,
    `SUMMARY:${echapper(evenement.title)}`,
    evenement.description ? `DESCRIPTION:${echapper(evenement.description)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

/**
 * Le lendemain, au format date.
 *
 * `DTEND` d'un événement en journée entière est **exclusif** dans iCalendar :
 * une échéance du 15 mars qui s'arrête au 15 mars n'occupe aucun jour, et
 * disparaît des carnets qui appliquent la norme.
 */
function prochainJour(valeur: string): string {
  const date = new Date(String(valeur).slice(0, 10));
  if (Number.isNaN(date.getTime())) return valeur;
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------- CalDAV

/** L'adresse du carnet, chemin compris. */
export function urlDuCarnet(d: Destination): string {
  const base = d.server_url.replace(/\/+$/, '');
  const chemin = (d.calendar_path ?? '').replace(/^\/+/, '');
  return chemin ? `${base}/${chemin}` : base;
}

const enTetes = (d: Destination): Record<string, string> => ({
  Authorization: `Basic ${Buffer.from(`${d.username}:${d.password}`).toString('base64')}`,
});

/**
 * Une requête vers le carnet, dont l'échec se lit.
 *
 * `fetch` rejette avec « fetch failed » quand le serveur ne répond pas — un
 * nom de domaine qui n'existe pas, un pare-feu, un certificat refusé. Tel quel
 * dans l'écran des réglages, ce message n'apprend rien à qui doit le réparer ;
 * nommer l'adresse visée suffit à orienter.
 */
async function appeler(d: Destination, url: string, options: RequestInit): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch {
    throw new Error(
      `Serveur injoignable à l'adresse ${urlDuCarnet(d)} — vérifiez l'adresse, le réseau et le certificat`
    );
  }
}

/** Dépose ou remplace un événement dans le carnet. */
async function deposer(d: Destination, evenement: EvenementExportable): Promise<void> {
  const uid = uidDe(evenement);
  const reponse = await appeler(d, `${urlDuCarnet(d)}/${uid}.ics`, {
    method: 'PUT',
    headers: { ...enTetes(d), 'Content-Type': 'text/calendar; charset=utf-8' },
    body: versICS(evenement),
  });
  if (!reponse.ok && reponse.status !== 204) {
    throw new Error(`Dépôt refusé (${reponse.status})`);
  }
}

/**
 * Retire un événement du carnet.
 *
 * Un 404 n'est pas une erreur : quelqu'un a pu le supprimer à la main dans son
 * agenda, et insister ferait échouer toute la synchronisation pour un
 * rendez-vous déjà parti.
 */
async function retirer(d: Destination, uid: string): Promise<void> {
  const reponse = await appeler(d, `${urlDuCarnet(d)}/${uid}.ics`, {
    method: 'DELETE',
    headers: enTetes(d),
  });
  if (!reponse.ok && reponse.status !== 404 && reponse.status !== 204) {
    throw new Error(`Suppression refusée (${reponse.status})`);
  }
}

// -------------------------------------------------------------------- export

export interface BilanExport {
  envoyes: number;
  retires: number;
}

/**
 * Met le carnet distant en accord avec ce que les règles désignent.
 *
 * Trois gestes, dans cet ordre : ce qui correspond est déposé, ce qui a cessé
 * de correspondre est retiré, et la mémoire de ce qui est là-bas est mise à
 * jour. Sans le deuxième, décocher une catégorie laisserait ses rendez-vous
 * dans le carnet pour toujours, et personne ne comprendrait pourquoi.
 */
export async function exporterVers(d: Destination): Promise<BilanExport> {
  if (d.kind !== 'caldav') {
    // Outlook n'est pour l'instant qu'une source : y écrire demande le
    // consentement délégué de Microsoft Graph, que la configuration actuelle —
    // un simple secret d'application — ne porte pas.
    return { envoyes: 0, retires: 0 };
  }

  const candidats = await evenementsExportables();
  const retenus = candidats.filter((evenement) => concerne(d, evenement));
  const retenusParId = new Map(retenus.map((e) => [Number(e.id), e]));

  const dejaPousses = await db.query(
    'SELECT * FROM calendar_exports WHERE destination_id = ?',
    [d.id]
  );
  const pousseParEvenement = new Map<number, any>(
    dejaPousses.map((l: any) => [Number(l.event_id), l])
  );

  let envoyes = 0;
  for (const evenement of retenus) {
    await deposer(d, evenement);
    envoyes += 1;
    if (!pousseParEvenement.has(Number(evenement.id))) {
      await db.execute(
        `INSERT INTO calendar_exports (destination_id, event_id, external_uid, pushed_at)
         VALUES (?, ?, ?, ?)`,
        [d.id, evenement.id, uidDe(evenement), new Date().toISOString()]
      );
    } else {
      await db.execute('UPDATE calendar_exports SET pushed_at = ? WHERE id = ?', [
        new Date().toISOString(),
        pousseParEvenement.get(Number(evenement.id)).id,
      ]);
    }
  }

  let retires = 0;
  for (const ligne of dejaPousses) {
    if (retenusParId.has(Number(ligne.event_id))) continue;
    await retirer(d, ligne.external_uid);
    await db.execute('DELETE FROM calendar_exports WHERE id = ?', [ligne.id]);
    retires += 1;
  }

  return { envoyes, retires };
}

/**
 * Ce qu'un export ferait, sans rien envoyer.
 *
 * Un aiguillage se règle à l'aveugle : on coche des natures et des catégories
 * sans savoir combien d'événements cela représente, et on ne le découvre qu'une
 * fois le carnet de quelqu'un d'autre rempli. Cet aperçu répond avant.
 */
export async function apercuExport(d: Destination): Promise<{
  total: number;
  parNature: Array<{ nature: string; libelle: string; cnt: number }>;
  exemples: Array<{ title: string; start_date: string; nature: string }>;
}> {
  const retenus = (await evenementsExportables()).filter((e) => concerne(d, e));

  const comptes = new Map<string, number>();
  for (const evenement of retenus) {
    const nature = natureDe(evenement);
    comptes.set(nature, (comptes.get(nature) ?? 0) + 1);
  }

  return {
    total: retenus.length,
    parNature: [...comptes.entries()]
      .map(([nature, cnt]) => ({
        nature,
        libelle: NATURES.find((n) => n.valeur === nature)?.libelle ?? nature,
        cnt,
      }))
      .sort((a, b) => b.cnt - a.cnt),
    exemples: retenus.slice(0, 8).map((e) => ({
      title: e.title,
      start_date: e.start_date,
      nature: natureDe(e),
    })),
  };
}

/** Teste que le carnet répond et accepte les identifiants. */
export async function tester(d: Destination): Promise<void> {
  if (d.kind !== 'caldav') {
    throw new Error('Le test ne couvre que les carnets CalDAV');
  }
  const reponse = await appeler(d, urlDuCarnet(d), {
    method: 'PROPFIND',
    headers: { ...enTetes(d), Depth: '0', 'Content-Type': 'application/xml' },
    body: `<?xml version="1.0" encoding="utf-8"?>
      <propfind xmlns="DAV:"><prop><displayname/><resourcetype/></prop></propfind>`,
  });

  if (reponse.status === 401) throw new Error('Identifiants refusés');
  if (!reponse.ok && reponse.status !== 207) {
    throw new Error(`Le serveur a répondu ${reponse.status}`);
  }
}

/** Note le résultat d'un passage sur la destination, réussite comme échec. */
export async function noterPassage(id: number, erreur?: string): Promise<void> {
  await db.execute(
    'UPDATE calendar_destinations SET last_sync = ?, last_error = ?, updated_at = ? WHERE id = ?',
    [new Date().toISOString(), erreur ?? null, new Date().toISOString(), id]
  );
}
