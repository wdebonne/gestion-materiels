import { db } from '../database';
import {
  lireStatut,
  resoudreRoutage,
  statutParDefaut,
  type Routage,
} from './ticketsReferentiel.service';

/**
 * Les demandes internes : les ouvrir, les suivre, les clore.
 *
 * ## Le numéro se dérive de l'identifiant
 *
 * `T-2026-123`, écrit juste après l'insertion, dans la même transaction. Un
 * compteur « le plus grand numéro plus un » tiendrait mal à deux saisies
 * simultanées : les deux tireraient le même numéro, et l'unicité en ferait
 * échouer une au hasard — sur le geste que l'utilisateur vient de faire, et
 * sans qu'il puisse rien y comprendre. L'identifiant est déjà unique et déjà
 * attribué par le moteur ; le formater suffit.
 *
 * ## Le fil se lit en deux morceaux et se rend en un seul
 *
 * `ticket_messages` porte ce qu'une personne écrit, `ticket_history` ce que le
 * système constate. La fiche les affiche mêlés, comme GestSup — mais les tenir
 * séparés empêche qu'on modifie une trace d'audit, et évite de porter des
 * colonnes vides sur chaque ligne.
 *
 * La fusion se fait ici, en JavaScript. Un `UNION` de deux formes différentes
 * est dialectal, et le paginer serait pénible pour un gain nul : un ticket porte
 * quelques dizaines de lignes, pas des milliers.
 *
 * L'ordre vient de `sequence`, un compteur **commun aux deux tables** et propre
 * à chaque ticket, et non de l'horodatage : un `DATETIME` ne porte pas les
 * fractions de seconde, et une seule action en écrit souvent plusieurs lignes.
 * Trier sur la date laisserait leur ordre au hasard, et le fil afficherait
 * « Résolu » avant « Ouverture ».
 *
 * ## Les horodatages sont posés par le statut, pas par l'appelant
 *
 * `pris_en_charge_at`, `resolu_at` et `ferme_at` se déduisent des drapeaux du
 * statut d'arrivée. Les laisser à l'appelant reviendrait à espérer que chaque
 * route y pense, et les statistiques de délais reposent entièrement dessus.
 */

export class SaisieInvalide extends Error {}

// ------------------------------------------------------------------ l'écriture

export interface TicketSaisi {
  titre: string;
  description?: string | null;
  demandeurId?: number | null;
  siteId?: number | null;
  ouvrantId?: number | null;
  categorieId?: number | null;
  sousCategorieId?: number | null;
  objectId?: number | null;
  priorite?: string | null;
  /** Renseignés seulement par un intervenant : la création les déduit. */
  serviceId?: number | null;
  technicienId?: number | null;
}

const PRIORITES = ['basse', 'normale', 'haute', 'urgente'];

function verifier(saisie: TicketSaisi): void {
  const titre = String(saisie.titre ?? '').trim();
  if (titre.length === 0) throw new SaisieInvalide('Le titre est obligatoire');
  if (titre.length > 255) throw new SaisieInvalide('Le titre ne peut pas dépasser 255 caractères');
  if (saisie.priorite && !PRIORITES.includes(saisie.priorite)) {
    throw new SaisieInvalide(`Priorité inconnue : ${saisie.priorite}`);
  }
}

/** Le numéro affiché, dérivé de l'identifiant. */
export function referenceDe(id: number, quand: Date = new Date()): string {
  return `T-${quand.getFullYear()}-${id}`;
}

/** Une échéance posée à N minutes d'un instant, ou `null` faute de délai réglé. */
function echeance(minutes: number | null, depuis: Date): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null;
  return versDateTime(new Date(depuis.getTime() + minutes * 60_000));
}

/**
 * Un instant, au format que les deux moteurs relisent sans le réinterpréter.
 *
 * `toISOString()` rendrait un `Z` que MySQL range tel quel dans un `DATETIME`
 * sans fuseau, décalant l'heure affichée. On écrit donc l'heure locale sous la
 * forme `AAAA-MM-JJ HH:MM:SS`, comme le fait déjà la couche d'accès pour les
 * dates qu'on lui confie.
 */
