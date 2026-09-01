import { db } from '../database';

/**
 * Compteurs relevables d'un matériel, et nature de l'énergie qu'il consomme.
 *
 * Deux notions qui n'existaient nulle part et qui étaient donc devinées à
 * chaque endroit qui en avait besoin — le modal de plein supposait des
 * kilomètres, celui d'entretien aussi, la fiche lisait une clé `kilometrage`
 * écrite en dur, et l'onglet Carburant parlait de litres à une voiture
 * électrique. Les quatre suppositions sont remplacées par ce module, seul point
 * qui décide.
 *
 * La règle du relevé tient en une phrase : **un compteur ne recule pas**. Une
 * valeur inférieure à celle en fiche est conservée sur l'écriture — c'est une
 * saisie de rattrapage légitime, une facture d'il y a trois semaines — mais
 * elle ne rabaisse pas la fiche, et l'appelant est informé pour pouvoir le
 * dire à l'agent plutôt que de le laisser croire que sa saisie a été perdue.
 */

/** Un compteur déclaré sur une catégorie ou une sous-catégorie. */
export interface Compteur {
  /** Clé dans `objects.custom_fields` — « kilometrage », « heuresMoteur ». */
  fieldName: string;
  /** Libellé affiché — « Kilométrage », « Heures moteur ». */
  fieldLabel: string;
  /** Unité affichée à côté de la valeur — « km », « h », « kWh ». */
  unit: string;
  sortOrder: number;
}

/** Un compteur accompagné de la valeur portée aujourd'hui par la fiche. */
export interface CompteurAvecValeur extends Compteur {
  /** Dernière valeur retenue, ou `null` si le compteur n'a jamais été relevé. */
  value: number | null;
}

/** Ce qu'a produit l'application d'un jeu de relevés. */
export interface ResultatReleves {
  /** Compteurs effectivement remontés, avec leur nouvelle valeur. */
  retenus: Array<{ fieldName: string; fieldLabel: string; unit: string; value: number }>;
  /**
   * Relevés conservés sur l'écriture mais refusés par la fiche parce
   * qu'inférieurs ou égaux à la valeur déjà enregistrée.
   */
  ignores: Array<{
    fieldName: string;
    fieldLabel: string;
    unit: string;
    value: number;
    valeurEnFiche: number;
  }>;
}

/** Nature de l'énergie consommée par un matériel. */
export type NatureEnergie = 'fuel' | 'electric' | 'both';

/**
 * Noms de champ acceptés pour porter le type d'énergie.
 *
 * La liste est longue parce qu'elle l'était déjà : la route carburant cherchait
 * cinq orthographes pour deviner un type de carburant. Les regrouper ici évite
 * qu'une sixième apparaisse ailleurs.
 */
const CHAMPS_ENERGIE = [
  'typeEnergie',
  'type_energie',
  'energie',
  'energyType',
  'energy_type',
  "Type d'énergie",
  'fuelType',
  'fuel_type',
  'typeCarburant',
  'type_carburant',
  'carburant',
  'Type de carburant',
];

/**
 * Valeurs d'un champ d'énergie qui désignent de l'électrique.
 *
 * La comparaison se fait sur une forme sans accent : la liste déroulante d'une
 * catégorie propose « Électrique », et un motif `/electr/i` ne reconnaît pas le
 * « É ». Le véhicule serait alors resté en litres, ce que la modale de saisie
 * n'aurait pas démenti.
 */
const MOTIF_ELECTRIQUE = /electr/i;
/** Valeurs qui désignent un matériel consommant les deux. */
const MOTIF_HYBRIDE = /hybrid/i;

/**
 * Compteurs applicables à un matériel.
 *
 * Reprend la règle de résolution des champs personnalisés — la sous-catégorie
 * l'emporte sur la catégorie — pour qu'un compteur se configure exactement là
 * où se configurent les champs qu'il accompagne. Un matériel dont la branche ne
 * déclare aucun compteur en reçoit zéro, et c'est ce qui fait disparaître le
 * champ « Kilométrage » de l'entretien d'une tondeuse ou d'une table.
 */
