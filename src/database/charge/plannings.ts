import { db } from '../index';
import { Contexte, inserer, jour, plusJours, texte, utilisateurAuHasard, volume } from './outils';

const INTITULES = ['Chef d’équipe', 'Responsable de service', 'Directeur des services techniques', 'Référent'];

export async function genererPlannings(ctx: Contexte): Promise<void> {
  const { alea } = ctx;
  const categories = (await db.query<{ id: number }>('SELECT id FROM planning_categories WHERE is_active = 1')).map((c) => c.id);

  // --- Superviseurs : chaque agent rend compte à un ou deux encadrants
  const encadrants = ctx.utilisateurs.filter((u) => ['supervisor', 'admin'].includes(u.role));
  const agents = ctx.utilisateurs.filter((u) => ['agent', 'user'].includes(u.role));
  const superviseurs: Array<Record<string, unknown>> = [];
  if (encadrants.length > 0) {
    for (const a of agents) {
      if (!alea.chance(0.7)) continue;
      for (const e of alea.plusieurs(encadrants, alea.entier(1, 2))) {
        superviseurs.push({ agent_id: a.id, superviseur_id: e.id, intitule: alea.choix(INTITULES) });
      }
    }
  }
  await inserer('planning_superviseurs', superviseurs);

  // --- Tâches : journées découpées en créneaux, liées parfois à une manifestation ou un ticket
  const n = volume(ctx, 10_000);
  const taches: Array<Record<string, unknown>> = [];
  const travailleurs = agents.length > 0 ? agents : ctx.utilisateurs;
  for (let i = 0; i < n; i++) {
    const agent = alea.choix(travailleurs);
    const date = plusJours(ctx.maintenant, -alea.entier(-30, 540));
    const debut = alea.entier(7 * 4, 16 * 4) * 15;
    const minutes = alea.choix([30, 60, 90, 120, 180, 240, 420]);
    const fin = Math.min(debut + minutes, 23 * 60 + 45);
    const lien = alea.pondere([['aucun', 70], ['manifestation', 15], ['ticket', 15]] as const);
    taches.push({
      user_id: agent.id,
      categorie_id: categories.length > 0 && alea.chance(0.9) ? alea.choix(categories) : null,
      manifestation_id: lien === 'manifestation' && ctx.manifestations.length > 0 ? alea.choix(ctx.manifestations).id : null,
      ticket_id: lien === 'ticket' && ctx.tickets.length > 0 ? alea.choix(ctx.tickets) : null,
      date_jour: jour(date),
      heure_debut: alea.chance(0.85) ? hhmm(debut) : null,
      heure_fin: alea.chance(0.85) ? hhmm(fin) : null,
      minutes: fin - debut,
      description: alea.chance(0.7) ? texte(alea, 1, 2) : null,
      created_by: alea.chance(0.8) ? agent.id : utilisateurAuHasard(ctx, ['supervisor', 'admin']),
    });
  }
  const ids = await inserer('planning_taches', taches);

  // --- Participants : une tâche sur cinq se fait à plusieurs
  const participants: Array<Record<string, unknown>> = [];
  ids.forEach((tacheId, i) => {
    if (!alea.chance(0.2)) return;
    const titulaire = Number(taches[i].user_id);
    for (const u of alea.plusieurs(travailleurs, alea.entier(1, 4))) {
      if (u.id === titulaire) continue;
      participants.push({ tache_id: tacheId, user_id: u.id, minutes: taches[i].minutes });
    }
    if (alea.chance(0.2)) {
      participants.push({ tache_id: tacheId, user_id: null, libelle: alea.choix(['Intérimaire', 'Stagiaire', 'Bénévole']), minutes: taches[i].minutes });
    }
  });
  await inserer('planning_participants', participants);
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
