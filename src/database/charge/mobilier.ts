import { Contexte, COMMUNES, RUES, description, inserer, jour, materielsDe, plusJours, texte, utilisateurAuHasard, volume } from './outils';

const STATUTS = [['en_service', 80], ['maintenance', 8], ['hors_service', 7], ['depose', 5]] as const;
const ETATS = [['neuf', 10], ['bon', 55], ['moyen', 20], ['mauvais', 10], ['remplacer', 5]] as const;
const INTERVENTIONS = ['pose', 'controle', 'nettoyage', 'entretien', 'peinture', 'reparation', 'remplacement', 'deplacement', 'depose', 'degradation'];
const SECTEURS = ['Centre-bourg', 'Quartier de la Gare', 'Le Val', 'Zone d’activités', 'Hameau de Saint-Denis', 'Les Hauts'];

const LAT = 49.5667;
const LNG = 0.9556;

/**
 * Mobilier urbain posé sur la commune : chaque élément est un exemplaire d'un
 * matériel du parc (« Banc public bois » n°1, n°2…). Les jardinières portent
 * parfois des plantations, rattachées par `parent_id`.
 */
export async function genererMobilier(ctx: Contexte): Promise<void> {
  const { alea } = ctx;
  const modeles = materielsDe(ctx, 'mobilier_urbain');
  if (modeles.length === 0) return;

  const n = volume(ctx, 2_000);
  const numeros = new Map<number, number>();
  const elements: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) {
    const modele = alea.choix(modeles);
    const numero = (numeros.get(modele.id) ?? 0) + 1;
    numeros.set(modele.id, numero);
    const rue = alea.choix(RUES);
    elements.push({
      object_id: modele.id,
      numero,
      label: `${modele.nom} n°${numero}`,
      code: `MU-${String(i + 1).padStart(5, '0')}`,
      quantity: 1,
      latitude: LAT + alea.reel(-0.025, 0.025, 7),
      longitude: LNG + alea.reel(-0.035, 0.035, 7),
      position_source: alea.pondere([['carte', 60], ['gps', 35], ['saisie', 5]] as const),
      position_accuracy: alea.chance(0.5) ? alea.reel(2, 30) : null,
      address: `${alea.entier(1, 150)} ${rue}, ${alea.choix(COMMUNES)}`,
      street: rue,
      sector: alea.choix(SECTEURS),
      status: alea.pondere(STATUTS),
      condition_state: alea.pondere(ETATS),
      installed_on: alea.chance(0.8) ? jour(alea.dateAutour(ctx.maintenant, 15 * 365, 0)) : null,
      next_intervention_date: alea.chance(0.3) ? jour(alea.dateAutour(ctx.maintenant, 0, 365)) : null,
      notes: alea.chance(0.2) ? description(alea) : null,
      custom_fields: {},
      created_by: utilisateurAuHasard(ctx),
    });
  }
  const ids = await inserer('street_furniture', elements, 'code');

  // Plantations de jardinières : même position que leur contenant.
  const contenus: Array<Record<string, unknown>> = [];
  ids.forEach((id, i) => {
    if (!String(elements[i].label).startsWith('Jardinière') || !alea.chance(0.6)) return;
    for (let k = 1, nK = alea.entier(1, 4); k <= nK; k++) {
      contenus.push({
        ...elements[i],
        parent_id: id,
        numero: k,
        label: `${alea.choix(['Géraniums', 'Lavandes', 'Graminées', 'Bulbes'])} (${elements[i].label})`,
        code: `${elements[i].code}-${k}`,
        quantity: alea.entier(3, 30),
      });
    }
  });
  const idsContenus = await inserer('street_furniture', contenus);

  const interventions: Array<Record<string, unknown>> = [];
  for (const itemId of [...ids, ...idsContenus]) {
    for (let k = 0, nK = alea.pondere([[0, 30], [1, 40], [4, 25], [15, 5]] as const); k < nK; k++) {
      const date = alea.dateAutour(ctx.maintenant, 5 * 365, 0);
      interventions.push({
        item_id: itemId,
        intervention_type: alea.choix(INTERVENTIONS),
        performed_on: jour(date),
        next_date: alea.chance(0.3) ? jour(plusJours(date, alea.entier(30, 365))) : null,
        description: alea.chance(0.7) ? texte(alea, 1, 2) : null,
        cost: alea.chance(0.4) ? alea.reel(10, 1_200) : null,
        performed_by: alea.choix(['Équipe voirie', 'Services techniques', 'Prestataire', '']),
        user_id: utilisateurAuHasard(ctx, ['agent', 'supervisor']),
      });
    }
  }
  await inserer('street_furniture_interventions', interventions);
}
