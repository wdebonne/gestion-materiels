import { db } from '../database';
import { expressionPrestation, jointuresPrestation } from './prestationParc.service';

/**
 * Ce qu'un modèle de document peut afficher, pour un service donné.
 *
 * Le principe tient en une phrase : **chaque service ne reçoit que sa part**.
 * Le service qui instruit un débit de boissons n'a que faire du raccordement
 * électrique, du personnel demandé ou du nombre de chaises ; lui envoyer tout
 * l'oblige à trier, et c'est ainsi qu'on finit par ne plus rien lire.
 *
 * Le service **coordinateur** fait exception : c'est lui qui pilote la
 * manifestation, il lui faut l'ensemble.
 *
 * Le catalogue ci-dessous sert deux fois : à remplir le document, et à proposer
 * les valeurs dans l'écran de correspondance. Une liste tenue à deux endroits
 * finirait par diverger, et un champ proposé sans jamais être rempli
 * ressortirait vide dans un arrêté municipal.
 */

export interface DefinitionValeur {
  cle: string;
  libelle: string;
  exemple: string;
  /** Une liste se répète dans le modèle : `{#materiels}…{/materiels}`. */
  liste?: boolean;
}

/** Valeurs offertes à un modèle, dans l'ordre où l'écran les propose. */
export const VALEURS_MODELE: DefinitionValeur[] = [
  { cle: 'manifestation', libelle: 'Nom de la manifestation', exemple: 'Fête de la musique' },
  { cle: 'date_debut', libelle: 'Date de début', exemple: '14/07/2026' },
  { cle: 'date_fin', libelle: 'Date de fin', exemple: '14/07/2026' },
  { cle: 'heure_debut', libelle: 'Heure de début', exemple: '09:00' },
  { cle: 'heure_fin', libelle: 'Heure de fin', exemple: '23:00' },
  { cle: 'date_livraison', libelle: 'Date de livraison', exemple: '13/07/2026' },
  { cle: 'date_recuperation', libelle: 'Date de récupération', exemple: '15/07/2026' },
  { cle: 'lieu', libelle: 'Lieu de livraison', exemple: 'Place du marché' },
  { cle: 'contact_nom', libelle: 'Nom du contact', exemple: 'Martin Dubois' },
  { cle: 'contact_telephone', libelle: 'Téléphone du contact', exemple: '01 02 03 04 05' },
  { cle: 'contact_email', libelle: 'Courriel du contact', exemple: 'martin@ville.fr' },
  { cle: 'personnes_attendues', libelle: 'Personnes attendues', exemple: '250' },
  { cle: 'demandeur', libelle: 'Demandeur', exemple: 'Service des fêtes' },
  { cle: 'statut', libelle: 'Statut de la manifestation', exemple: 'À confirmer' },
  { cle: 'notes', libelle: 'Notes de la demande', exemple: 'Prévoir une rallonge' },
  { cle: 'service', libelle: 'Nom du service destinataire', exemple: 'Service urbanisme' },
  { cle: 'date_du_jour', libelle: 'Date du jour', exemple: '30/08/2026' },
  {
    cle: 'materiels',
    libelle: 'Matériel demandé (liste, votre part)',
    exemple: '{#materiels}{nom} × {quantite}{/materiels}',
    liste: true,
  },
  {
    cle: 'prestations',
    libelle: 'Prestations demandées (liste, votre part)',
    exemple: '{#prestations}{nom} × {quantite}{/prestations}',
    liste: true,
  },
  {
    cle: 'materiel_resume',
    libelle: 'Matériel demandé, en une ligne',
    exemple: '50 × Chaise, 10 × Table',
  },
  {
    cle: 'prestations_resume',
    libelle: 'Prestations demandées, en une ligne',
    exemple: 'Raccordement électrique, Débit de boissons',
  },
];

const LIBELLES_STATUT: Record<string, string> = {
  pending: 'À confirmer',
  draft: 'Brouillon',
  validated: 'Validée',
  delivered: 'Livrée',
  recovered: 'Récupérée',
  archived: 'Archivée',
  cancelled: 'Annulée',
};

/** Date au format français, vide si elle manque. */
const jour = (valeur: string | null | undefined): string =>
  valeur ? new Date(valeur).toLocaleDateString('fr-FR') : '';

