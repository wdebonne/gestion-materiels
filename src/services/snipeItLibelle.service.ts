/**
 * Ce qu'une clé ouvre, lu dans son libellé.
 *
 * Snipe-IT n'a pas la notion de lieu ouvert par une clé, et ses composants
 * n'acceptent pas de champ personnalisé : l'information n'existe chez lui que
 * dans le nom, écrit à la main par des agents successifs. « Clé Mairie – Porte
 * principale », « Passe général écoles », « BADGE mairie / salle du conseil ».
 *
 * Ce module propose une lecture, il ne décide pas. Le résultat porte une
 * `confiance`, et l'écran fait valider avant d'écrire : un rattachement faux
 * n'est pas une donnée approximative, c'est quelqu'un qui cherche la mauvaise
 * porte un dimanche soir. Deviner est acceptable, écrire en aveugle ne l'est
 * pas.
 *
 * Rien ici ne touche la base : la lecture est une fonction pure, ce qui la rend
 * vérifiable sur les libellés réels d'une commune sans rien importer.
 */

export interface LectureLibelle {
  /** Site déduit, s'il a pu l'être. */
  site?: string;
  /** Ouvrant déduit. Absent pour un passe, qui vaut pour tout le site. */
  ouvrant?: string;
  /** La clé ouvre tout le site plutôt qu'une porte. */
  estPasse: boolean;
  /**
   * `sure`    deux parties séparées explicitement, ou un passe nommé ;
   * `probable` une seule partie : c'est sans doute un site, mais rien ne le dit ;
   * `aucune`  il ne reste rien d'exploitable — à saisir à la main.
   */
  confiance: 'sure' | 'probable' | 'aucune';
  /** Ce qui restait après retrait du préfixe, pour affichage dans l'écran. */
  reste: string;
}

/**
 * Séparateurs rencontrés dans un parc réel.
 *
 * Le tiret court entouré d'espaces seulement : « Jean-Jacques Rousseau » est un
 * nom d'école, pas une séparation. Le tiret cadratin et le demi-cadratin, eux,
 * ne servent jamais à l'intérieur d'un mot.
 */
const SEPARATEURS = /\s+[–—]\s+|\s+-\s+|\s*[\/>:|]\s*/;

/** Ce qui désigne la nature de l'objet et non le lieu : on le retire. */
const PREFIXES = [
  'cles', 'cle', 'clef', 'clefs', 'badge', 'badges', 'jeton', 'jetons',
  'telecommande', 'telecommandes', 'bip', 'bips', 'carte', 'cartes',
];

/** Ce qui annonce un passe. « PTT » est le passe pompiers/services, courant en commune. */
const MOTS_PASSE = ['passe', 'pass', 'passepartout', 'ptt', 'general', 'generale', 'maitresse', 'mere'];

/** Sans accent, sans casse, sans ponctuation de bord — pour comparer, jamais pour afficher. */
function normaliser(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Retire les mots de tête qui nomment la nature de l'objet, pas le lieu. */
function retirerPrefixes(morceau: string): { reste: string; passe: boolean } {
  let mots = morceau.trim().split(/\s+/);
  let passe = false;

  // Boucle plutôt qu'un seul passage : « Clé passe Mairie » enchaîne les deux.
  let encore = true;
  while (encore && mots.length > 0) {
    encore = false;
    const tete = normaliser(mots[0]);

    if (PREFIXES.includes(tete)) {
      mots = mots.slice(1);
      encore = true;
      continue;
    }
    if (MOTS_PASSE.includes(tete)) {
      passe = true;
      mots = mots.slice(1);
      encore = true;
    }
  }

  // « Passe général » : le second mot qualifie le premier, il ne nomme pas le site.
  if (passe && mots.length > 1 && MOTS_PASSE.includes(normaliser(mots[0]))) {
    mots = mots.slice(1);
  }

  return { reste: mots.join(' ').trim(), passe };
}

/**
 * Lit un libellé Snipe-IT et propose un rattachement.
 *
 * Ne renvoie jamais d'exception : un libellé vide ou incompréhensible rend
 * `confiance: 'aucune'`, que l'écran présente comme « à saisir ». Un import de
 * deux cents clés ne doit pas s'arrêter sur le libellé le plus mal tenu.
 */
export function lireLibelle(libelle: string): LectureLibelle {
  const brut = String(libelle ?? '').trim();
  if (!brut) return { estPasse: false, confiance: 'aucune', reste: '' };

  const morceaux = brut.split(SEPARATEURS).map((m) => m.trim()).filter(Boolean);

  // Une seule partie : « Passe Mairie », ou « Clé local technique ».
  if (morceaux.length === 1) {
    const { reste, passe } = retirerPrefixes(morceaux[0]);
    if (!reste) return { estPasse: passe, confiance: 'aucune', reste: '' };

    return {
      site: reste,
      estPasse: passe,
      // Un passe se nomme par son site : la lecture est sûre. Sans le mot
      // « passe », rien ne dit si « Local technique » est un bâtiment ou une
      // porte dans un bâtiment tu.
      confiance: passe ? 'sure' : 'probable',
      reste,
    };
  }

  const { reste: tete, passe } = retirerPrefixes(morceaux[0]);
  const queue = morceaux.slice(1).join(' – ').trim();

  // « Centre de loisirs – Pass » : la seconde partie ne nomme pas une porte,
  // elle dit que la clé ouvre tout. Sans ce cas, le référentiel se retrouvait
  // avec un ouvrant littéralement appelé « Pass » sous chaque bâtiment, et la
  // clé ne passait plus que par lui.
  const { reste: apresQueue, passe: queueEstPasse } = retirerPrefixes(queue);
  if (tete && queueEstPasse && !apresQueue) {
    return { site: tete, estPasse: true, confiance: 'sure', reste: brut };
  }

  // « Clé – Porte principale » : le préfixe a tout mangé, la tête est vide.
  // La suite est alors le seul candidat, et on ne sait pas de quel site.
  if (!tete) {
    return { ouvrant: queue, estPasse: false, confiance: 'probable', reste: queue };
  }

  // « Passe Mairie – bâtiment A » : un passe reste un passe, la précision
  // tombe dans le nom du site plutôt que d'inventer une porte qu'il n'ouvre
  // pas spécifiquement.
  if (passe) {
    return { site: `${tete} ${queue}`.trim(), estPasse: true, confiance: 'sure', reste: brut };
  }

  return { site: tete, ouvrant: queue, estPasse: false, confiance: 'sure', reste: brut };
}

/**
 * Regroupe des libellés déjà lus sous des sites distincts.
 *
 * Le rapprochement se fait sur la forme normalisée : « Ecole J. Ferry » et
 * « école J.Ferry » sont le même bâtiment, et les importer séparément
 * donnerait deux sites que personne ne penserait à fusionner ensuite. Le nom
 * retenu est le premier rencontré — arbitraire, mais il reste modifiable dans
 * le référentiel, et c'est moins coûteux qu'un doublon silencieux.
 */
export function regrouperSites(lectures: LectureLibelle[]): Map<string, string> {
  const parCle = new Map<string, string>();

  for (const lecture of lectures) {
    if (!lecture.site) continue;
    const cle = normaliser(lecture.site);
    if (cle && !parCle.has(cle)) parCle.set(cle, lecture.site);
  }

  return parCle;
}

/** Clé de rapprochement d'un nom de site, pour retrouver un site déjà posé. */
export function cleDeSite(nom: string): string {
  return normaliser(nom);
}

export default { lireLibelle, regrouperSites, cleDeSite };
