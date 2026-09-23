import {
  Contexte,
  DOMAINE_COURRIEL,
  PRENOMS,
  NOMS,
  adresse,
  description,
  heure,
  inserer,
  instant,
  jour,
  plusJours,
  plusMinutes,
  slugifier,
  sansAccents,
  telephone,
  texte,
  utilisateurAuHasard,
  volume,
} from './outils';

/** Noms des articles de stock créés, repris par la purge. */
export const ARTICLES_STOCK: Array<[nom: string, categorie: string, quantite: number, prix: number]> = [
  ['Table pliante (stock)', 'Mobilier', 400, 45], ['Chaise pliante (stock)', 'Mobilier', 1_500, 12],
  ['Banc de brasserie (stock)', 'Mobilier', 300, 60], ['Barrière Vauban (stock)', 'Sécurité', 800, 55],
  ['Barnum 3×3 (stock)', 'Abris', 40, 450], ['Barnum 5×8 (stock)', 'Abris', 12, 1_900],
  ['Grille d’exposition (stock)', 'Exposition', 150, 80], ['Podium 1×2 (stock)', 'Scène', 60, 320],
  ['Enceinte amplifiée (stock)', 'Son', 16, 650], ['Micro HF (stock)', 'Son', 20, 230],
  ['Projecteur LED (stock)', 'Lumière', 40, 190], ['Coffret électrique (stock)', 'Électricité', 25, 380],
  ['Rallonge 25 m (stock)', 'Électricité', 120, 35], ['Poubelle 240 L (stock)', 'Propreté', 200, 70],
  ['Cône de signalisation (stock)', 'Sécurité', 500, 9], ['Panneau déviation (stock)', 'Sécurité', 80, 60],
  ['Grille anti-foule (stock)', 'Sécurité', 100, 110], ['Guirlande guinguette (stock)', 'Lumière', 30, 75],
  ['Table ronde (stock)', 'Mobilier', 60, 90], ['Mange-debout (stock)', 'Mobilier', 50, 70],
];

const TITRES = [
  'Fête de la musique', 'Marché de Noël', 'Brocante du printemps', 'Forum des associations', 'Carnaval des écoles',
  'Cérémonie du 11 Novembre', 'Cérémonie du 8 Mai', '14 Juillet — feu d’artifice', 'Kermesse', 'Loto du club de foot',
  'Repas des anciens', 'Tournoi de pétanque', 'Concert de l’harmonie', 'Exposition de peinture', 'Vide-grenier',
  'Course des Tilleuls', 'Fête du sport', 'Spectacle de fin d’année', 'Galette des rois', 'Journée citoyenne',
  'Mariage', 'Réunion publique', 'Salon du livre', 'Nuit des étoiles', 'Halloween des enfants',
];

const STATUTS = [
  ['pending', 8], ['draft', 12], ['validated', 20], ['delivered', 8], ['recovered', 15], ['archived', 30], ['cancelled', 7],
] as const;

