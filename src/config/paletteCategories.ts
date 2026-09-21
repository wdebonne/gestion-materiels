/**
 * Les huit couleurs des catégories de temps.
 *
 * Une catégorie porte une couleur *stable*, choisie à sa création et rangée en
 * base. C'est ce qui permet à « Livraison Manifestation » d'être du même bleu
 * d'une semaine à l'autre, d'un camembert à un histogramme, et d'un écran à son
 * export PDF. L'alternative — laisser la bibliothèque de graphiques colorer par
 * rang — repeindrait toutes les parts dès qu'un filtre change le nombre de
 * catégories affichées, et personne ne se fie longtemps à un graphique dont les
 * couleurs bougent.
 *
 * La base ne retient donc pas un code hexadécimal mais le **nom d'un
 * emplacement**. Chaque emplacement a deux valeurs, une pour le thème clair et
 * une pour le thème sombre, qui vivent côté client dans
 * `client/src/lib/paletteCategories.ts` — un thème sombre ne s'obtient pas en
 * inversant des couleurs claires, il se choisit.
 *
 * Cet ordre n'est pas décoratif : c'est lui qui garantit que deux parts
 * voisines restent distinguables, y compris pour un daltonien. Il a été vérifié
 * sur les surfaces réelles de l'application — `#ffffff` en clair, `#1f2937` en
 * sombre — et passe les cinq contrôles, avec un écart minimal de 9,1 (clair) et
 * 8,4 (sombre) entre voisins en vision déficiente, pour une cible de 8. Trois
 * teintes claires et une sombre passent sous 3:1 de contraste : c'est pourquoi
 * le camembert porte toujours ses libellés en clair **et** un tableau à côté de
 * lui, jamais la couleur seule. Changer un de ces codes demande de repasser le
 * validateur, pas de juger à l'œil.
 */

export const EMPLACEMENTS_COULEUR = [
  'bleu',
  'orange',
  'aqua',
  'jaune',
  'magenta',
  'vert',
  'violet',
  'rouge',
] as const;

export type EmplacementCouleur = (typeof EMPLACEMENTS_COULEUR)[number];

export function estEmplacementCouleur(valeur: unknown): valeur is EmplacementCouleur {
  return typeof valeur === 'string'
    && (EMPLACEMENTS_COULEUR as readonly string[]).includes(valeur);
}

/**
 * L'emplacement à donner à une nouvelle catégorie.
 *
 * Le moins employé parmi les catégories déjà là, plutôt que le suivant dans
 * l'ordre : supprimer puis recréer une catégorie ne doit pas décaler toutes les
 * suivantes. Tant qu'il y a huit catégories actives ou moins, aucune ne partage
 * sa couleur avec une autre. Au-delà, deux parts d'un même camembert peuvent
 * finir de la même teinte — elles restent identifiables par leur libellé et par
 * la légende, l'identité ne repose jamais sur la couleur seule.
 */
export function emplacementSuivant(dejaPris: readonly string[]): EmplacementCouleur {
  const usages = new Map<EmplacementCouleur, number>(
    EMPLACEMENTS_COULEUR.map((nom) => [nom, 0])
  );

  for (const couleur of dejaPris) {
    if (estEmplacementCouleur(couleur)) {
      usages.set(couleur, (usages.get(couleur) ?? 0) + 1);
    }
  }

  let retenu: EmplacementCouleur = EMPLACEMENTS_COULEUR[0];
  for (const nom of EMPLACEMENTS_COULEUR) {
    if ((usages.get(nom) ?? 0) < (usages.get(retenu) ?? 0)) retenu = nom;
  }
  return retenu;
}
