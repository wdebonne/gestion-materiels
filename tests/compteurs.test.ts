import type BetterSqlite3 from 'better-sqlite3';

/**
 * Compteurs relevables, et énergie qui n'est pas toujours du carburant.
 *
 * Deux règles se protègent ici, parce que les deux étaient auparavant des
 * suppositions écrites en dur dans la page :
 *
 *   1. **Un matériel n'a que les compteurs que sa branche déclare.** Le champ
 *      « Kilométrage » apparaissait dans les trois modales de saisie quel que
 *      soit le matériel — sur une tondeuse, sur une table. Une catégorie sans
 *      compteur n'en reçoit plus aucun, et c'est ce que vérifie le premier
 *      groupe de tests.
 *
 *   2. **Un compteur ne recule pas.** Le report était fait par la page, après
 *      coup, avec un `PUT` sur la fiche entière : il ne s'appliquait pas à une
 *      saisie hors réseau rejouée plus tard, ni à un import, ni à l'API. Le
 *      report se fait au serveur, et un relevé plus bas est conservé sur
 *      l'écriture sans rabaisser la fiche.
 *
 * Le nom du champ mérite un test à lui seul : la propagation visait la clé
 * `kilometrage`, en dur. Un champ nommé « kilométrages » — ce que produit la
 * saisie d'un libellé au pluriel dans l'écran de configuration — n'était jamais
 * alimenté, et la fiche affichait un compteur vide pendant que l'historique des
 * pleins en portait un.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__baseCompteurs = sqlite;

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

import {
  appliquerReleves,
  compteursAvecValeurs,
  compteursDuMateriel,
  natureEcriture,
  natureEnergie,
  relevesDUneEcriture,
  relevesPourEcriture,
  valeurEnergie,
} from '../src/services/compteurs.service';

const base: BetterSqlite3.Database = (global as any).__baseCompteurs;

/** Champs personnalisés d'un matériel, tels que la base les porte. */
const champsDe = (id: number): Record<string, any> => {
  const ligne = base.prepare('SELECT custom_fields FROM objects WHERE id = ?').get(id) as any;
  return ligne?.custom_fields ? JSON.parse(ligne.custom_fields) : {};
};

/**
 * Un parc réduit au strict nécessaire, mais qui couvre les quatre cas.
 *
 *   Véhicules (1)    kilométrage en km — le cas d'origine, au libellé pluriel
 *                    tel que l'écran de configuration le produit
 *   Tondeuses (2)    heures moteur : un compteur, mais pas des kilomètres
 *   Mobilier (3)     aucun compteur déclaré : une table ne compte rien
 *   Utilitaires (11) sous-catégorie de Véhicules avec sa propre configuration,
 *                    qui ajoute un second compteur
 */
