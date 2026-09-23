import { db } from '../index';
import { normaliserCategorie } from '../../services/ticketsReferentiel.service';
import {
  Contexte,
  description,
  inserer,
  instant,
  plusMinutes,
  texte,
  texteLong,
  utilisateurAuHasard,
  volume,
} from './outils';

const SOUS_CATEGORIES: Record<string, string[]> = {
  Informatique: ['Poste de travail', 'Imprimante', 'Réseau et Wi-Fi', 'Messagerie', 'Logiciel métier', 'Téléphonie'],
  Bâtiment: ['Plomberie', 'Électricité', 'Chauffage', 'Serrurerie', 'Menuiserie', 'Peinture'],
  Voirie: ['Nid-de-poule', 'Éclairage public', 'Signalisation', 'Trottoir', 'Dépôt sauvage'],
  'Espaces verts': ['Tonte', 'Taille', 'Arrosage', 'Arbre dangereux', 'Aire de jeux'],
  'Matériel et véhicules': ['Panne véhicule', 'Outillage', 'Prêt de matériel', 'Casse'],
};

const TITRES = [
  'Fuite d’eau dans les sanitaires', 'Le chauffage ne fonctionne plus', 'Imprimante bloquée', 'Ampoule grillée dans le couloir',
  'Porte qui ne ferme plus', 'Plus d’accès à la messagerie', 'Nid-de-poule dangereux', 'Lampadaire éteint',
  'Branche cassée au-dessus de l’aire de jeux', 'Clé cassée dans la serrure', 'Écran qui clignote', 'Tag sur la façade',
  'Volet roulant bloqué', 'Wi-Fi très lent', 'Poubelle renversée', 'Demande de nouveau poste', 'Robinet qui goutte',
  'Alarme qui se déclenche sans raison', 'Véhicule qui ne démarre pas', 'Tondeuse en panne',
];

