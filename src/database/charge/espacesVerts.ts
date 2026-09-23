import { db } from '../index';
import { Contexte, adresse, description, inserer, jour, materielsDe, plusJours, texte, utilisateurAuHasard, volume } from './outils';

const NOMS = ['Parc', 'Square', 'Jardin', 'Rond-point', 'Coulée verte', 'Cimetière', 'Aire de jeux', 'Talus', 'Verger', 'Bassin'];
const LIEUX = ['des Tilleuls', 'de la Mairie', 'Pasteur', 'du Val', 'des Écoles', 'Victor Hugo', 'de la Gare', 'du Moulin', 'Saint-Martin', 'des Charmilles'];
const TYPES_ELEMENT = ['arbre', 'arbuste', 'fleur', 'pelouse', 'haie', 'banc', 'poubelle', 'bac_fleurs', 'eclairage', 'fontaine', 'cloture', 'jeux', 'allee', 'panneau', 'arrosage', 'autre'];
const ETATS = [['neuf', 10], ['bon', 55], ['moyen', 20], ['mauvais', 10], ['remplacer', 5]] as const;
const ESPECES = ['Tilleul à petites feuilles', 'Érable plane', 'Chêne pédonculé', 'Hêtre pourpre', 'Charme commun', 'Lavande vraie', 'Rosier grimpant', 'Buis', 'Fétuque', 'Géranium vivace'];
const SAISONS = ['printemps', 'ete', 'automne', 'hiver'];

/** Centre de Pavilly : les positions restent groupées sur la commune. */
const LAT = 49.5667;
const LNG = 0.9556;

