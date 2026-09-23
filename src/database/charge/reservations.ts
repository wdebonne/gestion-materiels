import { Contexte, inserer, instant, plusJours, plusMinutes, texte, utilisateurAuHasard, volume } from './outils';

const MOTIFS = [
  'Réunion de service', 'Formation', 'Déplacement à la préfecture', 'Chantier rue du Moulin',
  'Kermesse de l’école', 'Permanence du samedi', 'Intervention d’urgence', 'Salon des associations',
  'Tournée des cimetières', 'Prêt à une association', 'Remplacement d’un véhicule en panne',
];

/**
 * Prêts de matériel, passés, en cours et à venir.
 *
 * Environ 5 % se chevauchent sur le même matériel : c'est ce que l'écran de
 * réservation doit refuser ou signaler, et on veut le voir sur un gros volume.
 */
export async function genererReservations(ctx: Contexte): Promise<void> {
  const { alea } = ctx;
  const pretables = ctx.materiels.filter((m) => !m.lot && m.nature !== 'cle' && m.nature !== 'mobilier_urbain');
  if (pretables.length === 0) return;

  // Une petite partie du parc concentre les prêts, comme dans la réalité.
  const vedettes = alea.plusieurs(pretables, Math.max(20, Math.round(pretables.length / 10)));
  const n = volume(ctx, 8_000);
  const lignes: Array<Record<string, unknown>> = [];
  const derniers = new Map<number, Date>();

  for (let i = 0; i < n; i++) {
    const materiel = alea.chance(0.7) ? alea.choix(vedettes) : alea.choix(pretables);
    const conflit = alea.chance(0.05) && derniers.has(materiel.id);
    const debut = conflit
      ? plusMinutes(derniers.get(materiel.id)!, -alea.entier(60, 600))
      : alea.dateAutour(ctx.maintenant, 2 * 365, 120);
    const fin = plusMinutes(debut, alea.pondere([[120, 40], [480, 30], [1_440 * 2, 20], [1_440 * 14, 10]] as const));
    derniers.set(materiel.id, fin);

    let statut: string;
    if (fin < ctx.maintenant) statut = alea.pondere([['returned', 80], ['cancelled', 10], ['overdue', 10]] as const);
    else if (debut <= ctx.maintenant) statut = alea.pondere([['borrowed', 85], ['overdue', 15]] as const);
    else statut = alea.pondere([['reserved', 60], ['pending', 30], ['cancelled', 10]] as const);

    lignes.push({
      object_id: materiel.id,
      user_id: utilisateurAuHasard(ctx),
      start_date: instant(debut),
      end_date: instant(fin),
      actual_return_date: statut === 'returned' ? instant(plusMinutes(fin, alea.entier(-60, 2_000))) : null,
      reason: alea.chance(0.8) ? `${alea.choix(MOTIFS)}${alea.chance(0.2) ? ` — ${texte(alea, 1, 1)}` : ''}` : null,
      status: statut,
      created_by: utilisateurAuHasard(ctx, ['admin', 'supervisor']),
      created_at: instant(plusJours(debut, -alea.entier(0, 30))),
    });
  }
  await inserer('reservations', lignes);
}