export function versDateTime(d: Date = new Date()): string {
  const deuxChiffres = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())} ` +
    `${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}:${deuxChiffres(d.getSeconds())}`
  );
}

/**
 * Le rang de la prochaine ligne du fil, messages et traces confondus.
 *
 * Le compteur est lu dans les deux tables parce que le fil les affiche mêlées :
 * deux compteurs séparés se croiseraient, et l'ordre redeviendrait arbitraire.
 * Le calcul est fait sous la transaction de l'appelant, qui tient le verrou
 * d'écriture — deux saisies simultanées sur le même ticket ne peuvent donc pas
 * tirer le même rang.
 */
export async function prochaineSequence(ticketId: number): Promise<number> {
  const ligne = await db.queryOne(
    `SELECT MAX(s) AS rang FROM (
       SELECT MAX(sequence) AS s FROM ticket_messages WHERE ticket_id = ?
       UNION ALL
       SELECT MAX(sequence) AS s FROM ticket_history WHERE ticket_id = ?
     ) AS rangs`,
    [ticketId, ticketId]
  );
  return Number(ligne?.rang ?? 0) + 1;
}

/** Inscrit une trace. Jamais modifiable ensuite : c'est ce qui en fait une trace. */
export async function tracer(
  ticketId: number,
  auteurId: number | null,
  action: string,
  champ?: string | null,
  ancienne?: string | null,
  nouvelle?: string | null
): Promise<void> {
  await db.execute(
    `INSERT INTO ticket_history (ticket_id, user_id, action, sequence, champ, ancienne_valeur, nouvelle_valeur, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ticketId,
      auteurId,
      action,
      await prochaineSequence(ticketId),
      champ ?? null,
      ancienne ?? null,
      nouvelle ?? null,
      versDateTime(),
    ]
  );
}

/**
 * Ouvre une demande.
 *
 * Le statut, le service, le technicien, la visibilité et les échéances ne sont
 * **pas demandés** : ils se déduisent de la catégorie. C'est ce qui rend le
 * formulaire court — un titre, une description, parfois un bâtiment — et ce qui
 * garantit qu'une demande n'atterrit jamais nulle part.
 */
