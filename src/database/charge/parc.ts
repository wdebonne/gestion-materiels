import { db } from '../index';
import {
  Contexte,
  NatureCategorie,
  PREFIXE,
  PREFIXE_SLUG,
  description,
  inserer,
  jour,
  slugifier,
  volume,
} from './outils';

interface ModeleCategorie {
  nom: string;
  nature: NatureCategorie;
  /** Part du parc, en poids relatif. */
  poids: number;
  /** Matériel géré en quantité (lot) plutôt qu'à l'unité. */
  lot?: boolean;
  prix: [number, number];
  manifestations?: boolean;
  espacesVerts?: boolean;
  espacePublic?: boolean;
  prestation?: boolean;
  sousCategories: Array<[nom: string, articles: string[]]>;
}

const MODELES: ModeleCategorie[] = [
  {
    nom: 'Véhicules légers', nature: 'vehicule', poids: 1.2, prix: [9_000, 38_000],
    sousCategories: [
      ['Citadines', ['Renault Clio', 'Peugeot 208', 'Renault Zoé', 'Citroën C3']],
      ['Utilitaires', ['Renault Kangoo', 'Citroën Berlingo', 'Peugeot Partner', 'Renault Master', 'Ford Transit']],
      ['Minibus', ['Renault Trafic 9 places', 'Ford Tourneo', 'Mercedes Sprinter']],
      ['Deux-roues', ['Scooter électrique', 'Vélo à assistance électrique']],
    ],
  },
  {
    nom: 'Poids lourds', nature: 'vehicule', poids: 0.3, prix: [60_000, 180_000],
    sousCategories: [
      ['Bennes', ['Camion benne 19 t', 'Porteur benne Renault D']],
      ['Balayeuses', ['Balayeuse Schmidt', 'Balayeuse Dulevo']],
      ['Plateaux', ['Camion plateau grue', 'Porte-engin']],
    ],
  },
  {
    nom: 'Engins et motoculture', nature: 'engin', poids: 1, prix: [300, 45_000],
    sousCategories: [
      ['Tondeuses', ['Tondeuse autoportée Kubota', 'Tondeuse Husqvarna', 'Tondeuse frontale Iseki']],
      ['Tracteurs', ['Tracteur John Deere', 'Microtracteur Kubota']],
      ['Petit outillage thermique', ['Débroussailleuse Stihl', 'Souffleur', 'Taille-haie', 'Tronçonneuse']],
      ['Mini-pelles', ['Mini-pelle Kubota U17', 'Chargeuse compacte']],
    ],
  },
  {
    nom: 'Clés', nature: 'cle', poids: 1.5, lot: true, prix: [3, 90], manifestations: false, espacesVerts: false, espacePublic: false,
    sousCategories: [
      ['Clés simples', ['Clé', 'Clé de porte', 'Clé de portail']],
      ['Badges', ['Badge Vigik', 'Badge d’accès']],
      ['Clés sur organigramme', ['Clé passe partiel', 'Clé passe général']],
      ['Trousseaux', ['Trousseau']],
    ],
  },
  {
    nom: 'Informatique', nature: 'informatique', poids: 2.5, prix: [80, 2_500], manifestations: false,
    sousCategories: [
      ['Ordinateurs portables', ['Dell Latitude 5440', 'Lenovo ThinkPad T14', 'HP ProBook 450']],
      ['Postes fixes', ['Dell OptiPlex 7010', 'HP EliteDesk 800']],
      ['Écrans', ['Écran Dell 24"', 'Écran Iiyama 27"']],
      ['Imprimantes', ['Imprimante Brother', 'Copieur Ricoh', 'Imprimante HP LaserJet']],
      ['Réseau', ['Switch Cisco 24 ports', 'Borne Wi-Fi Ubiquiti', 'Routeur']],
      ['Vidéoprojecteurs', ['Vidéoprojecteur Epson', 'Écran de projection']],
    ],
  },
  {
    nom: 'Téléphonie', nature: 'informatique', poids: 1, prix: [40, 900], manifestations: false,
    sousCategories: [
      ['Smartphones', ['Samsung Galaxy A54', 'iPhone SE', 'Crosscall Core']],
      ['Téléphones fixes', ['Poste Alcatel', 'Poste Yealink']],
      ['Talkies-walkies', ['Talkie Motorola', 'Radio Kenwood']],
    ],
  },
  {
    nom: 'Mobilier', nature: 'divers', poids: 2, prix: [20, 1_200],
    sousCategories: [
      ['Bureaux', ['Bureau droit', 'Bureau d’angle', 'Caisson 3 tiroirs']],
      ['Assises', ['Chaise de bureau', 'Fauteuil ergonomique', 'Chaise pliante']],
      ['Rangements', ['Armoire haute', 'Étagère métallique', 'Vestiaire']],
    ],
  },
  {
    nom: 'Festivités', nature: 'evenementiel', poids: 2.2, lot: true, prix: [15, 2_500], manifestations: true, prestation: false,
    sousCategories: [
      ['Tables et bancs', ['Table pliante 1,80 m', 'Banc de brasserie', 'Table ronde']],
      ['Barnums et tentes', ['Barnum 3×3', 'Barnum 5×8', 'Tente de réception']],
      ['Podium', ['Élément de podium 1×2', 'Escalier de podium', 'Garde-corps']],
      ['Sonorisation', ['Enceinte amplifiée', 'Table de mixage', 'Micro HF', 'Pied d’enceinte']],
      ['Éclairage', ['Projecteur LED', 'Guirlande guinguette', 'Lyre asservie']],
      ['Signalisation', ['Barrière Vauban', 'Panneau déviation', 'Cône de signalisation', 'Grille d’exposition']],
      ['Électricité', ['Coffret électrique', 'Rallonge 25 m', 'Enrouleur']],
    ],
  },
  {
    nom: 'Prestations', nature: 'evenementiel', poids: 0.2, prix: [50, 800], manifestations: true, prestation: true,
    sousCategories: [
      ['Montage', ['Montage de podium', 'Installation électrique']],
      ['Nettoyage', ['Nettoyage après manifestation']],
    ],
  },
  {
    nom: 'Mobilier urbain', nature: 'mobilier_urbain', poids: 1.2, prix: [80, 4_000], manifestations: false, espacePublic: true,
    sousCategories: [
      ['Bancs publics', ['Banc public bois', 'Banc béton']],
      ['Corbeilles', ['Corbeille 60 L', 'Corbeille de tri']],
      ['Jardinières', ['Jardinière bois', 'Bac à fleurs acier']],
      ['Signalétique', ['Panneau d’information', 'Totem directionnel']],
      ['Jeux', ['Toboggan', 'Jeu à ressort', 'Balançoire']],
    ],
  },
  {
    nom: 'Végétaux et fournitures', nature: 'espaces_verts', poids: 0.8, lot: true, prix: [2, 350], manifestations: false, espacesVerts: true,
    sousCategories: [
      ['Arbres', ['Tilleul', 'Érable champêtre', 'Chêne pédonculé', 'Charme']],
      ['Arbustes', ['Lavande', 'Rosier', 'Buis', 'Photinia']],
      ['Vivaces', ['Géranium vivace', 'Sauge', 'Graminée']],
      ['Fournitures', ['Paillage (m³)', 'Terreau (sac)', 'Tuteur']],
    ],
  },
  {
    nom: 'Outillage', nature: 'divers', poids: 1.4, prix: [10, 1_500],
    sousCategories: [
      ['Électroportatif', ['Perceuse Makita', 'Visseuse', 'Meuleuse', 'Scie sabre']],
      ['Échafaudages', ['Échafaudage roulant', 'Escabeau', 'Échelle télescopique']],
      ['Mesure', ['Laser rotatif', 'Télémètre', 'Détecteur de métaux']],
    ],
  },
];