export async function compteursDuMateriel(objectId: number | string): Promise<Compteur[]> {
  const objet = await db.queryOne(
    `SELECT o.category_id, o.subcategory_id,
            COALESCE(o.category_id, s.category_id) AS resolved_category_id
     FROM objects o
     LEFT JOIN subcategories s ON s.id = o.subcategory_id
     WHERE o.id = ?`,
    [objectId]
  );

  if (!objet) return [];

  let configs: any[] = [];

  if (objet.subcategory_id) {
    configs = await db.query(
      `SELECT * FROM custom_fields_config
       WHERE subcategory_id = ? AND is_counter = 1
       ORDER BY sort_order, field_label`,
      [objet.subcategory_id]
    );
  }

  // Une sous-catégorie sans configuration propre hérite de sa catégorie. On
  // vérifie l'absence de *toute* configuration, et non l'absence de compteur :
  // une sous-catégorie qui a sa propre config sans compteur en veut zéro, elle
  // ne veut pas récupérer ceux du parent.
  if (configs.length === 0 && objet.subcategory_id) {
    const propre = await db.queryOne(
      `SELECT COUNT(*) AS total FROM custom_fields_config WHERE subcategory_id = ?`,
      [objet.subcategory_id]
    );
    if (Number(propre?.total ?? 0) > 0) return [];
  }

  if (configs.length === 0 && objet.resolved_category_id) {
    configs = await db.query(
      `SELECT * FROM custom_fields_config
       WHERE category_id = ? AND subcategory_id IS NULL AND is_counter = 1
       ORDER BY sort_order, field_label`,
      [objet.resolved_category_id]
    );
  }

  return configs
    .filter((c: any) => estApplicable(c, objet.subcategory_id))
    .map((c: any) => ({
      fieldName: c.field_name,
      fieldLabel: c.field_label,
      unit: c.counter_unit || '',
      sortOrder: c.sort_order ?? 0,
    }));
}

/** Compteurs d'un matériel accompagnés de la valeur portée par sa fiche. */
export async function compteursAvecValeurs(
  objectId: number | string
): Promise<CompteurAvecValeur[]> {
  const compteurs = await compteursDuMateriel(objectId);
  if (compteurs.length === 0) return [];

  const objet = await db.queryOne('SELECT custom_fields FROM objects WHERE id = ?', [objectId]);
  const champs = lireChampsPersonnalises(objet?.custom_fields);

  return compteurs.map((c) => ({ ...c, value: versNombre(champs[c.fieldName]) }));
}

/**
 * Reporte des relevés sur la fiche du matériel, sans jamais la faire reculer.
 *
 * Le report se fait ici, côté serveur, et non plus dans la page : un plein
 * saisi hors réseau et rejoué plus tard, importé par fichier ou poussé par
 * jeton d'API mettait jusqu'ici la fiche à jour uniquement si l'agent avait la
 * page ouverte au bon moment.
 */
export async function appliquerReleves(
  objectId: number | string,
  releves: Record<string, unknown> | null | undefined
): Promise<ResultatReleves> {
  const resultat: ResultatReleves = { retenus: [], ignores: [] };
  if (!releves || typeof releves !== 'object') return resultat;

  const compteurs = await compteursDuMateriel(objectId);
  if (compteurs.length === 0) return resultat;

  const objet = await db.queryOne('SELECT custom_fields FROM objects WHERE id = ?', [objectId]);
  if (!objet) return resultat;

  const champs = lireChampsPersonnalises(objet.custom_fields);
  let modifie = false;

  for (const compteur of compteurs) {
    const saisi = versNombre(releves[compteur.fieldName]);
    if (saisi === null) continue;

    const actuel = versNombre(champs[compteur.fieldName]);

    if (actuel !== null && saisi <= actuel) {
      resultat.ignores.push({
        fieldName: compteur.fieldName,
        fieldLabel: compteur.fieldLabel,
        unit: compteur.unit,
        value: saisi,
        valeurEnFiche: actuel,
      });
      continue;
    }

    champs[compteur.fieldName] = saisi;
    modifie = true;
    resultat.retenus.push({
      fieldName: compteur.fieldName,
      fieldLabel: compteur.fieldLabel,
      unit: compteur.unit,
      value: saisi,
    });
  }

  if (modifie) {
    await db.execute('UPDATE objects SET custom_fields = ? WHERE id = ?', [
      JSON.stringify(champs),
      objectId,
    ]);
  }

  return resultat;
}

/**
 * Relevés à enregistrer sur une écriture, et valeur du compteur principal.
 *
 * `mileage` reste alimentée parce qu'elle est lue ailleurs — module Suivi,
 * exports, modèle d'e-mail de rappel d'entretien. Le compteur principal est le
 * premier dans l'ordre d'affichage : sur une catégorie qui n'en déclare qu'un,
 * c'est celui-là ; sur un tracteur qui compte kilomètres et heures, c'est celui
 * que le superviseur a placé en tête.
 */
export async function relevesPourEcriture(
  objectId: number | string,
  releves: Record<string, unknown> | null | undefined,
  mileageHerite?: unknown
): Promise<{ readings: string | null; mileage: number | null; valeurs: Record<string, number> }> {
  const compteurs = await compteursDuMateriel(objectId);

  // Aucun compteur déclaré : on retombe sur le kilométrage éventuellement
  // transmis par un client ancien ou par l'API, sans rien inventer.
  if (compteurs.length === 0) {
    return { readings: null, mileage: versNombre(mileageHerite), valeurs: {} };
  }

  const retenus: Record<string, number> = {};
  for (const compteur of compteurs) {
    const valeur = versNombre(releves?.[compteur.fieldName]);
    if (valeur !== null) retenus[compteur.fieldName] = valeur;
  }

  // Un client qui ne connaît pas encore les compteurs envoie `mileage` seul :
  // on le range sur le compteur principal plutôt que de le perdre.
  const principal = compteurs[0];
  if (retenus[principal.fieldName] === undefined) {
    const herite = versNombre(mileageHerite);
    if (herite !== null) retenus[principal.fieldName] = herite;
  }

  const aucun = Object.keys(retenus).length === 0;
  return {
    readings: aucun ? null : JSON.stringify(retenus),
    mileage: retenus[principal.fieldName] ?? null,
    valeurs: retenus,
  };
}

