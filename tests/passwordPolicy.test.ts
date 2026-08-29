import {
  verifierMotDePasse,
  normaliserPolitique,
  motDePasseExpire,
  ancienneteMotDePasse,
  decrirePolitique,
  POLITIQUE_PAR_DEFAUT,
  type PolitiqueAuth,
} from '../src/services/passwordPolicy.service';

/**
 * Politique de mot de passe et de connexion.
 *
 * L'écran Paramètres > Authentification permettait de régler la longueur
 * minimale, la complexité, l'expiration et le blocage après N tentatives.
 * Rien n'était appliqué : la configuration était écrite dans `auth_config` et
 * relue par personne. Un administrateur qui réglait « blocage après 5
 * tentatives » croyait disposer d'un contrôle qui n'existait pas.
 *
 * Ces tests figent ce que la politique exige, et surtout ce qu'elle fait des
 * valeurs qu'elle ne comprend pas : une configuration corrompue ne doit jamais
 * revenir à « aucune exigence ».
 */

const politique = (surcharges: Partial<PolitiqueAuth> = {}): PolitiqueAuth => ({
  ...POLITIQUE_PAR_DEFAUT,
  ...surcharges,
});

describe('Exigences de mot de passe', () => {
  it('accepte un mot de passe conforme', () => {
    const r = verifierMotDePasse('Tondeuse2026', politique());
    expect(r.valide).toBe(true);
    expect(r.manquements).toEqual([]);
  });

  it('refuse en dessous de la longueur configurée', () => {
    const r = verifierMotDePasse('Abc123', politique({ password_min_length: 12 }));
    expect(r.valide).toBe(false);
    expect(r.message).toContain('12 caractères');
  });

  it('applique chaque exigence de complexité', () => {
    const cas: Array<[string, Partial<PolitiqueAuth>, string]> = [
      ['tondeuse2026', { password_require_uppercase: true }, 'une majuscule'],
      ['TONDEUSE2026', { password_require_lowercase: true }, 'une minuscule'],
      ['Tondeusecommune', { password_require_number: true }, 'un chiffre'],
      ['Tondeuse2026', { password_require_special: true }, 'un caractère spécial'],
    ];

    for (const [motDePasse, surcharges, attendu] of cas) {
      const r = verifierMotDePasse(motDePasse, politique(surcharges));
      expect(r.valide).toBe(false);
      expect(r.manquements).toContain(attendu);
    }
  });

  it('rend tous les manquements d’un coup', () => {
    // Redemander un mot de passe trois fois de suite parce qu'on ne signale
    // qu'une exigence à la fois pousse à écrire le mot de passe sur un papier.
    const r = verifierMotDePasse('abc', politique({ password_require_special: true }));
    expect(r.manquements.length).toBeGreaterThanOrEqual(3);
    expect(r.message).toContain(',');
  });

  it('n’exige rien de plus que ce qui est configuré', () => {
    const permissive = politique({
      password_min_length: 4,
      password_require_uppercase: false,
      password_require_lowercase: false,
      password_require_number: false,
      password_require_special: false,
    });
    expect(verifierMotDePasse('abcd', permissive).valide).toBe(true);
  });

  it('décrit la politique pour l’afficher avant la saisie', () => {
    const texte = decrirePolitique(politique({ password_require_special: true }));
    expect(texte).toContain('8 caractères minimum');
    expect(texte).toContain('un caractère spécial');
  });
});

describe('Lecture de la configuration', () => {
  it('lit une configuration complète', () => {
    const p = normaliserPolitique('{"password_min_length":14,"max_login_attempts":3}');
    expect(p.password_min_length).toBe(14);
    expect(p.max_login_attempts).toBe(3);
  });

  it('retombe sur les valeurs par défaut plutôt que d’annuler une exigence', () => {
    // Une configuration illisible ne doit jamais valoir « aucune exigence ».
    for (const brut of [null, undefined, '', 'pas du json', '[]', '42']) {
      expect(normaliserPolitique(brut)).toEqual(POLITIQUE_PAR_DEFAUT);
    }
  });

  it('ignore les valeurs d’un type inattendu, champ par champ', () => {
    const p = normaliserPolitique({
      password_min_length: 'douze',
      password_require_number: 'peut-être',
      max_login_attempts: -3,
    });
    expect(p.password_min_length).toBe(POLITIQUE_PAR_DEFAUT.password_min_length);
    expect(p.password_require_number).toBe(POLITIQUE_PAR_DEFAUT.password_require_number);
    expect(p.max_login_attempts).toBe(POLITIQUE_PAR_DEFAUT.max_login_attempts);
  });

  it('accepte les booléens stockés en 0 / 1', () => {
    // SQLite n'a pas de type booléen : la configuration peut revenir en entiers.
    const p = normaliserPolitique({ password_require_special: 1, password_require_number: 0 });
    expect(p.password_require_special).toBe(true);
    expect(p.password_require_number).toBe(false);
  });
});

describe('Expiration du mot de passe', () => {
  const ilYA = (jours: number) => new Date(Date.now() - jours * 86_400_000).toISOString();

  it('est désactivée par défaut', () => {
    expect(POLITIQUE_PAR_DEFAUT.password_expiry_days).toBe(0);
    expect(motDePasseExpire(ilYA(3650), POLITIQUE_PAR_DEFAUT)).toBe(false);
  });

  it('signale un mot de passe plus vieux que le seuil', () => {
    const p = politique({ password_expiry_days: 90 });
    expect(motDePasseExpire(ilYA(100), p)).toBe(true);
    expect(motDePasseExpire(ilYA(89), p)).toBe(false);
  });

  it('ne déclare jamais expiré un compte sans date connue', () => {
    // Les comptes créés avant l'ajout de la colonne n'en ont pas : on ne
    // signale rien plutôt que d'alerter tout le monde au premier déploiement.
    const p = politique({ password_expiry_days: 30 });
    expect(motDePasseExpire(null, p)).toBe(false);
    expect(motDePasseExpire(undefined, p)).toBe(false);
    expect(motDePasseExpire('pas une date', p)).toBe(false);
  });

  it('calcule l’ancienneté en jours', () => {
    expect(ancienneteMotDePasse(ilYA(10))).toBe(10);
    expect(ancienneteMotDePasse(null)).toBeNull();
  });
});
