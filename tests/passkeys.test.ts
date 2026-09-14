import type BetterSqlite3 from 'better-sqlite3';

/**
 * Passkeys : configuration, identité du site, défis et clés enregistrées.
 *
 * La cryptographie est celle de `@simplewebauthn/server` et n'a pas à être
 * réécrite ici. Ce qui l'entoure, si : c'est là que se logent les défauts qui
 * ne se voient pas.
 *
 *   **l'identité du site** — une clé enregistrée sous le mauvais domaine ne se
 *   représentera jamais, et l'erreur n'apparaît qu'à la reconnexion suivante,
 *   quand il est trop tard pour comprendre d'où elle vient ;
 *
 *   **le défi à usage unique** — un défi qui survivrait à sa vérification
 *   rendrait une signature interceptée rejouable, et rien ne le signalerait :
 *   la connexion continuerait de fonctionner, exactement comme avant ;
 *
 *   **la configuration mal formée** — une valeur inconnue ne doit jamais
 *   revenir à « aucune exigence », suivant la règle déjà posée pour la
 *   politique de mot de passe.
 *
 * Les défis tournent sur une vraie base SQLite en mémoire : la péremption et
 * l'effacement sont précisément ce qu'une base simulée ne vérifierait pas.
 */

jest.mock('../src/database', () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  (global as any).__basePasskeys = sqlite;

  return {
    db: {
      getType: () => 'sqlite',
      async query(requete: string, params: any[] = []) {
        return sqlite.prepare(requete).all(...params);
      },
      async queryOne(requete: string, params: any[] = []) {
        return sqlite.prepare(requete).get(...params) ?? null;
      },
      async execute(requete: string, params: any[] = []) {
        const r = sqlite.prepare(requete).run(...params);
        return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes };
      },
    },
  };
});

import {
  CONFIG_PASSKEY_PAR_DEFAUT,
  compterPasskeys,
  consommerDefi,
  domaineDeLOrigine,
  enOctets,
  enregistrerPasskey,
  identifiantWebAuthn,
  identiteDuSite,
  libelleParDefaut,
  lireTransports,
  nettoyerNom,
  normaliserConfigPasskey,
  noterUsage,
  origineDeLaRequete,
  ouvrirDefi,
  passkeyParCredentialId,
  passkeysDuCompte,
  type ConfigPasskey,
} from '../src/services/passkeys.service';

const base: BetterSqlite3.Database = (global as any).__basePasskeys;

beforeAll(() => {
  base.exec(`
    CREATE TABLE user_passkeys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      credential_id VARCHAR(255) NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports VARCHAR(255),
      device_type VARCHAR(32),
      backed_up INTEGER DEFAULT 0,
      aaguid VARCHAR(64),
      name VARCHAR(120),
      created_at DATETIME,
      last_used_at DATETIME
    );
    CREATE TABLE passkey_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge VARCHAR(255) NOT NULL UNIQUE,
      user_id INTEGER,
      purpose VARCHAR(32) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME
    );
  `);
});

beforeEach(() => {
  base.exec('DELETE FROM user_passkeys; DELETE FROM passkey_challenges;');
});

/** Requête minimale : seul ce que le service lit est fourni. */
function requete(entetes: Record<string, string>, protocole = 'https'): any {
  return {
    protocol: protocole,
    get: (nom: string) => entetes[nom.toLowerCase()],
  };
}

const config = (surcharges: Partial<ConfigPasskey> = {}): ConfigPasskey => ({
  ...CONFIG_PASSKEY_PAR_DEFAUT,
  ...surcharges,
});