/**
 * Relevés portés par une écriture lue en base.
 *
 * Les écritures antérieures à cette version n'ont pas de `readings` : leur
 * `mileage` est présenté comme le relevé du compteur principal, ce qui évite
 * une reprise de données et garde l'historique lisible.
 */
export function relevesDUneEcriture(
  ligne: { readings?: string | null; mileage?: number | null },
  compteurs: Compteur[]
): Record<string, number> {
  if (ligne.readings) {
    try {
      const brut = JSON.parse(ligne.readings);
      if (brut && typeof brut === 'object') {
        const propre: Record<string, number> = {};
        for (const [cle, valeur] of Object.entries(brut)) {
          const nombre = versNombre(valeur);
          if (nombre !== null) propre[cle] = nombre;
        }
        return propre;
      }
    } catch {
      // Un JSON illisible ne doit pas faire échouer l'affichage de la fiche :
      // on retombe sur le kilométrage, qui est resté écrit à côté.
    }
  }

  const kilometrage = versNombre(ligne.mileage);
  if (kilometrage === null || compteurs.length === 0) return {};
  return { [compteurs[0].fieldName]: kilometrage };
}

/**
 * Nature de l'énergie consommée par un matériel.
 *
 * Lue sur ses champs personnalisés. Sans indication, c'est du thermique : le
 * parc existant l'est presque entièrement, et présenter des kWh à un camion
 * benne serait un contresens plus visible que l'inverse.
 */
export function natureEnergie(champsPersonnalises: Record<string, any> | null | undefined): NatureEnergie {
  const valeur = valeurEnergie(champsPersonnalises);
  if (!valeur) return 'fuel';
  const compare = sansAccent(valeur);
  if (MOTIF_HYBRIDE.test(compare)) return 'both';
  if (MOTIF_ELECTRIQUE.test(compare)) return 'electric';
  return 'fuel';
}

/** Forme comparable d'un libellé saisi : « Électrique » devient « Electrique ». */
function sansAccent(valeur: string): string {
  return valeur.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Valeur brute du champ d'énergie, telle que saisie — « Électrique », « Diesel ». */
export function valeurEnergie(
  champsPersonnalises: Record<string, any> | null | undefined
): string | null {
  if (!champsPersonnalises) return null;
  for (const nom of CHAMPS_ENERGIE) {
    const valeur = champsPersonnalises[nom];
    if (typeof valeur === 'string' && valeur.trim() !== '') return valeur.trim();
  }
  return null;
}

/** Nature d'une écriture d'énergie : ce qui est demandé, sinon celle du matériel. */
export function natureEcriture(
  demandee: unknown,
  champsPersonnalises: Record<string, any> | null | undefined
): 'fuel' | 'electric' {
  if (demandee === 'electric' || demandee === 'fuel') return demandee;
  // Un hybride saisit les deux : sans précision, on retient le carburant, qui
  // est le geste le plus fréquent sur ces véhicules.
  return natureEnergie(champsPersonnalises) === 'electric' ? 'electric' : 'fuel';
}

/** `custom_fields` d'un matériel, toujours rendu sous forme d'objet. */
export function lireChampsPersonnalises(brut: unknown): Record<string, any> {
  if (!brut) return {};
  if (typeof brut === 'object') return { ...(brut as Record<string, any>) };
  try {
    const analyse = JSON.parse(String(brut));
    return analyse && typeof analyse === 'object' ? analyse : {};
  } catch {
    return {};
  }
}

/**
 * Nombre exploitable, ou `null`.
 *
 * Tolère la virgule décimale : sur un téléphone français, le pavé numérique
 * propose une virgule et l'agent la tape.
 */
function versNombre(valeur: unknown): number | null {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  const nombre =
    typeof valeur === 'number' ? valeur : Number(String(valeur).replace(',', '.').trim());
  return Number.isFinite(nombre) ? nombre : null;
}

/** Un champ restreint à certaines sous-catégories s'applique-t-il à ce matériel ? */
function estApplicable(config: any, subcategoryId: number | null): boolean {
  if (!config.applicable_subcategories) return true;
  try {
    const applicables = JSON.parse(config.applicable_subcategories);
    if (!Array.isArray(applicables) || applicables.length === 0) return true;
    return subcategoryId !== null && applicables.includes(subcategoryId);
  } catch {
    return true;
  }
}