export async function creerTicket(saisie: TicketSaisi, auteurId: number): Promise<number> {
  verifier(saisie);

  const statut = await statutParDefaut();
  if (!statut) {
    throw new SaisieInvalide(
      "Aucun statut n'est configuré : voir Paramètres › Tickets avant d'ouvrir une demande"
    );
  }

  const routage = await resoudreRoutage(saisie.categorieId, saisie.sousCategorieId);
  const demandeurId = Number(saisie.demandeurId ?? auteurId);
  const maintenant = new Date();

  return db.transaction(async () => {
    const resultat = await db.execute(
      `INSERT INTO tickets (
         titre, description, demandeur_id, site_id, ouvrant_id,
         categorie_id, sous_categorie_id, object_id, statut_id, priorite,
         visibilite_site, service_id, technicien_id,
         echeance_prise_en_charge, echeance_resolution,
         created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(saisie.titre).trim(),
        saisie.description ?? null,
        demandeurId,
        saisie.siteId ?? null,
        saisie.ouvrantId ?? null,
        saisie.categorieId ?? null,
        saisie.sousCategorieId ?? null,
        saisie.objectId ?? null,
        statut.id,
        saisie.priorite ?? 'normale',
        routage.visibilite === 'site' ? 1 : 0,
        saisie.serviceId ?? routage.serviceId,
        saisie.technicienId ?? routage.technicienId,
        echeance(routage.slaPriseEnChargeMinutes, maintenant),
        echeance(routage.slaResolutionMinutes, maintenant),
        auteurId,
        versDateTime(maintenant),
        versDateTime(maintenant),
      ]
    );

    const id = Number(resultat.lastInsertRowid);
    await db.execute('UPDATE tickets SET reference = ? WHERE id = ?', [referenceDe(id, maintenant), id]);
    await tracer(id, auteurId, 'ouverture');
    return id;
  });
}

/** Les champs qu'un intervenant peut corriger, et ce que chacun laisse comme trace. */
const CHAMPS_MODIFIABLES: Array<{ cle: keyof TicketSaisi; colonne: string; libelle: string }> = [
  { cle: 'titre', colonne: 'titre', libelle: 'titre' },
  { cle: 'description', colonne: 'description', libelle: 'description' },
  { cle: 'siteId', colonne: 'site_id', libelle: 'bâtiment' },
  { cle: 'ouvrantId', colonne: 'ouvrant_id', libelle: 'local' },
  { cle: 'objectId', colonne: 'object_id', libelle: 'matériel' },
  { cle: 'priorite', colonne: 'priorite', libelle: 'priorité' },
  { cle: 'serviceId', colonne: 'service_id', libelle: 'service' },
  { cle: 'technicienId', colonne: 'technicien_id', libelle: 'technicien' },
];

/**
 * Corrige une demande, et trace chaque champ qui bouge.
 *
 * Changer de catégorie re-déduit le routage — une demande mal classée à
 * l'ouverture doit pouvoir repartir au bon service sans qu'on ait à ressaisir
 * qui s'en occupe.
 */
export async function modifierTicket(
  id: number,
  saisie: Partial<TicketSaisi>,
  auteurId: number
): Promise<void> {
  const avant = await db.queryOne('SELECT * FROM tickets WHERE id = ?', [id]);
  if (!avant) throw new SaisieInvalide('Demande introuvable');
  if (saisie.titre !== undefined) verifier({ ...saisie, titre: saisie.titre } as TicketSaisi);

  const colonnes: string[] = [];
  const params: any[] = [];
  const traces: Array<[string, string | null, string | null]> = [];

  const reclasse = saisie.categorieId !== undefined || saisie.sousCategorieId !== undefined;
  if (reclasse) {
    const categorieId = saisie.categorieId !== undefined ? saisie.categorieId : avant.categorie_id;
    const sousCategorieId =
      saisie.sousCategorieId !== undefined ? saisie.sousCategorieId : avant.sous_categorie_id;
    const routage = await resoudreRoutage(categorieId, sousCategorieId);

    colonnes.push('categorie_id = ?', 'sous_categorie_id = ?', 'visibilite_site = ?');
    params.push(categorieId ?? null, sousCategorieId ?? null, routage.visibilite === 'site' ? 1 : 0);
    traces.push(['catégorie', String(avant.categorie_id ?? ''), String(categorieId ?? '')]);

    // Le routage explicite l'emporte : un intervenant qui réaffecte en même
    // temps qu'il reclasse ne doit pas se faire écraser par la catégorie.
    if (saisie.serviceId === undefined && avant.service_id !== routage.serviceId) {
      colonnes.push('service_id = ?');
      params.push(routage.serviceId);
      traces.push(['service', String(avant.service_id ?? ''), String(routage.serviceId ?? '')]);
    }
    if (saisie.technicienId === undefined && avant.technicien_id !== routage.technicienId) {
      colonnes.push('technicien_id = ?');
      params.push(routage.technicienId);
      traces.push(['technicien', String(avant.technicien_id ?? ''), String(routage.technicienId ?? '')]);
    }
  }

  for (const champ of CHAMPS_MODIFIABLES) {
    const valeur = saisie[champ.cle];
    if (valeur === undefined) continue;
    const ancienne = avant[champ.colonne];
    if (String(ancienne ?? '') === String(valeur ?? '')) continue;

    colonnes.push(`${champ.colonne} = ?`);
    params.push(valeur ?? null);
    traces.push([champ.libelle, String(ancienne ?? ''), String(valeur ?? '')]);
  }

  if (colonnes.length === 0) return;

  await db.transaction(async () => {
    colonnes.push('updated_at = ?');
    params.push(versDateTime());
    await db.execute(`UPDATE tickets SET ${colonnes.join(', ')} WHERE id = ?`, [...params, id]);
    for (const [champ, ancienne, nouvelle] of traces) {
      await tracer(id, auteurId, 'modification', champ, ancienne, nouvelle);
    }
  });
}

/**
 * Change le statut, et pose les horodatages que ce statut implique.
 *
 * `pris_en_charge_at` est posée **au premier statut qui n'est pas le défaut** :
 * c'est le moment où quelqu'un s'est saisi de la demande, et c'est ce que
 * mesure le délai de prise en charge. Elle n'est jamais réécrite — un
 * aller-retour par « en attente » ne doit pas rajeunir le délai.
 */
export async function changerStatut(
  id: number,
  statutId: number,
  auteurId: number
): Promise<void> {
  const avant = await db.queryOne('SELECT * FROM tickets WHERE id = ?', [id]);
  if (!avant) throw new SaisieInvalide('Demande introuvable');

  const nouveau = await lireStatut(statutId);
  if (!nouveau) throw new SaisieInvalide('Statut inconnu');
  if (Number(avant.statut_id) === Number(statutId)) return;

  const ancien = await lireStatut(avant.statut_id);
  const maintenant = versDateTime();

  const colonnes = ['statut_id = ?', 'updated_at = ?'];
  const params: any[] = [statutId, maintenant];

  if (!avant.pris_en_charge_at && !nouveau.defaut) {
    colonnes.push('pris_en_charge_at = ?', 'pris_en_charge_by = ?');
    params.push(maintenant, auteurId);
  }

  if (nouveau.validation) {
    // « À valider » : l'agent a fini, le superviseur relit. La résolution est
    // datée de maintenant — c'est le travail que mesure le délai de résolution —
    // mais la demande n'est pas close tant qu'elle n'est pas validée.
    colonnes.push('ferme_at = ?');
    params.push(null);
    if (!avant.resolu_at) {
      colonnes.push('resolu_at = ?', 'resolu_by = ?');
      params.push(maintenant, auteurId);
    }
  } else if (nouveau.final) {
    colonnes.push('ferme_at = ?');
    params.push(maintenant);
    if (!avant.resolu_at) {
      colonnes.push('resolu_at = ?', 'resolu_by = ?');
      params.push(maintenant, auteurId);
    }
  } else {
    // Rouvrir une demande close efface la clôture : sans cela, un ticket rouvert
    // resterait compté comme résolu dans les statistiques.
    colonnes.push('ferme_at = ?', 'resolu_at = ?', 'resolu_by = ?');
    params.push(null, null, null);
    // La tâche de la clôture reste au planning — ce temps a été passé — mais
    // n'est plus celle qu'un superviseur relirait : la prochaine clôture en
    // créera une autre. La colonne n'existe qu'après la migration 046.
    if ('tache_cloture_id' in avant) {
      colonnes.push('tache_cloture_id = ?');
      params.push(null);
    }
  }

  await db.transaction(async () => {
    await db.execute(`UPDATE tickets SET ${colonnes.join(', ')} WHERE id = ?`, [...params, id]);
    await tracer(id, auteurId, 'statut', 'statut', ancien?.nom ?? null, nouveau.nom);
  });
}

// ----------------------------------------------------------------------- le fil

export interface MessageSaisi {
  body: string;
  interne?: boolean;
  serviceId?: number | null;
}

export async function ajouterMessage(
  ticketId: number,
  saisie: MessageSaisi,
  auteurId: number
): Promise<number> {
  const body = String(saisie.body ?? '').trim();
  if (body.length === 0) throw new SaisieInvalide('Le message est vide');

  const maintenant = versDateTime();
  return db.transaction(async () => {
    const resultat = await db.execute(
      `INSERT INTO ticket_messages (ticket_id, user_id, service_id, body, is_interne, sequence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ticketId,
        auteurId,
        saisie.serviceId ?? null,
        body,
        saisie.interne ? 1 : 0,
        await prochaineSequence(ticketId),
        maintenant,
        maintenant,
      ]
    );
    await db.execute('UPDATE tickets SET updated_at = ? WHERE id = ?', [maintenant, ticketId]);
    return Number(resultat.lastInsertRowid);
  });
}