describe('Configuration enregistrée', () => {
  it('lit une configuration complète', () => {
    const lue = normaliserConfigPasskey(
      JSON.stringify({
        rp_name: 'Mairie de Vaugrigneuse',
        rp_id: 'materiel.vaugrigneuse.fr',
        origin: 'https://materiel.vaugrigneuse.fr',
        attestation: 'direct',
        authenticator_selection: {
          authenticator_attachment: 'cross-platform',
          resident_key: 'required',
          user_verification: 'required',
        },
        timeout: 90000,
        allow_as_primary: true,
        allow_as_2fa: false,
      }),
      true
    );

    expect(lue.actif).toBe(true);
    expect(lue.rp_id).toBe('materiel.vaugrigneuse.fr');
    expect(lue.attestation).toBe('direct');
    expect(lue.authenticator_selection.resident_key).toBe('required');
    expect(lue.allow_as_primary).toBe(true);
    expect(lue.allow_as_2fa).toBe(false);
  });

  it('retombe sur les valeurs par défaut plutôt que d’ouvrir en grand', () => {
    // Une configuration corrompue ne doit jamais valoir « aucune exigence ».
    for (const brut of ['{pas du json', null, 42, '[]']) {
      const lue = normaliserConfigPasskey(brut, true);
      expect(lue.attestation).toBe('none');
      expect(lue.authenticator_selection.user_verification).toBe('preferred');
      expect(lue.timeout).toBe(CONFIG_PASSKEY_PAR_DEFAUT.timeout);
    }
  });

  it('ramène une valeur inconnue à la valeur par défaut', () => {
    const lue = normaliserConfigPasskey({
      attestation: 'enterprise',
      authenticator_selection: { resident_key: 'obligatoire', user_verification: 'peut-être' },
    });

    expect(lue.attestation).toBe('none');
    expect(lue.authenticator_selection.resident_key).toBe('preferred');
    expect(lue.authenticator_selection.user_verification).toBe('preferred');
  });

  it('traite « indirect », que la vérification ne connaît pas, comme « none »', () => {
    // Une base migrée depuis l'ancien écran porte encore cette valeur : la
    // laisser passer telle quelle ferait échouer chaque enregistrement.
    expect(normaliserConfigPasskey({ attestation: 'indirect' }).attestation).toBe('none');
  });

  it('borne le délai, pour que l’invite reste ouverte le temps d’un doigt', () => {
    expect(normaliserConfigPasskey({ timeout: 0 }).timeout).toBe(15_000);
    expect(normaliserConfigPasskey({ timeout: 9_000_000 }).timeout).toBe(300_000);
    expect(normaliserConfigPasskey({ timeout: 'trente' }).timeout).toBe(60_000);
  });

  it('accepte les booléens tels que les écrit la base', () => {
    expect(normaliserConfigPasskey({ allow_as_primary: 1 }).allow_as_primary).toBe(true);
    expect(normaliserConfigPasskey({ allow_as_2fa: '0' }).allow_as_2fa).toBe(false);
    expect(normaliserConfigPasskey({ allow_as_2fa: 'true' }).allow_as_2fa).toBe(true);
  });

  it('est inactive tant que l’interrupteur n’a pas été mis', () => {
    expect(normaliserConfigPasskey({}).actif).toBe(false);
  });
});

describe('Identité du site', () => {
  it('préfère l’origine annoncée par le navigateur', () => {
    const r = requete({ origin: 'https://materiel.mairie.fr', host: 'interne:3000' });
    expect(origineDeLaRequete(r)).toBe('https://materiel.mairie.fr');
  });

  it('retombe sur l’hôte appelé quand l’origine manque', () => {
    expect(origineDeLaRequete(requete({ host: 'materiel.mairie.fr' }))).toBe(
      'https://materiel.mairie.fr'
    );
    expect(origineDeLaRequete(requete({ host: 'localhost:5173' }, 'http'))).toBe(
      'http://localhost:5173'
    );
  });

  it('ne déduit rien d’une requête sans hôte', () => {
    expect(origineDeLaRequete(requete({}))).toBeNull();
    expect(identiteDuSite(config(), requete({}))).toBeNull();
  });

  it('déduit le domaine du site servi quand les champs sont vides', () => {
    // Le cas courant : ces deux champs sont restés décoratifs jusqu'ici, et
    // une installation qui ne les remplit pas doit fonctionner quand même.
    const identite = identiteDuSite(config(), requete({ origin: 'https://materiel.mairie.fr' }));

    expect(identite).toEqual({
      rpId: 'materiel.mairie.fr',
      origines: ['https://materiel.mairie.fr'],
      configuree: false,
    });
  });

  it('laisse la configuration l’emporter sur la requête', () => {
    const identite = identiteDuSite(
      config({ rp_id: 'mairie.fr', origin: 'https://materiel.mairie.fr' }),
      requete({ origin: 'https://autre.example.com' })
    );

    expect(identite).toEqual({
      rpId: 'mairie.fr',
      origines: ['https://materiel.mairie.fr'],
      configuree: true,
    });
  });

  it('accepte plusieurs origines séparées par des virgules', () => {
    const identite = identiteDuSite(
      config({ origin: 'https://materiel.mairie.fr, https://mairie.fr/ ' }),
      requete({ host: 'materiel.mairie.fr' })
    );

    expect(identite?.origines).toEqual(['https://materiel.mairie.fr', 'https://mairie.fr']);
    // Le RP ID manquant se déduit de la première origine, pas de la requête.
    expect(identite?.rpId).toBe('materiel.mairie.fr');
  });

  it('accepte un RP ID seul, et prend l’origine de la requête', () => {
    const identite = identiteDuSite(
      config({ rp_id: 'mairie.fr' }),
      requete({ origin: 'https://materiel.mairie.fr' })
    );

    expect(identite).toEqual({
      rpId: 'mairie.fr',
      origines: ['https://materiel.mairie.fr'],
      configuree: true,
    });
  });

  it('ne rend rien d’une origine illisible', () => {
    expect(domaineDeLOrigine('pas une url')).toBeNull();
    expect(identiteDuSite(config({ origin: 'pas une url' }), requete({}))).toBeNull();
  });
});

