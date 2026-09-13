import type { Migration } from './types';

/**
 * Un lien de téléchargement de sauvegarde survit au redémarrage.
 *
 * Quand une sauvegarde dépasse la limite de pièce jointe, l'application
 * n'envoie plus le fichier mais un lien, annoncé pour sept jours. Ces liens
 * vivaient dans une `Map` en mémoire : le premier redémarrage du serveur —
 * une mise à jour, un correctif, un reboot de la machine — les effaçait tous.
 * L'administrateur recevait un courriel dont le lien ne menait nulle part, et
 * le message d'accueil parlait de lien « invalide ou expiré », ce qui n'était
 * ni l'un ni l'autre.
 *
 * Le jeton est stocké tel quel. Ce n'est pas un mot de passe mais un
 * identifiant à usage unique, tiré au hasard, qui expire et que l'on doit
 * pouvoir retrouver depuis l'URL reçue : le hacher interdirait la recherche
 * sans rien protéger de plus, l'accès au fichier de base valant déjà accès aux
 * sauvegardes elles-mêmes.
 *
 * `ON DELETE CASCADE` : une sauvegarde supprimée emporte les liens qui la
 * désignaient, plutôt que de laisser des jetons pointer dans le vide.
 */
const liensSauvegarde: Migration = {
  id: '021_liens_sauvegarde',
  description: 'Les liens de téléchargement de sauvegarde sont conservés en base',

  async up(ctx) {
    const { horodatageParDefaut } = ctx;

    await ctx.executer(`
      CREATE TABLE IF NOT EXISTS backup_download_tokens (
        token VARCHAR(64) PRIMARY KEY,
        backup_id INTEGER NOT NULL,
        expires_at DATETIME NOT NULL,
        created_by VARCHAR(255) DEFAULT '',
        created_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (backup_id) REFERENCES backups(id) ON DELETE CASCADE
      )
    `);

    // Le ménage des jetons périmés balaie par date : c'est la seule lecture
    // qui ne passe pas par la clé primaire.
    await ctx.executer(
      'CREATE INDEX IF NOT EXISTS idx_backup_tokens_expires ON backup_download_tokens (expires_at)'
    );
  },
};

export default liensSauvegarde;