/**
 * Lignes de matériel qui relèvent d'un service.
 *
 * Le rattachement suit la catégorie de l'article, directe ou par sa
 * sous-catégorie — la même règle que celle qui décide qui est sollicité. Sans
 * `serviceId`, ou pour le coordinateur, tout est rendu.
 */
async function lignesDuService(
  manifestationId: number | string,
  serviceId: number | null
): Promise<any[]> {
  const base = `
    SELECT mm.quantity_requested, mm.quantity_delivered, mm.quantity_recovered,
           mm.notes, ms.name, ms.unit, ms.is_prestation
    FROM manifestation_materials mm
    JOIN manifestation_stock ms ON ms.id = mm.stock_id
    WHERE mm.manifestation_id = ? AND mm.quantity_requested > 0
  `;

  if (serviceId === null) return db.query(`${base} ORDER BY ms.name`, [manifestationId]);

  return db.query(
    `${base}
       AND EXISTS (
         SELECT 1 FROM service_categories sc
         WHERE sc.service_id = ?
           AND (
             sc.category_id = ms.category_id
             OR EXISTS (
               SELECT 1 FROM subcategories sub
               WHERE sub.id = ms.subcategory_id AND sub.category_id = sc.category_id
             )
           )
       )
     ORDER BY ms.name`,
    [manifestationId, serviceId]
  );
}

/**
 * Lignes venues du parc qui relèvent d'un service.
 *
 * Une prestation peut être tenue dans le parc — le service la range sous sa
 * propre catégorie, à côté de son matériel. Elle doit alors figurer dans le
 * document qu'on lui envoie : lui demander d'approuver un débit de boissons que
 * la pièce jointe ne mentionne nulle part serait pire que de ne rien envoyer.
 *
 * Seules les **prestations** du parc sont reprises ici. Un exemplaire identifié
 * — un camion, un vidéoprojecteur — relève du suivi de matériel unique et non de
 * l'acte qu'on demande à un service d'autoriser.
 *
 * Le rattachement suit la même règle que partout : la catégorie directe du
 * matériel, ou celle de sa sous-catégorie.
 */
async function prestationsDuParcPourService(
  manifestationId: number | string,
  serviceId: number | null
): Promise<any[]> {
  const base = `
    SELECT mi.quantity as quantity_requested, mi.quantity_delivered,
           mi.quantity_returned as quantity_recovered, mi.notes,
           o.name, '' as unit, 1 as is_prestation
    FROM manifestation_items mi
    JOIN objects o ON o.id = mi.object_id
    ${jointuresPrestation()}
    WHERE mi.manifestation_id = ? AND ${expressionPrestation()} = 1
  `;

  if (serviceId === null) return db.query(`${base} ORDER BY o.name`, [manifestationId]);

  return db.query(
    `${base}
       AND EXISTS (
         SELECT 1 FROM service_categories sc
         WHERE sc.service_id = ?
           AND (
             sc.category_id = o.category_id
             OR EXISTS (
               SELECT 1 FROM subcategories sub
               WHERE sub.id = o.subcategory_id AND sub.category_id = sc.category_id
             )
           )
       )
     ORDER BY o.name`,
    [manifestationId, serviceId]
  );
}

/**
 * Données prêtes pour un modèle.
 *
 * `serviceId` à `null` rend l'ensemble : c'est le cas du service coordinateur,
 * et celui de l'aperçu depuis l'écran de réglage.
 */
