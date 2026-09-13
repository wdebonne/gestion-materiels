import type BetterSqlite3 from 'better-sqlite3';

/**
 * Écriture d'une reprise Snipe-IT.
 *
 * L'import d'un inventaire est irréversible en pratique : personne ne supprime
 * deux cents fiches à la main pour recommencer. Ces tests fixent donc les trois
 * garanties sur lesquelles repose la confiance qu'on peut lui accorder :
 *
 *   il écrit **ce que l'écran a montré**, et non ce qu'il redéduirait ;
 *   il est **rejouable** — relancé, il met à jour au lieu de dupliquer ;
 *   il **refuse** plutôt que d'écraser, quand un numéro d'inventaire est pris.
 *
 * La lecture des libellés est vérifiée à part (`snipeItLibelle.test.ts`) : elle
 * est pure, elle n'a pas besoin d'une base.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseImport = sqlite;

  return {
    db: {
      getType: () => 'sqlite',
      async query(requete: string, params: any[] = []) {
        return sqlite.prepare(requete).all(...params);
      },
      async queryOne(requete: string, params: any[] = []) {
        return sqlite.prepare(requete).get(...params) ?? null;
      },
      async execute(requete: string, params: any[] = []) {
        const r = sqlite.prepare(requete).run(...params);
        return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes };
      },
    },
  };
});

import { appliquer, type ChoixImport, type PlanImport } from '../src/services/snipeIt.service';
import { lireLibelle } from '../src/services/snipeItLibelle.service';

const base: BetterSqlite3.Database = (global as any).__baseImport;

beforeAll(() => {
  base.exec(`
    CREATE TABLE objects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL, reference VARCHAR(100), serial_number VARCHAR(100),
      category_id INTEGER, subcategory_id INTEGER,
      material_type VARCHAR(20) DEFAULT 'unique', quantity_total INTEGER DEFAULT 0,
      unit_cost REAL DEFAULT 0, status VARCHAR(50), custom_fields TEXT, notes TEXT
    );
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name VARCHAR(100), last_name VARCHAR(100), is_active INTEGER DEFAULT 1);
    CREATE TABLE cle_sites (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255));
    CREATE TABLE cle_ouvrants (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, name VARCHAR(255));
    CREATE TABLE cle_ouvre (id INTEGER PRIMARY KEY AUTOINCREMENT, object_id INTEGER, site_id INTEGER, ouvrant_id INTEGER);
    CREATE TABLE cle_lots (id INTEGER PRIMARY KEY AUTOINCREMENT, object_id INTEGER, quantity INTEGER,
      unit_price DECIMAL(10,2), acquired_on DATE, supplier VARCHAR(255), reference VARCHAR(100), notes TEXT, created_by INTEGER);
    CREATE TABLE trousseau_composants (id INTEGER PRIMARY KEY AUTOINCREMENT, trousseau_id INTEGER, object_id INTEGER, quantity INTEGER, notes TEXT, added_at DATETIME);
    CREATE TABLE cle_attributions (id INTEGER PRIMARY KEY AUTOINCREMENT, object_id INTEGER, quantity INTEGER,
      holder_type VARCHAR(20), holder_user_id INTEGER, holder_service_id INTEGER, holder_ouvrant_id INTEGER,
      holder_label VARCHAR(255), remise_on DATETIME, remise_by INTEGER, restitution_on DATETIME, restitution_by INTEGER,
      etat_retour VARCHAR(50), notes TEXT);
    CREATE TABLE cle_import_snipeit (id INTEGER PRIMARY KEY AUTOINCREMENT, source_type VARCHAR(20),
      source_id INTEGER, object_id INTEGER, site_id INTEGER, imported_at DATETIME, UNIQUE(source_type, source_id));
    CREATE TABLE plugins (id INTEGER PRIMARY KEY AUTOINCREMENT, slug VARCHAR(100), name VARCHAR(100));
    CREATE TABLE plugin_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, plugin_id INTEGER,
      category_id INTEGER, subcategory_id INTEGER);

    INSERT INTO users (id, first_name, last_name) VALUES (1, 'Camille', 'Durand');
    INSERT INTO plugins (id, slug, name) VALUES (11, 'cles', 'Clés et badges');
  `);
});

function planDEssai(): PlanImport {
  return {
    cles: [
      {
        sourceId: 1,
        nom: 'Clé Mairie - Porte principale',
        modele: 'JMA-45',
        serie: 'KM-001',
        quantite: 12,
        prixUnitaire: 2,
        dateAchat: '2024-03-12',
        categorieSnipe: 'Clés',
        lecture: lireLibelle('Clé Mairie - Porte principale'),
        objectIdExistant: null,
      },
      {
        sourceId: 2,
        nom: 'Passe Mairie',
        modele: null,
        serie: null,
        quantite: 5,
        prixUnitaire: 8.5,
        dateAchat: null,
        categorieSnipe: 'Clés',
        lecture: lireLibelle('Passe Mairie'),
        objectIdExistant: null,
      },
    ],
    trousseaux: [
      {
        sourceId: 101,
        inventaire: 'TST001',
        nom: 'Trousseau astreinte',
        serie: null,
        composants: [1, 2],
        detenteur: { type: 'user', nom: 'Camille Durand' },
        dateRemise: '2026-02-10',
        objectIdExistant: null,
      },
      {
        sourceId: 104,
        inventaire: '',
        nom: 'Sans étiquette',
        serie: null,
        composants: [],
        detenteur: null,
        dateRemise: null,
        objectIdExistant: null,
      },
    ],
    sites: ['Mairie'],
    avertissements: [],
  };
}

function choixDEssai(plan: PlanImport): ChoixImport {
  return {
    categoryId: 7,
    cles: plan.cles.map((c) => ({
      sourceId: c.sourceId,
      site: c.lecture.site ?? '',
      ouvrant: c.lecture.ouvrant ?? '',
      estPasse: c.lecture.estPasse,
    })),
    trousseaux: plan.trousseaux.map((t) => t.sourceId),
    reprendreDetenteurs: true,
  };
}

describe('Un premier import écrit ce que le plan décrit', () => {
  let resultat: any;

  beforeAll(async () => {
    const plan = planDEssai();
    resultat = await appliquer(plan, choixDEssai(plan), 1);
  });

  it('crée les clés en lot, avec leur stock repris comme premier lot', () => {
    expect(resultat.clesCreees).toBe(2);

    const cle: any = base.prepare("SELECT * FROM objects WHERE serial_number = 'KM-001'").get();
    expect(cle.material_type).toBe('lot');
    expect(cle.quantity_total).toBe(12);

    const lot: any = base.prepare('SELECT * FROM cle_lots WHERE object_id = ?').get(cle.id);
    // Le prix est figé à la reprise : c'est ce que Snipe-IT sait dire, et une
    // refabrication ultérieure ne doit pas le réévaluer.
    expect(lot.quantity).toBe(12);
    expect(Number(lot.unit_price)).toBe(2);
    expect(lot.acquired_on).toBe('2024-03-12');
  });

  it('range le numéro de modèle en champ personnalisé, pas en colonne', () => {
    const cle: any = base.prepare("SELECT custom_fields FROM objects WHERE serial_number = 'KM-001'").get();
    expect(JSON.parse(cle.custom_fields)).toEqual({ 'Numéro de modèle': 'JMA-45' });
  });

  it('distingue le passe de la porte', () => {
    const passe: any = base.prepare("SELECT id FROM objects WHERE name = 'Passe Mairie'").get();
    const ouvre: any = base.prepare('SELECT * FROM cle_ouvre WHERE object_id = ?').get(passe.id);
    // Un passe se rattache au site, jamais à un ouvrant : il vaut aussi pour
    // les portes ajoutées après coup.
    expect(ouvre.site_id).not.toBeNull();
    expect(ouvre.ouvrant_id).toBeNull();

    const porte: any = base.prepare("SELECT id FROM objects WHERE serial_number = 'KM-001'").get();
    const ouvre2: any = base.prepare('SELECT * FROM cle_ouvre WHERE object_id = ?').get(porte.id);
    expect(ouvre2.ouvrant_id).not.toBeNull();
    expect(ouvre2.site_id).toBeNull();
  });

  it('ne crée qu’un site pour deux clés du même bâtiment', () => {
    expect(base.prepare('SELECT COUNT(*) n FROM cle_sites').get()).toMatchObject({ n: 1 });
    expect(resultat.sitesCrees).toBe(1);
  });

  it('reconstitue la composition du trousseau', () => {
    expect(resultat.compositions).toBe(2);
    const trousseau: any = base.prepare("SELECT id FROM objects WHERE reference = 'TST001'").get();
    const lignes = base.prepare('SELECT * FROM trousseau_composants WHERE trousseau_id = ?').all(trousseau.id);
    expect(lignes).toHaveLength(2);
  });

  it('rattache le détenteur au compte local quand le nom correspond', () => {
    const trousseau: any = base.prepare("SELECT id FROM objects WHERE reference = 'TST001'").get();
    const attribution: any = base
      .prepare('SELECT * FROM cle_attributions WHERE object_id = ?')
      .get(trousseau.id);

    expect(attribution.holder_type).toBe('user');
    expect(attribution.holder_user_id).toBe(1);
    expect(attribution.restitution_on).toBeNull();
  });

  it('ignore un actif sans numéro d’inventaire, et le dit', () => {
    expect(resultat.trousseauxCrees).toBe(1);
    expect(resultat.ignores.join(' ')).toMatch(/inventaire/i);
  });

  it('rattache le plugin à la catégorie de destination', () => {
    // Sans ce rattachement, l'import réussit et l'écran Clés reste vide :
    // le module ne montre que les catégories désignées par `plugin_categories`,
    // et une catégorie absente vaut « aucune », non « toutes ».
    const lien: any = base
      .prepare('SELECT * FROM plugin_categories WHERE plugin_id = 11 AND category_id = 7')
      .get();
    expect(lien).toBeTruthy();
  });

  it('ne rattache pas deux fois la même catégorie', async () => {
    const plan = planDEssai();
    plan.cles = [];
    plan.trousseaux = [];
    await appliquer(plan, { ...choixDEssai(plan), cles: [], trousseaux: [] }, 1);

    const liens: any = base
      .prepare('SELECT COUNT(*) n FROM plugin_categories WHERE plugin_id = 11 AND category_id = 7')
      .get();
    expect(liens.n).toBe(1);
  });
});

describe('Rejouer l’import met à jour au lieu de dupliquer', () => {
  it('ne recrée rien au second passage', async () => {
    const avant: any = base.prepare('SELECT COUNT(*) n FROM objects').get();

    // Second passage : le plan porte cette fois les identifiants locaux, comme
    // le ferait une nouvelle analyse après un premier import.
    const plan = planDEssai();
    for (const cle of plan.cles) {
      const ligne: any = base
        .prepare("SELECT object_id FROM cle_import_snipeit WHERE source_type = 'component' AND source_id = ?")
        .get(cle.sourceId);
      cle.objectIdExistant = ligne?.object_id ?? null;
    }
    for (const t of plan.trousseaux) {
      const ligne: any = base
        .prepare("SELECT object_id FROM cle_import_snipeit WHERE source_type = 'asset' AND source_id = ?")
        .get(t.sourceId);
      t.objectIdExistant = ligne?.object_id ?? null;
    }

    const resultat = await appliquer(plan, choixDEssai(plan), 1);

    expect(resultat.clesCreees).toBe(0);
    expect(resultat.trousseauxCrees).toBe(0);
    expect(resultat.clesMisesAJour).toBe(2);

    const apres: any = base.prepare('SELECT COUNT(*) n FROM objects').get();
    expect(apres.n).toBe(avant.n);
  });

  it('ne rouvre pas une détention déjà en cours', () => {
    const trousseau: any = base.prepare("SELECT id FROM objects WHERE reference = 'TST001'").get();
    const ouvertes: any = base
      .prepare('SELECT COUNT(*) n FROM cle_attributions WHERE object_id = ? AND restitution_on IS NULL')
      .get(trousseau.id);
    // Deux lignes ouvertes rendraient la question « qui l'a ? » insoluble.
    expect(ouvertes.n).toBe(1);
  });

  it('ne duplique pas les lots à chaque passage', () => {
    const cle: any = base.prepare("SELECT id FROM objects WHERE serial_number = 'KM-001'").get();
    const lots: any = base.prepare('SELECT COUNT(*) n FROM cle_lots WHERE object_id = ?').get(cle.id);
    // Sans quoi le stock doublerait à chaque reprise, et la valeur avec.
    expect(lots.n).toBe(1);
  });
});

describe('Ce que l’import refuse', () => {
  it('n’écrase pas un numéro d’inventaire déjà pris par un autre matériel', async () => {
    base.exec("INSERT INTO objects (name, reference, material_type) VALUES ('Vidéoprojecteur', 'TST900', 'unique')");
    const avant: any = base.prepare("SELECT id, name FROM objects WHERE reference = 'TST900'").get();

    const plan = planDEssai();
    plan.cles = [];
    plan.trousseaux = [
      {
        sourceId: 900,
        inventaire: 'TST900',
        nom: 'Trousseau qui voudrait cette place',
        serie: null,
        composants: [],
        detenteur: null,
        dateRemise: null,
        objectIdExistant: null,
      },
    ];

    const resultat = await appliquer(plan, { ...choixDEssai(plan), cles: [] }, 1);

    expect(resultat.trousseauxCrees).toBe(0);
    expect(resultat.ignores.join(' ')).toMatch(/TST900/);

    // Le matériel d'origine est intact : un asset_tag qui existe déjà ici
    // désigne autre chose, et l'écraser ferait disparaître une fiche sans rapport.
    const apres: any = base.prepare("SELECT id, name FROM objects WHERE reference = 'TST900'").get();
    expect(apres).toEqual(avant);
  });

  it('n’écrit que les clés retenues dans le choix', async () => {
    const plan = planDEssai();
    plan.cles[0].sourceId = 50;
    plan.cles[1].sourceId = 51;
    plan.trousseaux = [];

    // Une seule des deux est retenue.
    const resultat = await appliquer(
      plan,
      { categoryId: 7, cles: [{ sourceId: 50, site: 'Mairie', ouvrant: 'Porte principale' }], trousseaux: [], reprendreDetenteurs: false },
      1
    );

    expect(resultat.clesCreees).toBe(1);
  });
});