export interface LigneFil {
  type: 'message' | 'evenement';
  id: number;
  /** Rang dans le fil, commun aux messages et aux traces. */
  rang: number;
  date: string;
  auteur: { id: number | null; nom: string | null };
  /** Message seulement. */
  body?: string;
  interne?: boolean;
  serviceNom?: string | null;
  pieces?: Array<{ id: number; nom: string; url: string; mime: string | null; taille: number | null }>;
  /** Événement seulement. */
  action?: string;
  champ?: string | null;
  ancienne?: string | null;
  nouvelle?: string | null;
}

/** Les champs tracés par identifiant, et où lire le nom qui leur correspond. */
const REFERENCES_TRACEES: Record<string, { table: string; colonnes: string[] }> = {
  technicien: { table: 'users', colonnes: ['first_name', 'last_name'] },
  service: { table: 'services', colonnes: ['name'] },
  'bâtiment': { table: 'cle_sites', colonnes: ['name'] },
  local: { table: 'cle_ouvrants', colonnes: ['name'] },
  'matériel': { table: 'objects', colonnes: ['name'] },
  'catégorie': { table: 'ticket_categories', colonnes: ['nom'] },
};

/**
 * Traduit les identifiants d'une trace en noms, au moment de la lecture.
 *
 * La trace garde l'identifiant, qui ne change pas quand on renomme un service
 * ou qu'une personne se marie ; c'est l'affichage qui doit dire « Tom Tech » et
 * non « 17 ». Une référence supprimée depuis garde son numéro, signalé comme
 * tel, plutôt que de disparaître du fil.
 */
