/**
 * Vocabulaire commun du plan annoté.
 *
 * Le plan se lit en **pourcentages** de l'image, jamais en pixels : une même
 * annotation doit retomber au même endroit qu'on l'affiche à l'écran, dans un
 * PDF paysage ou dans une archive dont le plan a été remplacé depuis. Les
 * coordonnées vont donc de 0 à 100 sur chaque axe, indépendamment du zoom.
 */

/** Un point du plan, en pourcentage de la largeur (x) et de la hauteur (y). */
export interface PointPlan {
  x: number
  y: number
}

/**
 * Ce qui permet de traduire le plan en mètres.
 *
 * `metresParPourcent` est la longueur réelle d'un pourcent de **largeur**.
 * Un pourcent de hauteur ne mesure pas la même chose : l'image n'est pas carrée
 * et l'overlay SVG l'étire (`preserveAspectRatio="none"`). `ratio` — hauteur
 * naturelle divisée par largeur naturelle — rétablit la métrique sans avoir à
 * recharger l'image, ce que ni le serveur ni l'export PDF ne peuvent faire.
 */
export interface EchellePlan {
  metresParPourcent: number
  ratio: number
}

/** Le segment de calibrage, conservé pour pouvoir corriger plutôt que refaire. */
export interface CalibragePlan {
  a: PointPlan
  b: PointPlan
  metres: number
}

/** L'outil actif de la barre du plan. */
export type OutilPlan = 'main' | 'repere' | 'zone' | 'mesure'

/** Ce qui est sélectionné sur le plan, tous types de marqueurs confondus. */
export interface SelectionPlan {
  type: 'element' | 'group' | 'annotation'
  id: number
}
