import path from 'path';

/**
 * Résout un chemin et refuse celui qui sort de sa racine.
 *
 * Deux routes construisaient un chemin de fichier à partir d'une valeur venue
 * de la requête, puis appelaient `fs.unlinkSync` dessus :
 *
 *   DELETE /api/upload/:filename   `..%2Fdata%2Fdatabase.sqlite` remontait hors
 *                                  du dossier des uploads. Réservé au
 *                                  superviseur — c'est-à-dire à l'agent qui
 *                                  gère le parc, pas à un administrateur
 *                                  système.
 *
 *   DELETE /api/auth/avatar        supprimait le fichier désigné par le champ
 *                                  `avatar` du compte, que `PUT /api/auth/profile`
 *                                  recopiait tel quel depuis le corps de la
 *                                  requête. Aucune remontée n'était même
 *                                  nécessaire : le chemin étant joint à la
 *                                  racine du projet, `data/database.sqlite`
 *                                  suffisait, et un compte en consultation
 *                                  seule y parvenait.
 *
 * `path.resolve` normalise `..`, les séparateurs des deux familles et les
 * chemins absolus : `resoudreSous(racine, '/etc/passwd')` ressort hors de la
 * racine et se fait donc refuser. La comparaison porte sur le résultat résolu,
 * seule forme sur laquelle une inclusion se vérifie honnêtement — et le
 * séparateur ajouté à la racine évite qu'un dossier voisin nommé
 * `uploads-anciens` passe pour un enfant de `uploads`.
 *
 * Rend le chemin absolu si la cible est bien contenue, `null` sinon. La racine
 * elle-même est refusée : on ne supprime pas un dossier par cette voie.
 */
export function resoudreSous(racine: string, chemin: unknown): string | null {
  if (typeof chemin !== 'string' || chemin.trim() === '') return null;

  const base = path.resolve(racine);
  const cible = path.resolve(base, chemin);

  return cible.startsWith(base + path.sep) ? cible : null;
}

export default resoudreSous;
