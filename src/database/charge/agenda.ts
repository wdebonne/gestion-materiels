import { Contexte, description, inserer, instant, plusMinutes, utilisateurAuHasard, volume } from './outils';

const TYPES = [
  ['maintenance', 30, '#f59e0b'],
  ['meeting', 25, '#3b82f6'],
  ['deadline', 15, '#ef4444'],
  ['reminder', 15, '#8b5cf6'],
  ['other', 15, '#10b981'],
] as const;

const TITRES: Record<string, string[]> = {
  maintenance: ['Vidange', 'Révision annuelle', 'Changement des pneus', 'Contrôle des extincteurs', 'Entretien chaudière'],
  meeting: ['Réunion de service', 'Commission travaux', 'Point sécurité', 'Conseil municipal', 'Réunion associations'],
  deadline: ['Date limite devis', 'Fin de garantie', 'Échéance marché public', 'Renouvellement assurance'],
  reminder: ['Rappel : clés à récupérer', 'Rappel : commande de sel', 'Rappel : sortir les barrières'],
  other: ['Marché de Noël', 'Fête de la musique', 'Brocante', 'Journée citoyenne', 'Inauguration'],
};

export async function genererAgenda(ctx: Contexte): Promise<void> {
  const { alea } = ctx;

  // --- Événements : l'agenda doit tenir des milliers de lignes sur quelques mois
  const nEvenements = volume(ctx, 6_000);
  const evenements: Array<Record<string, unknown>> = [];
  for (let i = 0; i < nEvenements; i++) {
    const [type, , couleur] = alea.pondere(TYPES.map((t) => [t, t[1]] as const));
    const journee = alea.chance(0.25);
    const debut = alea.dateAutour(ctx.maintenant, 540, 365);
    if (journee) debut.setHours(0, 0, 0, 0);
    const materiel = alea.chance(0.5) ? alea.choix(ctx.materiels) : null;
    evenements.push({
      title: `${alea.choix(TITRES[type])}${materiel ? ` — ${materiel.nom}` : ''}`.slice(0, 250),
      description: description(alea),
      event_type: type,
      start_date: instant(debut),
      end_date: instant(plusMinutes(debut, journee ? 1_439 : alea.choix([30, 60, 90, 120, 240, 480]))),
      all_day: journee,
      object_id: materiel?.id ?? null,
      color: couleur,
      reminder_before: alea.choix([0, 0, 15, 60, 1_440]),
      source: 'local',
      created_by: utilisateurAuHasard(ctx, ['admin', 'supervisor', 'agent']),
    });
  }
  await inserer('calendar_events', evenements);

  // --- Alertes, toutes rattachées à un matériel (la purge passe par lui)
  const nAlertes = volume(ctx, 4_000);
  const alertes: Array<Record<string, unknown>> = [];
  for (let i = 0; i < nAlertes; i++) {
    const materiel = alea.choix(ctx.materiels);
    const type = alea.pondere([['technical_control', 30], ['maintenance', 40], ['warranty', 10], ['other', 20]] as const);
    const echeance = alea.dateAutour(ctx.maintenant, 200, 120);
    alertes.push({
      title: `${type === 'technical_control' ? 'Contrôle technique' : type === 'maintenance' ? 'Entretien' : type === 'warranty' ? 'Fin de garantie' : 'Alerte'} — ${materiel.nom}`.slice(0, 250),
      message: alea.chance(0.7) ? description(alea) : null,
      alert_type: type,
      severity: echeance < ctx.maintenant ? alea.choix(['critical', 'warning']) : alea.choix(['info', 'warning']),
      object_id: materiel.id,
      is_read: alea.chance(0.4),
      is_dismissed: alea.chance(0.15),
      due_date: instant(echeance),
    });
  }
  const idsAlertes = await inserer('alerts', alertes);

  const lectures: Array<Record<string, unknown>> = [];
  for (const alerteId of idsAlertes) {
    if (!alea.chance(0.3)) continue;
    for (const u of alea.plusieurs(ctx.utilisateurs, alea.entier(1, 5))) {
      lectures.push({ alert_id: alerteId, user_id: u.id });
    }
  }
  await inserer('alert_reads', lectures);
}