const STATUTS = [
  ['active', 85],
  ['maintenance', 6],
  ['inactive', 5],
  ['out_of_service', 4],
] as const;

const ENERGIES = ['Diesel', 'Essence SP95', 'Électrique', 'Hybride', 'GPL'];

export async function genererParc(ctx: Contexte): Promise<void> {
  const { alea } = ctx;

  // --- Catégories et sous-catégories
  const categories = MODELES.map((m, i) => ({
    name: m.nom,
    slug: `${PREFIXE_SLUG}${slugifier(m.nom)}`,
    description: `Catégorie générée pour les tests de charge (${m.nature}).`,
    has_subcategories: 1,
    available_for_manifestations: m.manifestations ?? true,
    available_for_green_spaces: m.espacesVerts ?? false,
    available_for_public_space: m.espacePublic ?? false,
    is_prestation: m.prestation ?? false,
    sort_order: 100 + i,
  }));
  const idsCategories = await inserer('categories', categories, 'slug');
  ctx.categories = idsCategories.map((id, i) => ({ id, nom: MODELES[i].nom, nature: MODELES[i].nature }));

  const sousCategories: Array<Record<string, unknown>> = [];
  const modeleDeSous: Array<{ modele: ModeleCategorie; articles: string[]; categorieId: number }> = [];
  MODELES.forEach((m, i) => {
    m.sousCategories.forEach(([nom, articles], j) => {
      sousCategories.push({
        category_id: idsCategories[i],
        name: nom,
        slug: `${PREFIXE_SLUG}${slugifier(m.nom)}-${slugifier(nom)}`,
        sort_order: j,
      });
      modeleDeSous.push({ modele: m, articles, categorieId: idsCategories[i] });
    });
  });
  const idsSous = await inserer('subcategories', sousCategories, 'slug');
  ctx.sousCategories = idsSous.map((id, i) => ({
    id,
    categorieId: modeleDeSous[i].categorieId,
    nom: String(sousCategories[i].name),
  }));

  // --- Champs personnalisés : les véhicules et engins ont des compteurs
  const champs: Array<Record<string, unknown>> = [];
  ctx.categories.forEach((c) => {
    if (c.nature === 'vehicule') {
      champs.push(
        { category_id: c.id, field_name: 'immatriculation', field_label: 'Immatriculation', field_type: 'text', is_required: 1, sort_order: 1 },
        { category_id: c.id, field_name: 'typeEnergie', field_label: "Type d'énergie", field_type: 'select', field_options: ENERGIES, sort_order: 2 },
        { category_id: c.id, field_name: 'kilometrage', field_label: 'Kilométrage', field_type: 'number', is_counter: 1, counter_unit: 'km', sort_order: 0 },
        { category_id: c.id, field_name: 'dateMiseEnCirculation', field_label: 'Mise en circulation', field_type: 'date', sort_order: 3 },
      );
    }
    if (c.nature === 'engin') {
      champs.push(
        { category_id: c.id, field_name: 'heuresMoteur', field_label: 'Heures moteur', field_type: 'number', is_counter: 1, counter_unit: 'h', sort_order: 0 },
        { category_id: c.id, field_name: 'typeEnergie', field_label: "Type d'énergie", field_type: 'select', field_options: ['Essence', 'Diesel', 'Électrique'], sort_order: 1 },
      );
    }
    if (c.nature === 'informatique') {
      champs.push(
        { category_id: c.id, field_name: 'adresseMac', field_label: 'Adresse MAC', field_type: 'text', sort_order: 1 },
        { category_id: c.id, field_name: 'finGarantie', field_label: 'Fin de garantie', field_type: 'date', sort_order: 2 },
        { category_id: c.id, field_name: 'commentaireTechnique', field_label: 'Commentaire technique', field_type: 'textarea', sort_order: 3 },
      );
    }
  });
  await inserer('custom_fields_config', champs);

  // --- Matériels
  const total = volume(ctx, 20_000);
  const poidsTotal = MODELES.reduce((s, m) => s + m.poids * m.sousCategories.length, 0);
  const lignes: Array<Record<string, unknown>> = [];
  const meta: Array<Omit<Contexte['materiels'][number], 'id'>> = [];
  let numero = 0;

  modeleDeSous.forEach(({ modele, articles, categorieId }, i) => {
    const part = Math.max(3, Math.round((total * modele.poids) / poidsTotal));
    const sousCategorieId = idsSous[i];
    const trousseau = String(sousCategories[i].name) === 'Trousseaux';
    const enLot = Boolean(modele.lot) && !trousseau && alea.chance(0.9);

    for (let k = 0; k < part; k++) {
      numero++;
      const article = alea.choix(articles);
      const achat = alea.dateAutour(ctx.maintenant, 365 * 12, 0);
      const statut = alea.pondere(STATUTS);
      const champsPerso: Record<string, unknown> = {};
      const lot = enLot && alea.chance(0.85);

      if (modele.nature === 'vehicule') {
        champsPerso.immatriculation = `${lettres(alea, 2)}-${String(alea.entier(1, 999)).padStart(3, '0')}-${lettres(alea, 2)}`;
        champsPerso.typeEnergie = alea.choix(ENERGIES);
        champsPerso.kilometrage = alea.entier(500, 240_000);
        champsPerso.dateMiseEnCirculation = jour(achat);
      } else if (modele.nature === 'engin') {
        champsPerso.heuresMoteur = alea.entier(10, 6_000);
        champsPerso.typeEnergie = alea.choix(['Essence', 'Diesel', 'Électrique']);
      } else if (modele.nature === 'informatique') {
        champsPerso.adresseMac = Array.from({ length: 6 }, () => alea.hexa(2)).join(':').toUpperCase();
        champsPerso.finGarantie = jour(new Date(achat.getTime() + 3 * 365 * 86_400_000));
      }

      const nom =
        modele.nature === 'cle'
          ? `${article} ${trousseau ? alea.choix(['bâtiment', 'école', 'gymnase', 'services techniques']) : ''} n°${numero}`.replace(/\s+/g, ' ')
          : `${article}${alea.chance(0.3) ? ` — ${alea.choix(['bleu', 'n°2', 'atelier', 'réserve', 'mairie', 'école Pasteur'])}` : ''}`;
      const quantite = lot ? alea.entier(2, modele.nature === 'evenementiel' ? 400 : 60) : 0;
      const prix = alea.reel(modele.prix[0], modele.prix[1]);

      lignes.push({
        category_id: categorieId,
        subcategory_id: sousCategorieId,
        name: nom,
        description: description(alea),
        reference: `${PREFIXE}O-${String(numero).padStart(6, '0')}`,
        serial_number: alea.chance(0.7) ? `SN${alea.hexa(10).toUpperCase()}` : null,
        purchase_date: alea.chance(0.9) ? jour(achat) : null,
        purchase_price: alea.chance(0.85) ? prix : null,
        status: statut,
        location: alea.chance(0.8) ? alea.choix(['Centre technique', 'Mairie', 'Garage', 'Réserve festivités', 'Salle des fêtes', 'Médiathèque', 'École Pasteur', 'Gymnase']) : null,
        notes: alea.chance(0.3) ? description(alea) : null,
        custom_fields: Object.keys(champsPerso).length > 0 ? champsPerso : null,
        material_type: lot ? 'lot' : 'unique',
        quantity_total: lot ? quantite : 0,
        unit_cost: lot ? Math.round((prix / Math.max(1, quantite)) * 100) / 100 : 0,
        inventaire_interne: alea.chance(0.7) ? `INV-${achat.getFullYear()}-${String(numero).padStart(6, '0')}` : null,
        created_at: `${jour(achat)} 09:00:00`,
      });
      meta.push({ categorieId, sousCategorieId, nature: modele.nature, nom, lot });
    }
  });

  const ids = await inserer('objects', lignes, 'reference');
  ctx.materiels = ids.map((id, i) => ({ id, ...meta[i] }));

  await rattacherPlugins(ctx);
  await genererDroits(ctx);
}

