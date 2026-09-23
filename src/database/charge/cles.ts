import { db } from '../index';
import { Contexte, PREFIXE, description, inserer, instant, jour, materielsDe, plusJours, volume } from './outils';

const OUVRANTS = [
  'Porte principale', 'Porte de service', 'Portail', 'Portillon', 'Porte du local technique',
  'Armoire électrique', 'Grille', 'Issue de secours', 'Porte de la chaufferie', 'Boîte aux lettres',
  'Porte du bureau', 'Placard', 'Cadenas du portail', 'Rideau métallique', 'Porte du vestiaire',
];

export async function genererCles(ctx: Contexte): Promise<void> {
  const { alea } = ctx;

  // --- Ouvrants, rattachés à une pièce quand le site en a
  const nOuvrants = volume(ctx, 1_500);
  const ouvrants: Array<Record<string, unknown>> = [];
  const siteDOuvrant: number[] = [];
  for (let i = 1; i <= nOuvrants; i++) {
    const site = alea.choix(ctx.sites);
    const pieces = ctx.pieces.filter((p) => p.siteId === site.id);
    const piece = pieces.length > 0 && alea.chance(0.7) ? alea.choix(pieces) : null;
    ouvrants.push({
      site_id: site.id,
      piece_id: piece?.id ?? null,
      name: `${alea.choix(OUVRANTS)}${piece ? ` — ${piece.nom}` : ''}`,
      code: `${PREFIXE}D${String(i).padStart(5, '0')}`,
      description: alea.chance(0.2) ? description(alea) : null,
      sort_order: i,
    });
    siteDOuvrant.push(site.id);
  }
  const idsOuvrants = await inserer('cle_ouvrants', ouvrants, 'code');
  ctx.ouvrants = idsOuvrants.map((id, i) => ({ id, siteId: siteDOuvrant[i] }));

  const cles = materielsDe(ctx, 'cle');
  const clesEnLot = cles.filter((c) => c.lot);
  const trousseaux = cles.filter((c) => !c.lot);

  // --- Ce que chaque clé ouvre : un ouvrant, une pièce, ou un site entier (passe)
  const ouvre: Array<Record<string, unknown>> = [];
  for (const cle of cles) {
    const n = alea.pondere([[1, 60], [2, 25], [4, 10], [12, 5]] as const);
    for (const o of alea.plusieurs(ctx.ouvrants, n)) {
      const forme = alea.pondere([['ouvrant', 80], ['piece', 12], ['site', 8]] as const);
      const piece = ctx.pieces.find((p) => p.siteId === o.siteId);
      ouvre.push({
        object_id: cle.id,
        site_id: forme === 'site' ? o.siteId : null,
        ouvrant_id: forme === 'ouvrant' ? o.id : null,
        piece_id: forme === 'piece' && piece ? piece.id : null,
      });
    }
  }
  // Une ligne « pièce » sans pièce trouvée deviendrait vide : on la rabat sur l'ouvrant.
  await inserer(
    'cle_ouvre',
    ouvre.filter((l) => l.site_id || l.ouvrant_id || l.piece_id)
  );

  // --- Lots de fabrication : la quantité d'une clé en lot est la somme de ses lots
  const lots: Array<Record<string, unknown>> = [];
  const quantites = new Map<number, number>();
  for (const cle of clesEnLot) {
    const n = alea.entier(1, 3);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const quantite = alea.entier(1, 25);
      total += quantite;
      lots.push({
        object_id: cle.id,
        quantity: quantite,
        unit_price: i === 0 && alea.chance(0.3) ? null : alea.reel(4, 45),
        acquired_on: jour(alea.dateAutour(ctx.maintenant, 3_000, 0)),
        supplier: alea.choix(['Serrurerie Normande', 'Clés Minute Barentin', 'Vachette', 'Bricard', null]),
        reference: alea.chance(0.5) ? `BC-${alea.entier(1_000, 9_999)}` : null,
        created_by: ctx.adminId,
      });
    }
    quantites.set(cle.id, total);
  }
  await inserer('cle_lots', lots);
  for (const [id, total] of quantites) {
    await db.execute('UPDATE objects SET quantity_total = ? WHERE id = ?', [total, id]);
  }

  // --- Trousseaux : un exemplaire unique qui contient des clés en lot
  const composants: Array<Record<string, unknown>> = [];
  const engagees = new Map<number, number>();
  for (const t of trousseaux) {
    for (const cle of alea.plusieurs(clesEnLot, alea.entier(2, 8))) {
      const dispo = (quantites.get(cle.id) ?? 0) - (engagees.get(cle.id) ?? 0);
      if (dispo < 1) continue;
      engagees.set(cle.id, (engagees.get(cle.id) ?? 0) + 1);
      composants.push({ trousseau_id: t.id, object_id: cle.id, quantity: 1 });
    }
  }
  await inserer('trousseau_composants', composants);

  // --- Attributions : en cours ou rendues, à un agent, un service, un ouvrant ou un tiers
  const nAttributions = volume(ctx, 3_000);
  const attributions: Array<Record<string, unknown>> = [];
  for (let i = 0; i < nAttributions; i++) {
    const cle = alea.choix(cles);
    const type = alea.pondere([['user', 70], ['service', 12], ['ouvrant', 8], ['externe', 10]] as const);
    const remise = alea.dateAutour(ctx.maintenant, 1_000, 0);
    const rendue = alea.chance(0.6);
    const retour = plusJours(remise, alea.entier(1, 400));
    attributions.push({
      object_id: cle.id,
      quantity: cle.lot ? alea.pondere([[1, 90], [2, 8], [5, 2]] as const) : 1,
      holder_type: type,
      holder_user_id: type === 'user' ? alea.choix(ctx.utilisateurs).id : null,
      holder_service_id: type === 'service' ? alea.choix(ctx.services) : null,
      holder_ouvrant_id: type === 'ouvrant' ? alea.choix(ctx.ouvrants).id : null,
      holder_label:
        type === 'externe'
          ? alea.choix(['Entreprise Dupont Chauffage', 'Association Les Amis du Val', 'Société de nettoyage Clean+', 'M. le curé', 'Club de judo'])
          : null,
      remise_on: instant(remise),
      remise_by: ctx.adminId,
      restitution_on: rendue && retour < ctx.maintenant ? instant(retour) : null,
      restitution_by: rendue && retour < ctx.maintenant ? ctx.adminId : null,
      etat_retour: rendue && retour < ctx.maintenant ? alea.choix(['Bon état', 'Usée', 'Cassée', 'Perdue']) : null,
      notes: alea.chance(0.15) ? description(alea) : null,
    });
  }
  await inserer('cle_attributions', attributions);

  // --- Jetons QR des clés
  const jetons = alea
    .plusieurs(cles, Math.ceil(cles.length / 4))
    .map((c) => ({ object_id: c.id, token: alea.hexa(32) }));
  await inserer('cle_jetons', jetons);
}