beforeAll(() => {
  base.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name VARCHAR(255));
    CREATE TABLE subcategories (id INTEGER PRIMARY KEY, category_id INTEGER, name VARCHAR(255));
    CREATE TABLE objects (
      id INTEGER PRIMARY KEY, name VARCHAR(255),
      category_id INTEGER, subcategory_id INTEGER, custom_fields TEXT
    );
    CREATE TABLE custom_fields_config (
      id INTEGER PRIMARY KEY, category_id INTEGER, subcategory_id INTEGER,
      field_name VARCHAR(100), field_label VARCHAR(255), field_type VARCHAR(50),
      is_counter INTEGER DEFAULT 0, counter_unit VARCHAR(20),
      sort_order INTEGER DEFAULT 0, applicable_subcategories TEXT
    );
  `);

  base.exec(`
    INSERT INTO categories (id, name) VALUES (1, 'Véhicules'), (2, 'Tondeuses'), (3, 'Mobilier');
    INSERT INTO subcategories (id, category_id, name) VALUES
      (10, 1, 'Voitures'),
      (11, 1, 'Utilitaires'),
      (30, 3, 'Tables');

    INSERT INTO custom_fields_config
      (id, category_id, subcategory_id, field_name, field_label, field_type, is_counter, counter_unit, sort_order) VALUES
      (1, 1, NULL, 'kilometrages', 'Kilométrages', 'number', 1, 'km', 0),
      (2, 1, NULL, 'marque', 'Marque', 'text', 0, NULL, 1),
      (3, 2, NULL, 'heures_moteur', 'Heures moteur', 'number', 1, 'h', 0),
      (4, 3, NULL, 'matiere', 'Matière', 'text', 0, NULL, 0),
      (5, NULL, 11, 'kilometrages', 'Kilométrages', 'number', 1, 'km', 0),
      (6, NULL, 11, 'heures_hayon', 'Heures de hayon', 'number', 1, 'h', 1);

    INSERT INTO objects (id, name, category_id, subcategory_id, custom_fields) VALUES
      (1, 'Peugeot 208', 1, 10, '{"kilometrages":84320,"typeCarburant":"Électrique"}'),
      (2, 'Renault Trafic', 1, 11, '{"kilometrages":51000,"typeCarburant":"Diesel"}'),
      (3, 'Tondeuse autoportée', 2, NULL, '{"heures_moteur":412}'),
      (4, 'Table pliante', NULL, 30, '{}'),
      (5, 'Camion neuf', 1, 10, '{}');
  `);
});

describe('Compteurs déclarés par la branche', () => {
  it('rend le compteur de la catégorie, avec son unité', async () => {
    expect(await compteursDuMateriel(1)).toEqual([
      { fieldName: 'kilometrages', fieldLabel: 'Kilométrages', unit: 'km', sortOrder: 0 },
    ]);
  });

  it('compte en heures là où la catégorie le demande', async () => {
    const compteurs = await compteursDuMateriel(3);
    expect(compteurs).toHaveLength(1);
    expect(compteurs[0]).toMatchObject({ fieldName: 'heures_moteur', unit: 'h' });
  });

  it("n'en rend aucun pour un matériel dont la branche n'en déclare pas", async () => {
    // C'est ce qui fait disparaître le champ « Kilométrage » du formulaire
    // d'entretien d'une table.
    expect(await compteursDuMateriel(4)).toEqual([]);
  });

  it('laisse une sous-catégorie ajouter le sien, dans son ordre', async () => {
    const compteurs = await compteursDuMateriel(2);
    expect(compteurs.map((c) => c.fieldName)).toEqual(['kilometrages', 'heures_hayon']);
  });

  it('accompagne chaque compteur de la valeur portée par la fiche', async () => {
    expect(await compteursAvecValeurs(1)).toEqual([
      { fieldName: 'kilometrages', fieldLabel: 'Kilométrages', unit: 'km', sortOrder: 0, value: 84320 },
    ]);
  });

  it('rend une valeur nulle pour un compteur jamais relevé', async () => {
    const compteurs = await compteursAvecValeurs(5);
    expect(compteurs[0].value).toBeNull();
  });
});

describe('Un compteur ne recule pas', () => {
  it('reporte un relevé plus élevé sur la fiche', async () => {
    const resultat = await appliquerReleves(1, { kilometrages: 84500 });

    expect(resultat.retenus).toEqual([
      { fieldName: 'kilometrages', fieldLabel: 'Kilométrages', unit: 'km', value: 84500 },
    ]);
    expect(resultat.ignores).toEqual([]);
    expect(champsDe(1).kilometrages).toBe(84500);
  });

  it('alimente le champ tel qu’il est nommé, et non une clé « kilometrage » figée', async () => {
    // La propagation visait `custom_fields.kilometrage` en dur : un champ
    // nommé au pluriel restait vide, et la fiche affichait l'ancienne valeur.
    expect(champsDe(1)).not.toHaveProperty('kilometrage');
    expect(champsDe(1)).toHaveProperty('kilometrages');
  });

  it('conserve les autres champs personnalisés du matériel', async () => {
    expect(champsDe(1).typeCarburant).toBe('Électrique');
  });

  it('refuse un relevé plus bas, et dit pourquoi', async () => {
    const resultat = await appliquerReleves(1, { kilometrages: 84100 });

    expect(resultat.retenus).toEqual([]);
    expect(resultat.ignores).toEqual([
      {
        fieldName: 'kilometrages',
        fieldLabel: 'Kilométrages',
        unit: 'km',
        value: 84100,
        valeurEnFiche: 84500,
      },
    ]);
    // La fiche n'a pas bougé : c'est toute la règle.
    expect(champsDe(1).kilometrages).toBe(84500);
  });

  it('refuse un relevé identique sans le signaler comme une avancée', async () => {
    const resultat = await appliquerReleves(1, { kilometrages: 84500 });
    expect(resultat.retenus).toEqual([]);
    expect(resultat.ignores).toHaveLength(1);
  });

  it('accepte un premier relevé sur un compteur vide', async () => {
    const resultat = await appliquerReleves(5, { kilometrages: 12 });
    expect(resultat.retenus).toHaveLength(1);
    expect(champsDe(5).kilometrages).toBe(12);
  });

  it('ignore un relevé qui ne correspond à aucun compteur de la branche', async () => {
    // Un client obsolète, ou une catégorie reconfigurée depuis la saisie.
    const resultat = await appliquerReleves(3, { kilometrages: 999999 });
    expect(resultat.retenus).toEqual([]);
    expect(champsDe(3)).not.toHaveProperty('kilometrages');
  });

  it('ne touche à rien pour un matériel sans compteur', async () => {
    const resultat = await appliquerReleves(4, { kilometrages: 500 });
    expect(resultat).toEqual({ retenus: [], ignores: [] });
    expect(champsDe(4)).toEqual({});
  });

  it('tolère la virgule décimale du pavé numérique', async () => {
    const resultat = await appliquerReleves(3, { heures_moteur: '415,5' });
    expect(resultat.retenus[0].value).toBe(415.5);
  });

  it('traite chaque compteur séparément', async () => {
    // Le hayon avance, le kilométrage non : l'un passe, l'autre est signalé.
    const resultat = await appliquerReleves(2, { kilometrages: 40000, heures_hayon: 120 });

    expect(resultat.retenus.map((r) => r.fieldName)).toEqual(['heures_hayon']);
    expect(resultat.ignores.map((r) => r.fieldName)).toEqual(['kilometrages']);
    expect(champsDe(2).kilometrages).toBe(51000);
    expect(champsDe(2).heures_hayon).toBe(120);
  });
});

describe('Relevés portés par une écriture', () => {
  it('range le compteur principal dans `mileage`, que le module Suivi lit encore', async () => {
    const releves = await relevesPourEcriture(2, { kilometrages: 52000, heures_hayon: 130 });

    expect(releves.mileage).toBe(52000);
    expect(JSON.parse(releves.readings!)).toEqual({ kilometrages: 52000, heures_hayon: 130 });
  });

  it('range un `mileage` seul sur le compteur principal', async () => {
    // Ce qu'envoie un client qui ne connaît pas encore les compteurs, ou un
    // appel d'API écrit avant eux : la valeur ne doit pas être perdue.
    const releves = await relevesPourEcriture(1, undefined, 90000);
    expect(JSON.parse(releves.readings!)).toEqual({ kilometrages: 90000 });
  });

  it('laisse passer un kilométrage brut quand la branche ne déclare rien', async () => {
    const releves = await relevesPourEcriture(4, undefined, 300);
    expect(releves).toEqual({ readings: null, mileage: 300, valeurs: {} });
  });

  it('relit les relevés d’une écriture', () => {
    const compteurs = [{ fieldName: 'kilometrages', fieldLabel: 'Kilométrages', unit: 'km', sortOrder: 0 }];
    expect(relevesDUneEcriture({ readings: '{"kilometrages":77000}', mileage: 1 }, compteurs)).toEqual({
      kilometrages: 77000,
    });
  });

  it('présente le kilométrage des écritures antérieures comme le compteur principal', () => {
    // Aucune reprise de données : l'historique existant reste lisible.
    const compteurs = [{ fieldName: 'kilometrages', fieldLabel: 'Kilométrages', unit: 'km', sortOrder: 0 }];
    expect(relevesDUneEcriture({ readings: null, mileage: 61000 }, compteurs)).toEqual({
      kilometrages: 61000,
    });
  });

  it('ne rend rien plutôt que d’échouer sur un JSON illisible', () => {
    const compteurs = [{ fieldName: 'kilometrages', fieldLabel: 'Kilométrages', unit: 'km', sortOrder: 0 }];
    expect(relevesDUneEcriture({ readings: '{oups', mileage: 42 }, compteurs)).toEqual({
      kilometrages: 42,
    });
  });
});

describe('Nature de l’énergie', () => {
  it('reconnaît un matériel électrique, quel que soit le nom du champ', () => {
    expect(natureEnergie({ typeCarburant: 'Électrique' })).toBe('electric');
    expect(natureEnergie({ 'Type de carburant': 'electrique' })).toBe('electric');
    expect(natureEnergie({ energie: 'ÉLECTRIQUE' })).toBe('electric');
  });

  it('reconnaît un hybride rechargeable, qui fait les deux', () => {
    expect(natureEnergie({ typeCarburant: 'Hybride rechargeable' })).toBe('both');
  });

  it('retombe sur le thermique sans indication', () => {
    // Le parc existant l'est presque entièrement : présenter des kWh à un
    // camion benne serait un contresens plus visible que l'inverse.
    expect(natureEnergie({})).toBe('fuel');
    expect(natureEnergie(null)).toBe('fuel');
    expect(natureEnergie({ typeCarburant: 'Diesel' })).toBe('fuel');
  });

  it('rend le libellé saisi, pour le reporter sur l’écriture', () => {
    expect(valeurEnergie({ typeCarburant: '  Diesel  ' })).toBe('Diesel');
    expect(valeurEnergie({ typeCarburant: '   ' })).toBeNull();
  });

  it('laisse le formulaire trancher, sinon suit le matériel', () => {
    expect(natureEcriture('electric', { typeCarburant: 'Diesel' })).toBe('electric');
    expect(natureEcriture(undefined, { typeCarburant: 'Électrique' })).toBe('electric');
    // Un hybride sans précision saisit un plein : le geste le plus fréquent.
    expect(natureEcriture(undefined, { typeCarburant: 'Hybride rechargeable' })).toBe('fuel');
  });
});
