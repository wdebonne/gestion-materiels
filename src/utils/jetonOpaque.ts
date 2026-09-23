import crypto from 'crypto';

/**
 * Alphabet sans caractère ambigu : ni `O`/`0`, ni `I`/`1`, ni `L`.
 *
 * Né pour l'étiquette d'un trousseau, que quelqu'un recopiera un jour à la main
 * parce que le QR sera rayé : un `0` lu `O` renvoie alors vers rien. La
 * contrainte ne coûte rien aux autres usages, et leur épargne la même déconvenue
 * le jour où une URL est dictée au téléphone.
 */
export const ALPHABET_JETON = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Longueur par défaut : 8 caractères sur 31 symboles, soit ~40 bits.
 *
 * C'est la taille de l'étiquette qui la fixe. Sur une Avery L6008 de dix
 * millimètres de haut, `pavilly.fr/t/A7K9M2` reste lisible là où une adresse
 * plus longue rendrait le QR trop dense.
 *
 * **Un jeton qu'on ne passe pas par une étiquette n'a pas cette contrainte, et
 * ne doit pas en hériter.** Une URL d'abonnement à un agenda se copie-colle :
 * elle peut être bien plus longue, et doit l'être, puisqu'elle ouvre un flux de
 * données plutôt qu'une page qui ne dit presque rien. D'où le paramètre.
 */
export const LONGUEUR_JETON = 8;

/**
 * Tire un jeton court et imprévisible.
 *
 * Le rejet des valeurs au-delà du plus grand multiple de l'alphabet évite le
 * biais qu'introduirait un simple modulo : sans lui les premières lettres
 * sortiraient un peu plus souvent, ce qui réduit l'entropie réelle.
 *
 * Vivait dans `cles.service.ts`, d'où il servait les étiquettes de trousseaux.
 * Déplacé ici quand les agendas de lieu ont eu besoin du même tirage : deux
 * copies auraient divergé sur l'alphabet ou sur le rejet, et la seconde aurait
 * perdu en silence la propriété qui compte.
 */
export function tirerJeton(longueur: number = LONGUEUR_JETON): string {
  const limite = Math.floor(256 / ALPHABET_JETON.length) * ALPHABET_JETON.length;
  let jeton = '';

  while (jeton.length < longueur) {
    for (const octet of crypto.randomBytes(longueur * 2)) {
      if (octet >= limite) continue;
      jeton += ALPHABET_JETON[octet % ALPHABET_JETON.length];
      if (jeton.length === longueur) break;
    }
  }

  return jeton;
}