export async function genererManifestations(ctx: Contexte): Promise<void> {
  const { alea } = ctx;

  // --- Stock propre aux manifestations
  const stock = ARTICLES_STOCK.map(([name, category, quantite, price]) => {
    const categorie = ctx.categories.find((c) => c.nature === 'evenementiel');
    return {
      name,
      description: `Article de stock pour manifestations (${category.toLowerCase()}).`,
      category,
      quantity_total: Math.max(1, Math.round(quantite * Math.max(1, ctx.echelle))),
      unit: 'unité',
      etat: alea.choix(['bon', 'bon', 'bon', 'moyen']),
      lieu: alea.choix(['Réserve festivités', 'Centre technique', 'Salle des fêtes']),
      price,
      category_id: categorie?.id ?? null,
    };
  });
  const idsStock = await inserer('manifestation_stock', stock, 'name');
  await inserer(
    'manifestation_stock_aliases',
    idsStock.flatMap((id, i) => [{ stock_id: id, alias: String(stock[i].name).replace(' (stock)', '').toLowerCase() }])
  );

  const objetsPretables = ctx.materiels.filter((m) => m.nature === 'evenementiel' || m.nature === 'informatique');

  // --- Manifestations
  const n = volume(ctx, 2_000);
  const lignes: Array<Record<string, unknown>> = [];
  const dates: Array<{ debut: Date; fin: Date; statut: string }> = [];
  for (let i = 0; i < n; i++) {
    const debut = alea.dateAutour(ctx.maintenant, 3 * 365, 365);
    const duree = alea.pondere([[0, 70], [1, 20], [2, 7], [9, 3]] as const);
    const fin = plusJours(debut, duree);
    fin.setHours(Math.min(23, debut.getHours() + alea.entier(2, 8)));

    let statut: string = alea.pondere(STATUTS);
    // Un statut cohérent avec la date, sauf une petite part laissée incohérente.
    if (alea.chance(0.9)) {
      if (fin < ctx.maintenant && ['pending', 'draft', 'validated'].includes(statut)) statut = alea.choix(['archived', 'recovered', 'cancelled']);
      if (debut > ctx.maintenant && ['delivered', 'recovered', 'archived'].includes(statut)) statut = alea.choix(['validated', 'draft', 'pending']);
    }

    const prenom = alea.choix(PRENOMS);
    const nom = alea.choix(NOMS);
    const titre = `${alea.choix(TITRES)} ${debut.getFullYear()}${alea.chance(0.3) ? ` — ${alea.choix(ctx.sites).nom}` : ''}`;
    lignes.push({
      title: titre,
      name: titre,
      description: description(alea),
      date_start: jour(debut),
      date_end: jour(fin),
      start_date: jour(debut),
      end_date: jour(fin),
      start_time: heure(debut),
      end_time: heure(fin),
      expected_people: alea.pondere([[30, 40], [150, 35], [800, 20], [5_000, 5]] as const) + alea.entier(0, 50),
      contact: `${prenom} ${nom}`,
      contact_name: `${prenom} ${nom}`,
      contact_phone: telephone(alea),
      // Marque de la purge : le contact des manifestations générées est en @charge.test.
      contact_email: `${slugifier(sansAccents(prenom))}.m${i}@${DOMAINE_COURRIEL}`,
      location: alea.chance(0.8) ? alea.choix(ctx.sites).nom : adresse(alea),
      delivery_address: alea.chance(0.5) ? adresse(alea) : null,
      delivery_date: jour(plusJours(debut, -alea.entier(0, 3))),
      recovery_date: jour(plusJours(fin, alea.entier(0, 3))),
      notes_interior: alea.chance(0.4) ? texte(alea) : null,
      notes_exterior: alea.chance(0.3) ? texte(alea) : null,
      status: statut,
      created_by: utilisateurAuHasard(ctx),
      archived_at: statut === 'archived' ? instant(plusJours(fin, alea.entier(3, 40))) : null,
      intake_details: alea.chance(0.15) ? { pole: alea.choix(['Culture', 'Sport', 'Jeunesse']), vinDHonneur: alea.chance(0.5) } : null,
      created_at: instant(plusJours(debut, -alea.entier(7, 120))),
    });
    dates.push({ debut, fin, statut });
  }
  const ids = await inserer('manifestations', lignes, 'contact_email');
  ctx.manifestations = ids.map((id, i) => ({
    id,
    debut: jour(dates[i].debut),
    fin: jour(dates[i].fin),
    statut: dates[i].statut,
  }));

  // --- Matériel demandé, objets du parc, suivi
  const materiels: Array<Record<string, unknown>> = [];
  const items: Array<Record<string, unknown>> = [];
  const historique: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  const approbations: Array<Record<string, unknown>> = [];
  const observateurs: Array<Record<string, unknown>> = [];
  const mouvements: Array<Record<string, unknown>> = [];

  ctx.manifestations.forEach((m, i) => {
    const { debut, statut } = dates[i];
    const livree = ['delivered', 'recovered', 'archived'].includes(statut);
    const recuperee = ['recovered', 'archived'].includes(statut);

    for (const k of alea.plusieurs(idsStock.map((_, j) => j), alea.entier(0, 8))) {
      const demande = alea.entier(1, Math.max(1, Math.round(Number(stock[k].quantity_total) / 10)));
      const perdu = recuperee && alea.chance(0.05) ? alea.entier(1, Math.max(1, Math.floor(demande / 5))) : 0;
      materiels.push({
        manifestation_id: m.id,
        stock_id: idsStock[k],
        quantity_requested: demande,
        quantity_delivered: livree ? demande : 0,
        quantity_recovered: recuperee ? demande - perdu : 0,
        quantity_lost: perdu,
        loss_reason: perdu > 0 ? alea.choix(['Cassé au démontage', 'Non restitué', 'Volé']) : null,
        unit_value: stock[k].price,
      });
      if (perdu > 0) {
        mouvements.push({ stock_id: idsStock[k], manifestation_id: m.id, type: 'perte', quantity: perdu, reason: 'Perte constatée au retour', user_id: ctx.adminId });
      }
    }

    if (objetsPretables.length > 0) {
      for (const o of alea.plusieurs(objetsPretables, alea.pondere([[0, 40], [2, 40], [10, 20]] as const))) {
        const quantite = o.lot ? alea.entier(1, 20) : 1;
        items.push({
          manifestation_id: m.id,
          object_id: o.id,
          quantity: quantite,
          quantity_delivered: livree ? quantite : 0,
          quantity_returned: recuperee ? quantite : 0,
          return_state: recuperee ? alea.pondere([['intact', 90], ['abime', 8], ['perdu', 2]] as const) : null,
        });
      }
    }

    // Historique : création, puis chaque étape franchie.
    const etapes = ['draft', 'validated', 'delivered', 'recovered', 'archived'];
    const atteinte = statut === 'cancelled' || statut === 'pending' ? 1 : etapes.indexOf(statut) + 1;
    let quand = plusJours(debut, -alea.entier(10, 90));
    historique.push({ manifestation_id: m.id, user_id: utilisateurAuHasard(ctx), action: 'Création', to_status: 'draft', created_at: instant(quand) });
    for (let e = 1; e < atteinte; e++) {
      quand = plusMinutes(quand, alea.entier(60, 10_000));
      historique.push({
        manifestation_id: m.id,
        user_id: utilisateurAuHasard(ctx, ['admin', 'supervisor']),
        action: 'Changement de statut',
        from_status: etapes[e - 1],
        to_status: etapes[e],
        created_at: instant(quand),
      });
    }
    if (statut === 'cancelled') {
      historique.push({ manifestation_id: m.id, user_id: ctx.adminId, action: 'Changement de statut', from_status: 'draft', to_status: 'cancelled', comment: 'Annulée par l’organisateur', created_at: instant(plusMinutes(quand, 600)) });
    }

    for (let k = alea.pondere([[0, 50], [3, 35], [12, 15]] as const); k > 0; k--) {
      messages.push({
        manifestation_id: m.id,
        user_id: utilisateurAuHasard(ctx),
        service_id: alea.chance(0.3) ? alea.choix(ctx.services) : null,
        body: alea.chance(0.05) ? description(alea) || texte(alea) : texte(alea),
        created_at: instant(plusMinutes(debut, -alea.entier(60, 60_000))),
      });
    }

    for (const serviceId of alea.plusieurs(ctx.services, alea.pondere([[0, 40], [1, 35], [3, 25]] as const))) {
      const kind = alea.pondere([['approbation', 50], ['information', 20], ['materiel', 20], ['prestation', 10]] as const);
      const decidee = statut !== 'draft' && statut !== 'pending' && alea.chance(0.85);
      approbations.push({
        manifestation_id: m.id,
        service_id: serviceId,
        kind,
        status: decidee ? alea.pondere([['approved', 85], ['rejected', 15]] as const) : 'pending',
        requested_by: utilisateurAuHasard(ctx),
        requested_at: instant(plusJours(debut, -alea.entier(10, 60))),
        decided_by: decidee ? utilisateurAuHasard(ctx, ['admin', 'supervisor', 'service']) : null,
        decided_at: decidee ? instant(plusJours(debut, -alea.entier(1, 9))) : null,
        comment: decidee && alea.chance(0.3) ? texte(alea, 1, 2) : null,
      });
    }

    for (const u of alea.plusieurs(ctx.utilisateurs, alea.pondere([[0, 60], [1, 25], [4, 15]] as const))) {
      observateurs.push({ manifestation_id: m.id, user_id: u.id, added_by: ctx.adminId });
    }
  });

  await inserer('manifestation_materials', materiels);
  await inserer('manifestation_items', items);
  await inserer('manifestation_history', historique);
  await inserer('manifestation_messages', messages);
  await inserer('manifestation_approvals', approbations);
  await inserer('manifestation_watchers', observateurs);
  await inserer('manifestation_stock_movements', mouvements);

  await genererOccupations(ctx, dates);
}