export async function genererEspacesVerts(ctx: Contexte): Promise<void> {
  const { alea } = ctx;
  const valeurs = async (table: string, repli: string[]) => {
    const lignes = await db.query<{ value: string }>(`SELECT value FROM ${table}`);
    return lignes.length > 0 ? lignes.map((l) => l.value) : repli;
  };
  const types = await valeurs('green_space_types', ['parc']);
  const statuts = await valeurs('green_space_statuses', ['actif']);
  const typesGroupe = await valeurs('green_space_group_types', ['massif']);
  const typesEntretien = await valeurs('green_space_maintenance_types', ['tonte', 'taille']);
  const typesDoc = await valeurs('green_space_doc_types', ['autre']);
  const vegetaux = materielsDe(ctx, 'espaces_verts');

  const n = volume(ctx, 300);
  const espaces: Array<Record<string, unknown>> = [];
  for (let i = 1; i <= n; i++) {
    espaces.push({
      name: `${alea.choix(NOMS)} ${alea.choix(LIEUX)} n°${i}`,
      description: description(alea),
      address: adresse(alea),
      latitude: LAT + alea.reel(-0.02, 0.02, 6),
      longitude: LNG + alea.reel(-0.03, 0.03, 6),
      area_m2: alea.reel(50, 40_000),
      space_type: alea.choix(types),
      soil_type: alea.choix(['', 'limoneux', 'argileux', 'calcaire', 'sableux']),
      status: alea.choix(statuts),
      custom_fields: {},
      // Marque de la purge : l'auteur est un utilisateur généré.
      created_by: utilisateurAuHasard(ctx),
    });
  }
  const ids = await inserer('green_spaces', espaces);

  const groupes: Array<Record<string, unknown>> = [];
  const elements: Array<Record<string, unknown>> = [];
  const entretiens: Array<Record<string, unknown>> = [];
  const saisons: Array<Record<string, unknown>> = [];
  const documents: Array<Record<string, unknown>> = [];
  const annotations: Array<Record<string, unknown>> = [];

  ids.forEach((espaceId, i) => {
    for (let g = 1, nG = alea.entier(0, 5); g <= nG; g++) {
      groupes.push({
        green_space_id: espaceId,
        name: `${alea.choix(['Massif', 'Haie', 'Bosquet', 'Pelouse'])} ${g}`,
        group_type: alea.choix(typesGroupe),
        description: alea.chance(0.3) ? texte(alea, 1, 1) : null,
        pos_x: alea.reel(0, 100, 4),
        pos_y: alea.reel(0, 100, 4),
        area_m2: alea.reel(5, 800),
      });
    }

    for (let e = 1, nE = alea.pondere([[10, 40], [40, 40], [150, 20]] as const); e <= nE; e++) {
      const type = alea.choix(TYPES_ELEMENT);
      const vegetal = ['arbre', 'arbuste', 'fleur', 'haie'].includes(type);
      const plantation = alea.dateAutour(ctx.maintenant, 20 * 365, 0);
      elements.push({
        green_space_id: espaceId,
        object_id: vegetal && vegetaux.length > 0 && alea.chance(0.3) ? alea.choix(vegetaux).id : null,
        label: `${type.replace('_', ' ')} ${e}`,
        code: `EV${i + 1}-${e}`,
        element_type: type,
        description: alea.chance(0.2) ? texte(alea, 1, 2) : null,
        pos_x: alea.reel(0, 100, 4),
        pos_y: alea.reel(0, 100, 4),
        latitude: Number(espaces[i].latitude) + alea.reel(-0.001, 0.001, 7),
        longitude: Number(espaces[i].longitude) + alea.reel(-0.001, 0.001, 7),
        quantity: vegetal ? alea.entier(1, 50) : 1,
        purchase_price: alea.chance(0.6) ? alea.reel(5, 3_000) : null,
        species: vegetal ? alea.choix(ESPECES) : '',
        planting_date: vegetal ? jour(plantation) : null,
        last_maintenance_date: alea.chance(0.7) ? jour(alea.dateAutour(ctx.maintenant, 365, 0)) : null,
        next_maintenance_date: alea.chance(0.5) ? jour(alea.dateAutour(ctx.maintenant, 30, 200)) : null,
        condition_state: alea.pondere(ETATS),
        custom_fields: {},
      });
    }

    for (let m = 0, nM = alea.entier(0, 12); m < nM; m++) {
      const date = alea.dateAutour(ctx.maintenant, 3 * 365, 30);
      entretiens.push({
        green_space_id: espaceId,
        maintenance_type: alea.choix(typesEntretien),
        title: alea.chance(0.7) ? alea.choix(['Tonte hebdomadaire', 'Taille des haies', 'Ramassage des feuilles', 'Désherbage', 'Arrosage']) : null,
        description: alea.chance(0.4) ? texte(alea) : null,
        performed_date: jour(date),
        next_maintenance_date: alea.chance(0.5) ? jour(plusJours(date, alea.entier(7, 180))) : null,
        performed_by: alea.choix(['Équipe espaces verts', 'Prestataire Jardins Normands', 'Brigade verte']),
        duration_minutes: alea.choix([30, 60, 120, 240, 480]),
        cost: alea.chance(0.4) ? alea.reel(20, 1_500) : null,
      });
    }

    for (const saison of alea.plusieurs(SAISONS, alea.entier(0, 4))) {
      saisons.push({
        green_space_id: espaceId,
        season: saison,
        year: ctx.maintenant.getFullYear() - alea.entier(0, 2),
        notes: texte(alea, 1, 2),
        actions_done: alea.chance(0.6) ? texte(alea, 1, 2) : null,
        actions_planned: alea.chance(0.5) ? texte(alea, 1, 2) : null,
        created_by: utilisateurAuHasard(ctx),
      });
    }

    for (let d = 0, nD = alea.entier(0, 3); d < nD; d++) {
      documents.push({
        green_space_id: espaceId,
        name: `${alea.choix(['Plan de gestion', 'Devis', 'Contrat d’entretien', 'Photo avant travaux'])} ${d + 1}`,
        doc_type: alea.choix(typesDoc),
        file_path: null,
        expiry_date: alea.chance(0.3) ? jour(alea.dateAutour(ctx.maintenant, 100, 400)) : null,
        created_by: utilisateurAuHasard(ctx),
      });
    }

    for (let a = 0, nA = alea.entier(0, 6); a < nA; a++) {
      annotations.push({
        green_space_id: espaceId,
        pos_x: alea.reel(0, 100, 4),
        pos_y: alea.reel(0, 100, 4),
        label: alea.choix(['Arbre à surveiller', 'Fuite arrosage', 'Zone boueuse', 'Accès engins', '']),
        icon: alea.choix(['circle', 'alert', 'flag']),
      });
    }
  });

  await inserer('green_space_groups', groupes);
  await inserer('green_space_elements', elements);
  await inserer('green_space_maintenances', entretiens);
  await inserer('green_space_seasons', saisons);
  await inserer('green_space_documents', documents);
  await inserer('green_space_annotations', annotations);
}
