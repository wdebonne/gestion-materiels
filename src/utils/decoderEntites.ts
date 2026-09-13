/**
 * Rend leur forme lisible aux textes échappés en HTML.
 *
 * Snipe-IT est une application Laravel, dont l'API renvoie les champs tels
 * qu'ils sont stockés — c'est-à-dire déjà échappés pour un affichage dans une
 * page web. Une barrière nommée « Rad'o » arrive donc en « Rad&#039;o », et un
 * « Atelier & garage » en « Atelier &amp; garage ».
 *
 * Recopié tel quel dans le parc, ce texte ne redevient jamais lisible : notre
 * interface, elle, échappe à l'affichage, si bien que l'utilisateur voit
 * l'entité en clair sur la fiche, sur l'étiquette imprimée et dans le référentiel
 * des lieux. Le décodage doit donc se faire à l'entrée, une fois, au moment où
 * la donnée franchit la frontière entre les deux applications.
 *
 * Rien ici ne rend du HTML : la fonction *retire* un échappement, elle n'en
 * introduit pas. Le résultat est du texte brut, qui repart dans la base et sera
 * échappé normalement par React au moment de l'affichage.
 */

const NOMMEES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  ocirc: 'ô',
  ugrave: 'ù',
};

/**
 * Nombre de passes de décodage.
 *
 * Un seul passage ne suffit pas toujours : une donnée saisie dans Snipe-IT à
 * partir d'un copier-coller déjà échappé ressort en `&amp;#039;`, qu'il faut
 * décoder deux fois. La borne évite qu'un texte contenant littéralement
 * « &amp; » ne soit dépiauté indéfiniment.
 */
const PASSES_MAX = 3;

const MOTIF = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;

/**
 * Même motif, sans le drapeau global.
 *
 * `RegExp.test` sur un motif global avance `lastIndex` d'un appel à l'autre et
 * rend donc un résultat différent pour la même chaîne une fois sur deux. Deux
 * objets valent mieux qu'un drapeau remis à zéro à la main.
 */
const MOTIF_UNIQUE = /&(#x[0-9a-f]+|#\d+|[a-z]+);/i;

function unePasse(valeur: string): string {
  return valeur.replace(MOTIF, (entier, corps: string) => {
    const bas = corps.toLowerCase();

    if (bas.startsWith('#x')) {
      const point = Number.parseInt(bas.slice(2), 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entier;
    }

    if (bas.startsWith('#')) {
      const point = Number.parseInt(bas.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entier;
    }

    // Une entité inconnue est laissée telle quelle : mieux vaut un « &copy; »
    // visible qu'un caractère inventé.
    return NOMMEES[bas] ?? entier;
  });
}

/** Texte lisible correspondant à `valeur`, ou `valeur` si rien n'était échappé. */
export function decoderEntites(valeur: string): string {
  let courant = String(valeur ?? '');

  for (let passe = 0; passe < PASSES_MAX; passe += 1) {
    const suivant = unePasse(courant);
    if (suivant === courant) break;
    courant = suivant;
  }

  return courant;
}

/** Variante qui préserve `null` : commode sur un champ facultatif. */
export function decoderEntitesOuNull(valeur: unknown): string | null {
  if (valeur === null || valeur === undefined) return null;
  const decode = decoderEntites(String(valeur)).trim();
  return decode ? decode : null;
}

/** Vrai si le texte porte encore une entité — pour repérer une donnée à réparer. */
export function porteDesEntites(valeur: unknown): boolean {
  return MOTIF_UNIQUE.test(String(valeur ?? ''));
}

export default { decoderEntites, decoderEntitesOuNull, porteDesEntites };