async function libellesDesTraces(
  evenements: any[]
): Promise<(champ: string | null, valeur: string | null) => string | null> {
  const noms = new Map<string, Map<string, string>>();
  for (const [champ, ref] of Object.entries(REFERENCES_TRACEES)) {
    const ids = new Set<number>();
    for (const e of evenements) {
      if (e.champ !== champ) continue;
      for (const v of [e.ancienne_valeur, e.nouvelle_valeur]) {
        if (v !== null && v !== undefined && /^\d+$/.test(String(v))) ids.add(Number(v));
      }
    }
    if (ids.size === 0) continue;
    const liste = [...ids];
    const lignes = await db.query(
      `SELECT id, ${ref.colonnes.join(', ')} FROM ${ref.table} WHERE id IN (${liste.map(() => '?').join(', ')})`,
      liste
    );
    noms.set(
      champ,
      new Map(
        lignes.map((l: any) => [
          String(l.id),
          ref.colonnes.map((c) => l[c]).filter(Boolean).join(' ').trim(),
        ])
      )
    );
  }

  return (champ, valeur) => {
    if (valeur === null || valeur === undefined || valeur === '') return null;
    const table = champ ? noms.get(champ) : undefined;
    if (!table || !/^\d+$/.test(String(valeur))) return valeur;
    return table.get(String(valeur)) || `n° ${valeur} (supprimé)`;
  };
}

/**
 * Le fil complet, messages et événements mêlés, du plus ancien au plus récent.
 *
 * `inclureInternes` est faux pour le demandeur : une note de service ne lui est
 * pas destinée. La décision se prend dans la route, qui sait si le lecteur est
 * un intervenant ; la laisser ici obligerait à y refaire le calcul de portée.
 */
export async function filUnifie(ticketId: number, inclureInternes: boolean): Promise<LigneFil[]> {
  const messages = await db.query(
    `SELECT m.*, u.first_name, u.last_name, s.name AS service_nom
       FROM ticket_messages m
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN services s ON s.id = m.service_id
      WHERE m.ticket_id = ?${inclureInternes ? '' : ' AND m.is_interne = 0'}
      ORDER BY m.sequence ASC, m.id ASC`,
    [ticketId]
  );

  const pieces = await db.query(
    `SELECT * FROM ticket_documents WHERE ticket_id = ? AND message_id IS NOT NULL`,
    [ticketId]
  );
  const piecesParMessage = new Map<number, LigneFil['pieces']>();
  for (const p of pieces) {
    const cle = Number(p.message_id);
    if (!piecesParMessage.has(cle)) piecesParMessage.set(cle, []);
    piecesParMessage.get(cle)!.push({
      id: Number(p.id),
      nom: p.name,
      url: p.file_path,
      mime: p.mime_type ?? null,
      taille: p.size === null || p.size === undefined ? null : Number(p.size),
    });
  }

  const evenements = await db.query(
    `SELECT h.*, u.first_name, u.last_name
       FROM ticket_history h
       LEFT JOIN users u ON u.id = h.user_id
      WHERE h.ticket_id = ?
      ORDER BY h.sequence ASC, h.id ASC`,
    [ticketId]
  );

  const nom = (l: any): string | null => {
    const complet = [l.first_name, l.last_name].filter(Boolean).join(' ').trim();
    return complet.length > 0 ? complet : null;
  };
  const libelle = await libellesDesTraces(evenements);

  const lignes: LigneFil[] = [
    ...messages.map((m: any) => ({
      type: 'message' as const,
      id: Number(m.id),
      rang: Number(m.sequence ?? 0),
      date: String(m.created_at),
      auteur: { id: m.user_id === null ? null : Number(m.user_id), nom: nom(m) },
      body: m.body,
      interne: Boolean(m.is_interne),
      serviceNom: m.service_nom ?? null,
      pieces: piecesParMessage.get(Number(m.id)) ?? [],
    })),
    ...evenements.map((e: any) => ({
      type: 'evenement' as const,
      id: Number(e.id),
      rang: Number(e.sequence ?? 0),
      date: String(e.created_at),
      auteur: { id: e.user_id === null ? null : Number(e.user_id), nom: nom(e) },
      action: e.action,
      champ: e.champ ?? null,
      ancienne: libelle(e.champ, e.ancienne_valeur),
      nouvelle: libelle(e.champ, e.nouvelle_valeur),
    })),
  ];

  // Le rang fait foi. La date ne sert que de secours pour les lignes reprises
  // d'un import, qui peuvent arriver sans rang ; l'identifiant départage les
  // ex aequo, pour que deux lectures rendent toujours le même ordre.
  return lignes.sort((a, b) => {
    if (a.rang !== b.rang) return a.rang - b.rang;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.id - b.id;
  });
}