/**
 * Occupations de salles : celles des manifestations, et des réservations
 * isolées. Une partie se heurte volontairement, pour éprouver le calcul des
 * conflits sur un gros volume.
 */
async function genererOccupations(ctx: Contexte, dates: Array<{ debut: Date; fin: Date; statut: string }>): Promise<void> {
  const { alea } = ctx;
  const pieces = ctx.pieces.filter((p) => p.pretable);
  const cibles = pieces.length > 0 ? pieces : ctx.pieces;
  if (cibles.length === 0) return;

  const n = volume(ctx, 5_000);
  const occupations: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) {
    const piece = alea.choix(cibles);
    const liee = alea.chance(0.4) ? alea.entier(0, ctx.manifestations.length - 1) : -1;
    const debut = liee >= 0 ? dates[liee].debut : alea.dateAutour(ctx.maintenant, 365, 365);
    const fin = liee >= 0 ? dates[liee].fin : plusMinutes(debut, alea.choix([60, 120, 180, 240, 600]));
    occupations.push({
      site_id: piece.siteId,
      piece_id: alea.chance(0.9) ? piece.id : null,
      manifestation_id: liee >= 0 ? ctx.manifestations[liee].id : null,
      titre: liee >= 0 ? `Manifestation n°${ctx.manifestations[liee].id}` : alea.choix(['Réunion', 'Cours de yoga', 'Répétition chorale', 'Assemblée générale', 'Permanence', 'Anniversaire', 'Formation']),
      debut: instant(debut),
      fin: instant(fin <= debut ? plusMinutes(debut, 60) : fin),
      statut: alea.pondere([['confirme', 65], ['demande', 25], ['annule', 10]] as const),
      demandeur: alea.chance(0.6) ? `${alea.choix(PRENOMS)} ${alea.choix(NOMS)}` : null,
      notes: alea.chance(0.2) ? texte(alea) : null,
      created_by: utilisateurAuHasard(ctx),
    });
  }
  await inserer('lieu_occupations', occupations);
}