describe('Défis', () => {
  it('ne vaut qu’une fois', async () => {
    await ouvrirDefi('defi-a', 'connexion', null, 60_000);

    expect(await consommerDefi('defi-a', 'connexion')).toEqual({ userId: null });
    // Rejoué, le même défi ne vaut plus rien : c'est toute sa raison d'être.
    expect(await consommerDefi('defi-a', 'connexion')).toBeNull();
  });

  it('refuse un défi présenté à la mauvaise porte', async () => {
    // Un défi obtenu sur l'écran « ajouter une passkey » — donc par quelqu'un
    // de déjà connecté — ne doit pas ouvrir de session.
    await ouvrirDefi('defi-b', 'enregistrement', 7, 60_000);

    expect(await consommerDefi('defi-b', 'connexion')).toBeNull();
    // Et il est consommé quand même : un essai manqué ne laisse rien derrière.
    expect(await consommerDefi('defi-b', 'enregistrement')).toBeNull();
  });

  it('porte le compte auquel il a été remis', async () => {
    await ouvrirDefi('defi-c', 'second-facteur', 42, 60_000);
    expect(await consommerDefi('defi-c', 'second-facteur')).toEqual({ userId: 42 });
  });

  it('refuse un défi périmé', async () => {
    await ouvrirDefi('defi-d', 'connexion', null, 60_000);
    base
      .prepare('UPDATE passkey_challenges SET expires_at = ? WHERE challenge = ?')
      .run(new Date(Date.now() - 1000).toISOString(), 'defi-d');

    expect(await consommerDefi('defi-d', 'connexion')).toBeNull();
  });

  it('refuse un défi jamais émis', async () => {
    expect(await consommerDefi('inventé', 'connexion')).toBeNull();
    expect(await consommerDefi('', 'connexion')).toBeNull();
  });

  it('balaie les défis périmés en ouvrant le suivant', async () => {
    // Sans ce ménage, la table grossirait d'une ligne par écran de connexion
    // ouvert puis abandonné.
    await ouvrirDefi('vieux', 'connexion', null, 60_000);
    base
      .prepare('UPDATE passkey_challenges SET expires_at = ? WHERE challenge = ?')
      .run(new Date(Date.now() - 1000).toISOString(), 'vieux');

    await ouvrirDefi('neuf', 'connexion', null, 60_000);

    const restants = base.prepare('SELECT challenge FROM passkey_challenges').all() as any[];
    expect(restants.map((l) => l.challenge)).toEqual(['neuf']);
  });
});

