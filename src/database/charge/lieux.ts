import { Contexte, PREFIXE, adresse, description, inserer, volume } from './outils';

const SITES = [
  'Hôtel de ville', 'Centre technique municipal', 'École Pasteur', 'École Jules Ferry', 'École maternelle Les Tilleuls',
  'Gymnase Coubertin', 'Salle des fêtes', 'Médiathèque', 'Église Saint-Martin', 'Stade municipal',
  'Piscine intercommunale', 'Maison des associations', 'Centre de loisirs', 'Cimetière', 'Salle polyvalente',
  'Restaurant scolaire', 'Poste de police municipale', 'Crèche Les Petits Pas', 'Dojo', 'Salle de musique',
  'Ateliers municipaux', 'Espace jeunes', 'CCAS', 'Maison France Services', 'Boulodrome',
  'Tennis couvert', 'Foyer des anciens', 'Local syndical', 'Archives municipales', 'Serres municipales',
  'Parc des sports', 'Salle Guy de Maupassant', 'Presbytère', 'Local associatif du Val', 'Chapelle Sainte-Anne',
  'Base nautique', 'Halle du marché', 'Kiosque', 'Local de stockage Nord', 'Local de stockage Sud',
];

const PIECES: Array<[type: string, noms: string[], capacite: [number, number] | null, pretable: number]> = [
  ['Salle', ['Salle du conseil', 'Salle des mariages', 'Salle de réunion', 'Salle polyvalente', 'Salle de classe', 'Salle d’activités'], [8, 300], 0.6],
  ['Bureau', ['Bureau', 'Bureau du directeur', 'Secrétariat', 'Accueil'], [1, 6], 0.05],
  ['Hall', ['Hall d’entrée', 'Grand hall'], [20, 400], 0.3],
  ['Cuisine', ['Cuisine', 'Office', 'Tisanerie'], [2, 20], 0.2],
  ['Local', ['Local technique', 'Chaufferie', 'Local ménage', 'Réserve', 'Local poubelles', 'Vestiaire'], null, 0],
  ['Cour', ['Cour', 'Cour de récréation'], [30, 500], 0.2],
  ['Préau', ['Préau'], [20, 200], 0.3],
  ['Terrain', ['Terrain de foot', 'Terrain synthétique', 'Plateau sportif'], [22, 1_000], 0.7],
];

export async function genererLieux(ctx: Contexte): Promise<void> {
  const { alea } = ctx;
  const nSites = Math.min(SITES.length, volume(ctx, 40));

  const sites = SITES.slice(0, nSites).map((nom, i) => ({
    name: nom,
    code: `${PREFIXE}S${String(i + 1).padStart(2, '0')}`,
    address: adresse(alea),
    sort_order: i,
    is_active: alea.chance(0.95),
    pretable: alea.pondere([[null, 5], [1, 3], [0, 2]] as const),
  }));
  const idsSites = await inserer('cle_sites', sites, 'code');
  ctx.sites = idsSites.map((id, i) => ({ id, nom: sites[i].name }));

  // Environ 600 pièces pour 40 sites, réparties inégalement : une mairie en a
  // beaucoup, un kiosque une seule.
  const nPieces = volume(ctx, 600);
  const pieces: Array<Record<string, unknown>> = [];
  const siteDePiece: number[] = [];
  let numero = 0;
  for (let i = 0; i < nPieces; i++) {
    const site = ctx.sites[Math.floor(Math.pow(alea.nombre(), 1.6) * ctx.sites.length)];
    const [type, noms, capacite, chancePretable] = alea.choix(PIECES);
    numero++;
    pieces.push({
      site_id: site.id,
      name: `${alea.choix(noms)}${alea.chance(0.4) ? ` ${alea.entier(1, 12)}` : ''}`,
      code: `${PREFIXE}P${String(numero).padStart(4, '0')}`,
      description: alea.chance(0.4) ? description(alea) : null,
      type_lieu: alea.chance(0.9) ? type : null,
      capacite: capacite ? alea.entier(capacite[0], capacite[1]) : null,
      pretable: alea.chance(0.15) ? null : alea.chance(chancePretable) ? 1 : 0,
      sort_order: numero,
      is_active: alea.chance(0.96),
    });
    siteDePiece.push(site.id);
  }
  const idsPieces = await inserer('site_pieces', pieces, 'code');
  ctx.pieces = idsPieces.map((id, i) => ({
    id,
    siteId: siteDePiece[i],
    nom: String(pieces[i].name),
    pretable: pieces[i].pretable === 1,
  }));

  // Rattachement des utilisateurs à des sites (voir les tickets du site).
  const rattachements: Array<Record<string, unknown>> = [];
  for (const u of ctx.utilisateurs) {
    if (!alea.chance(0.35)) continue;
    for (const site of alea.plusieurs(ctx.sites, alea.entier(1, 4))) {
      rattachements.push({
        user_id: u.id,
        site_id: site.id,
        peut_voir_tickets: alea.chance(0.6),
        est_responsable: alea.chance(0.15),
        notifie: alea.chance(0.3),
        created_by: ctx.adminId,
      });
    }
  }
  await inserer('user_sites', rattachements);

  // Jetons publics (QR code d'un lieu), dont quelques-uns révoqués.
  const jetons: Array<Record<string, unknown>> = [];
  for (const piece of alea.plusieurs(ctx.pieces, Math.ceil(ctx.pieces.length / 5))) {
    jetons.push({
      site_id: piece.siteId,
      piece_id: piece.id,
      token: alea.hexa(32),
      label: `QR ${piece.nom}`,
      revoked_at: alea.chance(0.1) ? '2025-01-15 10:00:00' : null,
      created_by: ctx.adminId,
    });
  }
  await inserer('lieu_jetons', jetons);
}