export async function donneesPourModele(
  manifestationId: number | string,
  serviceId: number | null
): Promise<Record<string, unknown>> {
  const m = await db.queryOne(
    `SELECT m.*, (u.first_name || ' ' || u.last_name) as created_by_name
     FROM manifestations m
     LEFT JOIN users u ON u.id = m.created_by
     WHERE m.id = ?`,
    [manifestationId]
  );
  if (!m) throw new Error('Manifestation non trouvée');

  const service = serviceId
    ? await db.queryOne('SELECT name, is_coordinator FROM services WHERE id = ?', [serviceId])
    : null;

  // Le coordinateur pilote la manifestation : il lui faut tout, pas seulement
  // le matériel de son propre périmètre.
  const portee = service?.is_coordinator ? null : serviceId;

  // Les deux catalogues se rejoignent ici : le stock des manifestations et les
  // prestations tenues dans le parc. Un service qui range ses prestations avec
  // son matériel doit les retrouver dans son document, sans avoir à savoir
  // laquelle des deux tables les porte.
  const lignes = [
    ...(await lignesDuService(manifestationId, portee)),
    ...(await prestationsDuParcPourService(manifestationId, portee)),
  ];

  const materiels = lignes.filter((l: any) => !l.is_prestation);
  const prestations = lignes.filter((l: any) => l.is_prestation);

  const enListe = (l: any) => ({
    nom: l.name,
    quantite: l.quantity_requested,
    unite: l.unit ?? '',
    livre: l.quantity_delivered ?? 0,
    recupere: l.quantity_recovered ?? 0,
    notes: l.notes ?? '',
  });

  return {
    manifestation: m.title ?? '',
    date_debut: jour(m.date_start),
    date_fin: jour(m.date_end),
    heure_debut: m.start_time ?? '',
    heure_fin: m.end_time ?? '',
    date_livraison: jour(m.delivery_date),
    date_recuperation: jour(m.recovery_date),
    lieu: m.delivery_address ?? '',
    contact_nom: m.contact_name ?? '',
    contact_telephone: m.contact_phone ?? '',
    contact_email: m.contact_email ?? '',
    personnes_attendues: m.expected_people ?? '',
    demandeur: m.created_by_name ?? '',
    statut: LIBELLES_STATUT[m.status] ?? m.status ?? '',
    notes: [m.notes_interior, m.notes_exterior].filter(Boolean).join('\n'),
    service: service?.name ?? '',
    date_du_jour: new Date().toLocaleDateString('fr-FR'),

    materiels: materiels.map(enListe),
    prestations: prestations.map(enListe),
    materiel_resume: materiels.map((l: any) => `${l.quantity_requested} × ${l.name}`).join(', '),
    prestations_resume: prestations.map((l: any) => l.name).join(', '),
  };
}

/**
 * Applique la correspondance réglée sur le modèle.
 *
 * Le modèle nomme ses champs comme son rédacteur l'a voulu — `{NOM_FETE}`,
 * `{Date de la manifestation}` — et l'écran de correspondance dit à quelle
 * valeur chacun renvoie. Sans correspondance, un champ qui porte déjà le nom
 * d'une valeur connue est rempli directement : un modèle écrit avec les noms
 * proposés fonctionne sans réglage.
 */
export function appliquerCorrespondance(
  donnees: Record<string, unknown>,
  champsDuModele: string[],
  correspondance: Record<string, string> | null | undefined
): Record<string, unknown> {
  const pourLeModele: Record<string, unknown> = {};

  for (const champ of champsDuModele) {
    const source = correspondance?.[champ];
    if (source && donnees[source] !== undefined) {
      pourLeModele[champ] = donnees[source];
    } else if (donnees[champ] !== undefined) {
      pourLeModele[champ] = donnees[champ];
    } else {
      // Rien de connu : une valeur vide plutôt qu'une accolade imprimée.
      pourLeModele[champ] = '';
    }
  }

  return pourLeModele;
}

/**
 * Jeu d'exemple, pour vérifier un modèle avant qu'une vraie demande arrive.
 *
 * C'est le seul moment où corriger un modèle est encore sans conséquence :
 * s'apercevoir qu'un champ est mal nommé après l'envoi de l'arrêté au service
 * d'urbanisme coûte un courrier d'excuse. Les valeurs viennent du catalogue,
 * pour qu'un exemple ne puisse pas montrer autre chose que ce qui sera rempli.
 */
export function donneesExemple(service?: { name?: string } | null): Record<string, unknown> {
  const exemples: Record<string, unknown> = {};
  for (const valeur of VALEURS_MODELE) {
    if (!valeur.liste) exemples[valeur.cle] = valeur.exemple;
  }

  return {
    ...exemples,
    service: service?.name ?? 'Service urbanisme',
    date_du_jour: new Date().toLocaleDateString('fr-FR'),
    materiels: [
      { nom: 'Table brasserie', quantite: 10, unite: 'unité', livre: 0, recupere: 0, notes: '' },
      { nom: 'Chaise pliante', quantite: 50, unite: 'unité', livre: 0, recupere: 0, notes: '' },
    ],
    prestations: [
      { nom: 'Raccordement électrique', quantite: 1, unite: '', livre: 0, recupere: 0, notes: '' },
    ],
  };
}