export async function genererTickets(ctx: Contexte): Promise<void> {
  const { alea } = ctx;

  const statuts = await db.query<{ id: number; slug: string; is_ouvert: number; is_final: number; is_defaut: number }>(
    'SELECT id, slug, is_ouvert, is_final, is_defaut FROM ticket_statuts WHERE is_active = 1'
  );
  if (statuts.length === 0) {
    console.warn('⚠️  Aucun statut de ticket : tickets ignorés (le seed a-t-il tourné ?)');
    return;
  }
  const racines = await db.query<{ id: number; nom: string }>(
    'SELECT id, nom FROM ticket_categories WHERE parent_id IS NULL'
  );

  // --- Sous-catégories (marquées par leur auteur, un utilisateur généré)
  const auteur = utilisateurAuHasard(ctx, ['admin']);
  const sous: Array<Record<string, unknown>> = [];
  for (const r of racines) {
    for (const [ordre, nom] of (SOUS_CATEGORIES[r.nom] ?? ['Divers', 'Autre demande']).entries()) {
      sous.push({
        nom,
        name_normalise: normaliserCategorie(nom),
        parent_id: r.id,
        parent_cle: r.id,
        ordre,
        is_active: 1,
        service_id: alea.chance(0.5) && ctx.services.length > 0 ? alea.choix(ctx.services) : null,
        technicien_id: alea.chance(0.4) ? utilisateurAuHasard(ctx, ['agent', 'supervisor']) : null,
        sla_prise_en_charge_minutes: alea.chance(0.5) ? alea.choix([60, 240, 480, 1_440]) : null,
        sla_resolution_minutes: alea.chance(0.5) ? alea.choix([1_440, 4_320, 10_080]) : null,
        created_by: auteur,
      });
    }
  }
  // Une relance sans purge retomberait sur l'unicité (parent, nom) : on saute les existantes.
  const existantes = new Set(
    (await db.query<{ parent_id: number; name_normalise: string }>('SELECT parent_id, name_normalise FROM ticket_categories WHERE parent_id IS NOT NULL'))
      .map((l) => `${l.parent_id}|${l.name_normalise}`)
  );
  const nouvelles = sous.filter((s) => !existantes.has(`${s.parent_id}|${s.name_normalise}`));
  const idsNouvelles = await inserer('ticket_categories', nouvelles);
  const categories: Array<{ racine: number; sous: number | null }> = racines.map((r) => ({ racine: r.id, sous: null }));
  idsNouvelles.forEach((id, i) => categories.push({ racine: Number(nouvelles[i].parent_id), sous: id }));

  // Catégories de ticket liées à des catégories du parc
  const liens: Array<Record<string, unknown>> = [];
  for (const r of racines) {
    for (const c of alea.plusieurs(ctx.categories, alea.entier(0, 3))) {
      liens.push({ ticket_categorie_id: r.id, category_id: c.id });
    }
  }
  await inserer('ticket_categorie_materiels', liens);

  // --- Tickets
  const n = volume(ctx, 15_000);
  const tickets: Array<Record<string, unknown>> = [];
  const suivis: Array<{ creation: Date; statut: (typeof statuts)[number]; demandeur: number; technicien: number | null }> = [];
  const defaut = statuts.find((s) => s.is_defaut) ?? statuts[0];
  // Un ticket clos est le plus souvent résolu ; le refus reste l'exception.
  const finaux = statuts
    .filter((s) => s.is_final)
    .map((s) => [s, /refus|annul/i.test(s.slug) ? 12 : 88] as const);

  for (let i = 1; i <= n; i++) {
    const creation = alea.dateAutour(ctx.maintenant, 3 * 365, 0);
    const ancien = ctx.maintenant.getTime() - creation.getTime() > 60 * 86_400_000;
    // Les vieux tickets sont presque tous clos ; les récents, surtout ouverts.
    const statut = ancien && alea.chance(0.92) && finaux.length > 0
      ? alea.pondere(finaux)
      : alea.chance(0.3) ? defaut : alea.choix(statuts);
    const categorie = alea.choix(categories);
    const site = alea.chance(0.8) ? alea.choix(ctx.sites) : null;
    const piecesDuSite = site ? ctx.pieces.filter((p) => p.siteId === site.id) : [];
    const ouvrantsDuSite = site ? ctx.ouvrants.filter((o) => o.siteId === site.id) : [];
    const demandeur = utilisateurAuHasard(ctx);
    const technicien = statut.id !== defaut.id || alea.chance(0.3) ? utilisateurAuHasard(ctx, ['agent', 'supervisor']) : null;
    const prisEnCharge = technicien ? plusMinutes(creation, alea.entier(5, 4_000)) : null;
    const resolu = statut.is_final ? plusMinutes(creation, alea.entier(60, 60_000)) : null;
    const reference = `T-${creation.getFullYear()}-C${i}`;

    tickets.push({
      reference,
      titre: `${alea.choix(TITRES)}${site ? ` — ${site.nom}` : ''}`.slice(0, 250),
      description: alea.chance(0.05) ? texteLong(alea) : description(alea) ?? texte(alea),
      demandeur_id: demandeur,
      site_id: site?.id ?? null,
      piece_id: piecesDuSite.length > 0 && alea.chance(0.6) ? alea.choix(piecesDuSite).id : null,
      ouvrant_id: ouvrantsDuSite.length > 0 && alea.chance(0.15) ? alea.choix(ouvrantsDuSite).id : null,
      categorie_id: categorie.racine,
      sous_categorie_id: categorie.sous,
      object_id: alea.chance(0.3) ? alea.choix(ctx.materiels).id : null,
      statut_id: statut.id,
      priorite: alea.pondere([['basse', 20], ['normale', 55], ['haute', 18], ['urgente', 7]] as const),
      visibilite_site: alea.chance(0.3),
      service_id: alea.chance(0.5) && ctx.services.length > 0 ? alea.choix(ctx.services) : null,
      technicien_id: technicien,
      echeance_prise_en_charge: alea.chance(0.5) ? instant(plusMinutes(creation, 480)) : null,
      echeance_resolution: alea.chance(0.5) ? instant(plusMinutes(creation, alea.choix([1_440, 4_320, 10_080]))) : null,
      pris_en_charge_at: prisEnCharge ? instant(prisEnCharge) : null,
      pris_en_charge_by: prisEnCharge ? technicien : null,
      resolu_at: resolu ? instant(resolu) : null,
      resolu_by: resolu ? technicien ?? ctx.adminId : null,
      ferme_at: resolu && alea.chance(0.7) ? instant(plusMinutes(resolu, alea.entier(60, 10_000))) : null,
      origine: 'application',
      // Marque de la purge.
      reference_externe: `charge:${i}`,
      created_by: demandeur,
      created_at: instant(creation),
      updated_at: instant(resolu ?? prisEnCharge ?? creation),
    });
    suivis.push({ creation, statut, demandeur, technicien });
  }
  const ids = await inserer('tickets', tickets, 'reference');
  ctx.tickets = ids;

  // --- Messages, historique, observateurs
  const messages: Array<Record<string, unknown>> = [];
  const historique: Array<Record<string, unknown>> = [];
  const observateurs: Array<Record<string, unknown>> = [];
  ids.forEach((ticketId, i) => {
    const { creation, statut, demandeur, technicien } = suivis[i];
    let quand = creation;
    let seqHistorique = 1;
    historique.push({ ticket_id: ticketId, user_id: demandeur, action: 'ouverture', sequence: seqHistorique++, created_at: instant(quand) });
    if (technicien) {
      quand = plusMinutes(quand, alea.entier(5, 2_000));
      historique.push({ ticket_id: ticketId, user_id: ctx.adminId, action: 'modification', sequence: seqHistorique++, champ: 'technicien', nouvelle_valeur: String(technicien), created_at: instant(quand) });
    }
    if (statut.id !== defaut.id) {
      quand = plusMinutes(quand, alea.entier(5, 5_000));
      historique.push({ ticket_id: ticketId, user_id: technicien ?? ctx.adminId, action: 'statut', sequence: seqHistorique++, champ: 'statut', ancienne_valeur: defaut.slug, nouvelle_valeur: statut.slug, created_at: instant(quand) });
    }

    const nMessages = alea.pondere([[0, 15], [2, 35], [5, 35], [15, 12], [60, 3]] as const);
    let moment = creation;
    for (let k = 1; k <= nMessages; k++) {
      moment = plusMinutes(moment, alea.entier(10, 3_000));
      const auteurMessage = technicien && k % 2 === 0 ? technicien : demandeur;
      messages.push({
        ticket_id: ticketId,
        user_id: auteurMessage,
        body: alea.chance(0.03) ? texteLong(alea) : texte(alea, 1, 3),
        is_interne: auteurMessage === technicien && alea.chance(0.3),
        sequence: k,
        created_at: instant(moment),
      });
    }

    for (const u of alea.plusieurs(ctx.utilisateurs, alea.pondere([[0, 70], [1, 20], [3, 10]] as const))) {
      observateurs.push({ ticket_id: ticketId, user_id: u.id, added_by: demandeur });
    }
  });
  await inserer('ticket_messages', messages);
  await inserer('ticket_history', historique);
  await inserer('ticket_watchers', observateurs);

  // --- Droits des agents : catégories de ticket, matériels suivis
  const droitsCategories: Array<Record<string, unknown>> = [];
  const materielsSuivis: Array<Record<string, unknown>> = [];
  for (const u of ctx.utilisateurs) {
    if (['agent', 'supervisor'].includes(u.role) && alea.chance(0.6)) {
      for (const r of alea.plusieurs(racines, alea.entier(1, 3))) {
        droitsCategories.push({ user_id: u.id, ticket_categorie_id: r.id, materiel_autorise: alea.chance(0.5), created_by: ctx.adminId });
      }
    }
    if (alea.chance(0.3)) {
      for (const m of alea.plusieurs(ctx.materiels, alea.entier(1, 6))) {
        materielsSuivis.push({ user_id: u.id, object_id: m.id, note: alea.chance(0.3) ? 'Poste attribué' : null, created_by: ctx.adminId });
      }
    }
  }
  await inserer('user_ticket_categories', droitsCategories);
  await inserer('user_materiels', materielsSuivis);

  // --- Règles de notification : toutes rattachées à un site ou à un destinataire généré
  const regles: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 30; i++) {
    const type = alea.pondere([['user', 50], ['service', 30], ['role', 20]] as const);
    regles.push({
      evenement: alea.choix([null, 'ticket_nouveau', 'ticket_statut', 'ticket_resolu']),
      categorie_id: alea.chance(0.6) && racines.length > 0 ? alea.choix(racines).id : null,
      site_id: alea.choix(ctx.sites).id,
      destinataire_type: type,
      destinataire_user_id: type === 'user' ? utilisateurAuHasard(ctx, ['agent', 'supervisor']) : null,
      destinataire_service_id: type === 'service' && ctx.services.length > 0 ? alea.choix(ctx.services) : null,
      destinataire_role: type === 'role' ? alea.choix(['admin', 'supervisor', 'agent']) : null,
      libelle: `Règle générée n°${i + 1}`,
      is_active: alea.chance(0.85),
      created_by: ctx.adminId,
    });
  }
  await inserer('ticket_notification_regles', regles);
}