// ------------------------------------------------------------------ la lecture

export interface FiltresTickets {
  statutId?: number | null;
  categorieId?: number | null;
  sousCategorieId?: number | null;
  siteId?: number | null;
  technicienId?: number | null;
  serviceId?: number | null;
  demandeurId?: number | null;
  objectId?: number | null;
  /** `true` ne garde que les statuts ouverts, `false` que les clos. */
  ouverts?: boolean | null;
  /** Les clôtures qui attendent un superviseur. */
  aValider?: boolean | null;
  /**
   * Restreint `aValider` aux catégories — racines et filles — que le lecteur
   * supervise. `null` : aucune restriction, pour l'administrateur.
   */
  categoriesSupervisees?: number[] | null;
  recherche?: string | null;
  limite?: number;
  depuis?: number;
}

/** Les conditions issues des filtres, sans la portée, qui est ajoutée à part. */
export function construireFiltres(filtres: FiltresTickets): { sql: string; params: any[] } {
  const conditions: string[] = [];
  const params: any[] = [];

  const egal = (colonne: string, valeur: any) => {
    if (valeur === null || valeur === undefined || valeur === '') return;
    conditions.push(`t.${colonne} = ?`);
    params.push(valeur);
  };

  egal('statut_id', filtres.statutId);
  egal('categorie_id', filtres.categorieId);
  egal('sous_categorie_id', filtres.sousCategorieId);
  egal('site_id', filtres.siteId);
  egal('technicien_id', filtres.technicienId);
  egal('service_id', filtres.serviceId);
  egal('demandeur_id', filtres.demandeurId);
  egal('object_id', filtres.objectId);

  if (filtres.ouverts === true || filtres.ouverts === false) {
    conditions.push(
      `EXISTS (SELECT 1 FROM ticket_statuts st WHERE st.id = t.statut_id AND st.is_ouvert = ?)`
    );
    params.push(filtres.ouverts ? 1 : 0);
  }

  // « À valider » pour moi : ce que je supervise, pas tout ce que je vois.
  if (filtres.aValider) {
    conditions.push(
      `EXISTS (SELECT 1 FROM ticket_statuts sv WHERE sv.id = t.statut_id AND sv.is_validation = 1)`
    );
    const supervisees = filtres.categoriesSupervisees;
    if (supervisees) {
      if (supervisees.length === 0) {
        conditions.push('1 = 0');
      } else {
        const m = supervisees.map(() => '?').join(',');
        conditions.push(`(t.categorie_id IN (${m}) OR t.sous_categorie_id IN (${m}))`);
        params.push(...supervisees, ...supervisees);
      }
    }
  }

  const recherche = String(filtres.recherche ?? '').trim();
  if (recherche.length > 0) {
    // Le numéro affiché est aussi une entrée de recherche : c'est ce qu'on lit
    // sur un courriel de notification, et donc ce qu'on recopie.
    conditions.push('(t.titre LIKE ? OR t.description LIKE ? OR t.reference LIKE ?)');
    const motif = `%${recherche}%`;
    params.push(motif, motif, motif);
  }

  return { sql: conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '', params };
}

