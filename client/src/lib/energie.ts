/**
 * Vocabulaire du module Énergie, selon ce que consomme le matériel.
 *
 * Le plugin « Carburant » demandait des litres, un prix au litre et une station
 * à tout le monde — y compris à la 208 électrique déjà au parc. Saisir une
 * recharge obligeait à écrire des kWh dans une colonne libellée « L », ce que
 * personne ne fait deux fois : les recharges n'étaient pas saisies du tout, et
 * le coût d'usage du véhicule électrique restait à zéro.
 *
 * Plutôt qu'un second module à brancher partout — onglet, Suivi, exports,
 * alertes, tableau de bord —, le module existant change de vocabulaire selon le
 * champ d'énergie du matériel. L'historique reste unique, et un véhicule qui
 * passe du diesel à l'électrique garde le sien.
 */

/** Ce que consomme un matériel, lu sur son champ d'énergie. */
export type NatureEnergie = 'fuel' | 'electric' | 'both'

/** Nature d'une écriture : un plein, ou une recharge. */
export type NatureEcriture = 'fuel' | 'electric'

/** Les mots et unités d'une nature d'écriture. */
export interface VocabulaireEnergie {
  nature: NatureEcriture
  /** Titre de l'onglet et de l'historique — « Carburant », « Recharges ». */
  onglet: string
  titreHistorique: string
  /** Intitulé du bouton d'ajout. */
  ajouter: string
  /** Unité de la quantité — « L », « kWh ». */
  unite: string
  /** Libellé du champ quantité, unité comprise. */
  labelQuantite: string
  /** En-tête de la colonne de prix unitaire — « Prix/L », « Prix/kWh ». */
  labelPrixUnitaire: string
  /** Suffixe du prix unitaire affiché — « €/L », « €/kWh ». */
  suffixePrixUnitaire: string
  /** Le point de ravitaillement — « Station », « Borne ». */
  labelPoint: string
  /** Formulation du sélecteur de point de ravitaillement. */
  pointSingulier: string
  pointPlaceholder: string
  /** Message quand l'historique est vide. */
  historiqueVide: string
  /** Valeur du paramètre `kind` pour la liste des points de ravitaillement. */
  kind: NatureEcriture
}

const CARBURANT: VocabulaireEnergie = {
  nature: 'fuel',
  onglet: 'Carburant',
  titreHistorique: 'Historique carburant',
  ajouter: 'Ajouter un plein',
  unite: 'L',
  labelQuantite: 'Quantité (L)',
  labelPrixUnitaire: 'Prix/L',
  suffixePrixUnitaire: '€/L',
  labelPoint: 'Station',
  pointSingulier: 'une station',
  pointPlaceholder: 'Choisir une station',
  historiqueVide: 'Aucun enregistrement de carburant',
  kind: 'fuel',
}

const ELECTRIQUE: VocabulaireEnergie = {
  nature: 'electric',
  onglet: 'Recharges',
  titreHistorique: 'Historique des recharges',
  ajouter: 'Ajouter une recharge',
  unite: 'kWh',
  labelQuantite: 'Énergie (kWh)',
  labelPrixUnitaire: 'Prix/kWh',
  suffixePrixUnitaire: '€/kWh',
  labelPoint: 'Borne',
  pointSingulier: 'une borne',
  pointPlaceholder: 'Choisir une borne',
  historiqueVide: 'Aucune recharge enregistrée',
  kind: 'electric',
}

/** Le vocabulaire d'une nature d'écriture. */
export function vocabulaire(nature: NatureEcriture): VocabulaireEnergie {
  return nature === 'electric' ? ELECTRIQUE : CARBURANT
}

/**
 * Nature d'écriture proposée par défaut à un matériel.
 *
 * Un hybride rechargeable fait les deux : on ouvre sur le plein, geste le plus
 * fréquent sur ces véhicules, et le formulaire laisse basculer.
 */
export function natureParDefaut(nature: NatureEnergie | undefined): NatureEcriture {
  return nature === 'electric' ? 'electric' : 'fuel'
}

/** Titre de l'onglet, qui doit couvrir les deux natures pour un hybride. */
export function libelleOnglet(nature: NatureEnergie | undefined): string {
  if (nature === 'electric') return ELECTRIQUE.onglet
  if (nature === 'both') return 'Énergie'
  return CARBURANT.onglet
}