function lettres(alea: Contexte['alea'], n: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTVWXYZ';
  return Array.from({ length: n }, () => alea.choix(alphabet.split(''))).join('');
}

/**
 * Active les plugins et leur rattache les catégories générées.
 *
 * Sans rattachement, l'écran des clés reste vide (voir
 * `clauseCategoriesDuPlugin`) et les onglets carburant, contrôle technique et
 * entretien s'affichent sur tout le parc. Ce n'est permis que parce que la base
 * a été reconnue comme base de test (voir `charge.ts`).
 */
async function rattacherPlugins(ctx: Contexte): Promise<void> {
  await db.execute('UPDATE plugins SET is_active = 1');

  const plugins = await db.query<{ id: number; slug: string }>('SELECT id, slug FROM plugins');
  const parSlug = new Map(plugins.map((p) => [p.slug, p.id]));
  const categoriesDe = (...natures: NatureCategorie[]) =>
    ctx.categories.filter((c) => natures.includes(c.nature)).map((c) => c.id);

  const liens: Array<Record<string, unknown>> = [];
  const lier = (slug: string, categories: number[]) => {
    const pluginId = parSlug.get(slug);
    if (!pluginId) return;
    for (const categoryId of categories) liens.push({ plugin_id: pluginId, category_id: categoryId, subcategory_id: null });
  };

  lier('fuel', categoriesDe('vehicule', 'engin'));
  lier('technical-control', categoriesDe('vehicule'));
  lier('maintenance', categoriesDe('vehicule', 'engin'));
  lier('cles', categoriesDe('cle'));
  await inserer('plugin_categories', liens);
}

/** Droits par catégorie pour une partie des utilisateurs simples. */
async function genererDroits(ctx: Contexte): Promise<void> {
  const { alea } = ctx;
  const droits: Array<Record<string, unknown>> = [];
  for (const u of ctx.utilisateurs) {
    if (!['user', 'agent'].includes(u.role) || !alea.chance(0.3)) continue;
    for (const c of alea.plusieurs(ctx.categories, alea.entier(1, 5))) {
      droits.push({
        user_id: u.id,
        category_id: c.id,
        subcategory_id: null,
        can_view: 1,
        can_edit: alea.chance(0.4),
        can_delete: alea.chance(0.1),
      });
    }
  }
  await inserer('user_permissions', droits);
}
