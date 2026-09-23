import {
  Contexte,
  DOMAINE_COURRIEL,
  NOMS,
  PREFIXE_SLUG,
  PRENOMS,
  inserer,
  instant,
  plusJours,
  slugifier,
  sansAccents,
  volume,
} from './outils';

const SERVICES = [
  'Services techniques', 'Espaces verts', 'Voirie', 'Festivités', 'Informatique', 'Communication',
  'Sports', 'Culture', 'Médiathèque', 'Écoles', 'Restauration scolaire', 'Police municipale',
  'Urbanisme', "État civil", 'CCAS', 'Jeunesse', 'Bâtiments', 'Propreté urbaine', 'Garage municipal',
  'Direction générale', 'Finances', 'Ressources humaines', 'Marchés publics', 'Vie associative', 'Cimetières',
];

const EVENEMENTS_NOTIFICATION = [
  'new_request', 'approval_requested', 'approval_decided', 'message', 'dates_changed',
  'material_changed', 'delivery_reminder', 'recovery_overdue', 'ticket_nouveau', 'ticket_assigne',
  'ticket_message', 'ticket_statut', 'ticket_resolu', 'ticket_echeance',
];

export async function genererUtilisateurs(ctx: Contexte): Promise<void> {
  const { alea } = ctx;
  const n = volume(ctx, 300);

  const lignes: Array<Record<string, unknown>> = [];
  for (let i = 1; i <= n; i++) {
    const prenom = alea.choix(PRENOMS);
    const nom = alea.choix(NOMS);
    const role = alea.pondere([
      ['admin', 2],
      ['supervisor', 10],
      ['agent', 25],
      ['service', 8],
      ['user', 55],
    ] as const);
    const peutSeConnecter = alea.chance(0.92);
    const email = `${slugifier(sansAccents(prenom))}.${slugifier(sansAccents(nom))}.${i}@${DOMAINE_COURRIEL}`;
    lignes.push({
      email,
      password: peutSeConnecter ? ctx.motDePasse : null,
      first_name: prenom,
      last_name: nom,
      role,
      is_active: alea.chance(0.95),
      can_login: peutSeConnecter,
      last_login: alea.chance(0.8) ? instant(alea.dateAutour(ctx.maintenant, 120, 0)) : null,
      failed_login_attempts: alea.chance(0.05) ? alea.entier(1, 4) : 0,
      created_at: instant(alea.dateAutour(ctx.maintenant, 1100, 0)),
    });
  }

  const ids = await inserer('users', lignes, 'email');
  ctx.utilisateurs = ids.map((id, i) => ({
    id,
    role: String(lignes[i].role),
    nom: `${lignes[i].first_name} ${lignes[i].last_name}`,
  }));

  // Préférences de notification : une partie des agents a coupé certains envois.
  const preferences: Array<Record<string, unknown>> = [];
  for (const u of ctx.utilisateurs) {
    if (!alea.chance(0.4)) continue;
    for (const evenement of alea.plusieurs(EVENEMENTS_NOTIFICATION, alea.entier(1, 8))) {
      preferences.push({ user_id: u.id, event: evenement, enabled: alea.chance(0.3) });
    }
  }
  await inserer('notification_preferences', preferences);
}

export async function genererServices(ctx: Contexte): Promise<void> {
  const { alea } = ctx;
  const n = Math.min(SERVICES.length, volume(ctx, 25));

  const lignes = SERVICES.slice(0, n).map((nom, i) => ({
    name: nom,
    slug: `${PREFIXE_SLUG}${slugifier(nom)}`,
    email: `${slugifier(nom)}@${DOMAINE_COURRIEL}`,
    description: `Service ${nom.toLowerCase()} de la commune.`,
    is_observer: i % 7 === 3,
    is_coordinator: i === 3,
    is_active: alea.chance(0.95),
  }));
  ctx.services = await inserer('services', lignes, 'slug');

  const membres: Array<Record<string, unknown>> = [];
  const delegations: Array<Record<string, unknown>> = [];
  for (const serviceId of ctx.services) {
    const equipe = alea.plusieurs(ctx.utilisateurs, alea.entier(3, 12));
    equipe.forEach((u, i) => membres.push({ service_id: serviceId, user_id: u.id, is_manager: i === 0 }));

    if (alea.chance(0.3)) {
      const debut = alea.dateAutour(ctx.maintenant, 60, 30);
      delegations.push({
        service_id: serviceId,
        delegate_user_id: alea.choix(ctx.utilisateurs).id,
        granted_by: equipe[0].id,
        start_date: instant(debut).slice(0, 10),
        end_date: instant(plusJours(debut, alea.entier(3, 30))).slice(0, 10),
      });
    }
  }
  await inserer('service_members', membres);
  await inserer('service_delegations', delegations);
}
