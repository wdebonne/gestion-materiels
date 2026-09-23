import { Contexte, inserer, instant, volume } from './outils';

const ACTIONS = [
  ['login', 35, null],
  ['logout', 15, null],
  ['create', 15, 'object'],
  ['update', 20, 'object'],
  ['delete', 3, 'object'],
  ['create', 5, 'ticket'],
  ['update', 5, 'manifestation'],
  ['export', 2, 'object'],
] as const;

/**
 * Journal d'activité : la table qui grossit le plus vite en production, et
 * dont l'écran pagine et filtre sur des dizaines de milliers de lignes.
 */
export async function genererJournal(ctx: Contexte): Promise<void> {
  const { alea } = ctx;
  const n = volume(ctx, 50_000);
  const lignes: Array<Record<string, unknown>> = [];
  const connectes = ctx.utilisateurs.filter((u) => u.role !== 'user' || alea.chance(0.5));

  for (let i = 0; i < n; i++) {
    const [action, , entite] = alea.pondere(ACTIONS.map((a) => [a, a[1]] as const));
    const u = alea.choix(connectes.length > 0 ? connectes : ctx.utilisateurs);
    const materiel = entite === 'object' ? alea.choix(ctx.materiels) : null;
    const entiteId =
      entite === 'object' ? materiel!.id
      : entite === 'ticket' && ctx.tickets.length > 0 ? alea.choix(ctx.tickets)
      : entite === 'manifestation' && ctx.manifestations.length > 0 ? alea.choix(ctx.manifestations).id
      : null;

    lignes.push({
      user_id: u.id,
      action,
      entity_type: entite,
      entity_id: entiteId,
      details:
        action === 'login' ? alea.choix(['Connexion réussie (mot de passe)', 'Connexion réussie (passkey)', 'Connexion réussie (SSO)'])
        : action === 'logout' ? 'Déconnexion'
        : materiel ? `Objet ${action === 'create' ? 'créé' : action === 'delete' ? 'supprimé' : 'modifié'}: ${materiel.nom}`
        : `${entite} n°${entiteId}`,
      ip_address: alea.chance(0.9) ? `192.168.${alea.entier(0, 20)}.${alea.entier(2, 254)}` : `2a01:cb1d:${alea.hexa(4)}::${alea.hexa(4)}`,
      created_at: instant(alea.dateAutour(ctx.maintenant, 2 * 365, 0)),
    });
  }
  await inserer('activity_logs', lignes);
}