describe('Clés enregistrées', () => {
  const cle = (surcharges: Partial<Parameters<typeof enregistrerPasskey>[0]> = {}) => ({
    userId: 1,
    credentialId: 'cred-1',
    publicKey: 'cGsx',
    counter: 0,
    transports: ['internal'],
    deviceType: 'singleDevice',
    backedUp: false,
    aaguid: null,
    name: 'Cet appareil',
    ...surcharges,
  });

  it('enregistre puis retrouve une clé par son identifiant', async () => {
    await enregistrerPasskey(cle());

    const retrouvee = await passkeyParCredentialId('cred-1');
    expect(retrouvee?.user_id).toBe(1);
    expect(retrouvee?.name).toBe('Cet appareil');
    expect(lireTransports(retrouvee?.transports)).toEqual(['internal']);
  });

  it('compte les clés d’un compte, et seulement les siennes', async () => {
    await enregistrerPasskey(cle());
    await enregistrerPasskey(cle({ credentialId: 'cred-2' }));
    await enregistrerPasskey(cle({ credentialId: 'cred-3', userId: 2 }));

    expect(await compterPasskeys(1)).toBe(2);
    expect(await compterPasskeys(2)).toBe(1);
    expect(await compterPasskeys(3)).toBe(0);
  });

  it('remonte la dernière clé utilisée en tête de liste', async () => {
    // « Laquelle est-ce que je n'utilise plus ? » est la question qu'on se pose
    // avant d'en supprimer une.
    const ancienne = await enregistrerPasskey(cle());
    const recente = await enregistrerPasskey(cle({ credentialId: 'cred-2', name: 'Téléphone' }));

    await noterUsage(ancienne, 3);
    await new Promise((r) => setTimeout(r, 5));
    await noterUsage(recente, 1);

    const liste = await passkeysDuCompte(1);
    expect(liste[0].name).toBe('Téléphone');
    expect(liste[0].counter).toBe(1);
    expect(liste[0].last_used_at).not.toBeNull();
  });

  it('ne laisse pas enregistrer deux fois le même identifiant', async () => {
    await enregistrerPasskey(cle());
    await expect(enregistrerPasskey(cle())).rejects.toThrow();
  });

  it('ne se casse pas sur des transports illisibles', async () => {
    expect(lireTransports('{pas du json')).toEqual([]);
    expect(lireTransports(null)).toEqual([]);
    expect(lireTransports('["usb", 7]')).toEqual(['usb']);
  });
});

describe('Libellés', () => {
  it('nomme la clé d’après ce qu’elle est, pour qu’on la reconnaisse', () => {
    expect(libelleParDefaut(['usb'], false)).toBe('Clé de sécurité');
    expect(libelleParDefaut(['nfc'], false)).toBe('Clé de sécurité');
    expect(libelleParDefaut(['internal'], true)).toBe('Passkey synchronisée');
    expect(libelleParDefaut(['internal'], false)).toBe('Cet appareil');
    expect(libelleParDefaut([], false)).toBe('Passkey');
  });

  it('retombe sur le libellé proposé plutôt que de laisser une ligne vide', () => {
    expect(nettoyerNom('   ', 'Cet appareil')).toBe('Cet appareil');
    expect(nettoyerNom(null, 'Passkey')).toBe('Passkey');
    expect(nettoyerNom('  Téléphone   de service ', 'Passkey')).toBe('Téléphone de service');
  });

  it('borne la longueur, pour que la liste reste lisible', () => {
    expect(nettoyerNom('x'.repeat(300), 'Passkey')).toHaveLength(120);
  });
});

describe('Identifiant WebAuthn', () => {
  it('ne contient aucune donnée personnelle', () => {
    // L'identifiant est conservé en clair dans l'authentificateur, et une
    // passkey synchronisée l'emporte avec elle : l'email y est déconseillé.
    const octets = identifiantWebAuthn(12);
    expect(Buffer.from(octets).toString('utf8')).toBe('compte-12');
  });

  it('est stable d’un enregistrement à l’autre', () => {
    expect(identifiantWebAuthn(12)).toEqual(identifiantWebAuthn(12));
    expect(identifiantWebAuthn(12)).not.toEqual(identifiantWebAuthn(13));
  });

  it('copie les octets au lieu de partager la mémoire de Node', () => {
    const source = Buffer.from([1, 2, 3]);
    const copie = enOctets(source);
    source[0] = 9;

    expect(Array.from(copie)).toEqual([1, 2, 3]);
    expect(copie.buffer.byteLength).toBe(3);
  });
});
