import type { Migration } from './types';

/**
 * Des passkeys pour se connecter, au lieu d'un mot de passe recopié.
 *
 * L'écran Paramètres > Authentification proposait déjà d'activer les passkeys,
 * de choisir le type d'authentificateur et le mode d'emploi — principal ou
 * second facteur. Rien ne relisait cette configuration : la connexion restait
 * en bcrypt local, et l'écran portait un bandeau le disant. Cette migration
 * pose ce qu'il manquait pour que ces réglages fassent enfin quelque chose.
 *
 * Deux tables, et pas une colonne de plus sur `users` :
 *
 *   `user_passkeys`      les clés publiques enregistrées par les agents. Une
 *                        personne en a plusieurs — le téléphone de service, le
 *                        poste de l'atelier, une clé USB dans le coffre — et
 *                        perdre l'une d'elles ne doit pas couper les autres.
 *   `passkey_challenges` les défis en cours.
 *
 * Le défi tient en base plutôt qu'en mémoire du serveur. Il est émis par une
 * requête et vérifié par la suivante : gardé dans une variable de processus, il
 * disparaîtrait au redémarrage — une reconnexion en pleine mise à jour
 * échouerait sans raison lisible — et deux instances derrière le même nginx ne
 * verraient pas les mêmes défis. Une ligne éphémère, portant sa date de
 * péremption, coûte moins cher que ces deux pannes-là.
 *
 * Ce qui est stocké n'est jamais un secret. Une passkey laisse la clé privée
 * dans le téléphone ou la clé USB, et ne confie au serveur que la clé publique :
 * la table peut fuiter sans que personne ne puisse se connecter avec. C'est
 * précisément ce qu'on ne peut pas dire d'une table de mots de passe, même
 * hachés.
 *
 * `counter` est le compteur d'usage remonté par l'authentificateur. Il ne sert
 * qu'à repérer un clone : une clé qui rejoue un compteur déjà vu est refusée.
 * Les authentificateurs modernes — Touch ID, Windows Hello, les passkeys
 * synchronisées — renvoient zéro en permanence, et zéro n'accuse personne.
 */
const passkeys: Migration = {
  id: '027_passkeys',
  description: 'Passkeys (WebAuthn) : clés publiques enregistrées et défis en cours',

  async up(ctx) {
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS user_passkeys (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        user_id INTEGER NOT NULL,
        credential_id VARCHAR(255) NOT NULL UNIQUE,
        public_key ${ctx.texteLong} NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        transports VARCHAR(255),
        device_type VARCHAR(32),
        backed_up ${ctx.booleen} DEFAULT 0,
        aaguid VARCHAR(64),
        name VARCHAR(120),
        created_at DATETIME ${ctx.horodatageParDefaut},
        last_used_at DATETIME
      )`
    );

    await ctx.creerIndex('idx_user_passkeys_user', 'user_passkeys', 'user_id');

    /*
     * `purpose` distingue un défi d'enregistrement d'un défi de connexion. Sans
     * lui, un défi obtenu sur l'écran « ajouter une passkey » — donc déjà
     * authentifié — pourrait être présenté à la route de connexion, et
     * inversement. Les deux routes n'exigent pas la même chose : la seconde
     * délivre une session.
     *
     * Le mot `usage` aurait été plus juste en français, mais c'est un mot
     * réservé de MySQL : la table se serait créée sur SQLite et aurait arrêté
     * le serveur en production.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS passkey_challenges (
        id INTEGER PRIMARY KEY ${ctx.autoIncrement},
        challenge VARCHAR(255) NOT NULL UNIQUE,
        user_id INTEGER,
        purpose VARCHAR(32) NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME ${ctx.horodatageParDefaut}
      )`
    );

    // Les défis périmés sont balayés à chaque émission : l'index évite que ce
    // ménage ne devienne un parcours de table complet.
    await ctx.creerIndex('idx_passkey_challenges_expires', 'passkey_challenges', 'expires_at');
  },
};

export default passkeys;