/** Les colonnes d'une ligne de liste, jointes à leurs libellés. */
const SELECT_LISTE = `
  SELECT t.*,
         st.nom AS statut_nom, st.couleur AS statut_couleur, st.is_ouvert AS statut_ouvert,
         st.is_validation AS statut_validation,
         c.nom AS categorie_nom, c.couleur AS categorie_couleur,
         sc.nom AS sous_categorie_nom,
         s.name AS site_nom,
         srv.name AS service_nom,
         d.first_name AS demandeur_prenom, d.last_name AS demandeur_nom,
         tech.first_name AS technicien_prenom, tech.last_name AS technicien_nom,
         o.name AS objet_nom, o.reference AS objet_reference
    FROM tickets t
    LEFT JOIN ticket_statuts st ON st.id = t.statut_id
    LEFT JOIN ticket_categories c ON c.id = t.categorie_id
    LEFT JOIN ticket_categories sc ON sc.id = t.sous_categorie_id
    LEFT JOIN cle_sites s ON s.id = t.site_id
    LEFT JOIN services srv ON srv.id = t.service_id
    LEFT JOIN users d ON d.id = t.demandeur_id
    LEFT JOIN users tech ON tech.id = t.technicien_id
    LEFT JOIN objects o ON o.id = t.object_id
`;

export async function listerTickets(
  portee: { sql: string; params: any[] },
  filtres: FiltresTickets
): Promise<any[]> {
  const f = construireFiltres(filtres);
  const limite = Math.min(Math.max(Number(filtres.limite ?? 100), 1), 500);
  const depuis = Math.max(Number(filtres.depuis ?? 0), 0);

  return db.query(
    `${SELECT_LISTE} WHERE 1 = 1${portee.sql}${f.sql}
      ORDER BY t.updated_at DESC, t.id DESC
      LIMIT ? OFFSET ?`,
    [...portee.params, ...f.params, limite, depuis]
  );
}

export async function compterTickets(
  portee: { sql: string; params: any[] },
  filtres: FiltresTickets
): Promise<number> {
  const f = construireFiltres(filtres);
  const ligne = await db.queryOne(
    `SELECT COUNT(*) as cnt FROM tickets t WHERE 1 = 1${portee.sql}${f.sql}`,
    [...portee.params, ...f.params]
  );
  return Number(ligne?.cnt ?? 0);
}

/**
 * Combien de demandes par statut, dans la portée du lecteur.
 *
 * C'est la colonne de gauche de la file, celle que les agents connaissent de
 * GestSup. Les statuts sans aucune demande sont rendus à zéro plutôt qu'omis :
 * une colonne dont les lignes apparaissent et disparaissent selon le contenu
 * est illisible.
 */
export async function compteursParStatut(
  portee: { sql: string; params: any[] },
  filtres: FiltresTickets = {}
): Promise<Array<{ statutId: number; nom: string; couleur: string | null; ordre: number; total: number }>> {
  const f = construireFiltres({ ...filtres, statutId: null });
  const lignes = await db.query(
    `SELECT st.id, st.nom, st.couleur, st.ordre,
            (SELECT COUNT(*) FROM tickets t
              WHERE t.statut_id = st.id${portee.sql}${f.sql}) AS total
       FROM ticket_statuts st
      WHERE st.is_active = 1
      ORDER BY st.ordre ASC, st.id ASC`,
    [...portee.params, ...f.params]
  );
  return lignes.map((l: any) => ({
    statutId: Number(l.id),
    nom: l.nom,
    couleur: l.couleur ?? null,
    ordre: Number(l.ordre ?? 0),
    total: Number(l.total ?? 0),
  }));
}

export async function lireTicket(id: number | string): Promise<any | null> {
  return db.queryOne(`${SELECT_LISTE} WHERE t.id = ?`, [id]);
}

/** Les pièces rattachées au ticket lui-même, et non à un message. */
export async function piecesDuTicket(ticketId: number | string): Promise<any[]> {
  return db.query(
    'SELECT * FROM ticket_documents WHERE ticket_id = ? AND message_id IS NULL ORDER BY created_at ASC',
    [ticketId]
  );
}

/** Les observateurs, personnes et services mêlés. */
export async function observateursDe(ticketId: number | string): Promise<any[]> {
  return db.query(
    `SELECT w.id, w.user_id, w.service_id,
            u.first_name, u.last_name, u.email,
            s.name AS service_nom
       FROM ticket_watchers w
       LEFT JOIN users u ON u.id = w.user_id
       LEFT JOIN services s ON s.id = w.service_id
      WHERE w.ticket_id = ?`,
    [ticketId]
  );
}

export type { Routage };
