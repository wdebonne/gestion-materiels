import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticatorTransportFuture,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import { passkeyLimiter } from '../middleware/rateLimiter.middleware';
import { getDerivedSecret } from '../config/secrets';
import { logService } from '../services/log.service';
import { lirePolitique } from '../services/passwordPolicy.service';
import { ouvrirSession, type CompteConnecte } from '../services/session.service';
import {
  compterPasskeys,
  consommerDefi,
  enOctets,
  enregistrerPasskey,
  identifiantWebAuthn,
  identiteDuSite,
  libelleParDefaut,
  lireConfigPasskey,
  lireTransports,
  nettoyerNom,
  noterUsage,
  ouvrirDefi,
  passkeyParCredentialId,
  passkeysDuCompte,
  type EtatPasskey,
} from '../services/passkeys.service';

/**
 * Se connecter avec une passkey, et gérer les siennes.
 *
 * Une passkey remplace le mot de passe par une paire de clés dont la moitié
 * privée ne quitte jamais le téléphone, l'ordinateur ou la clé USB de l'agent.
 * Trois conséquences concrètes pour une commune :
 *
 *   — rien à retenir, donc rien à écrire sur un papier collé sous le clavier
 *     de l'atelier ;
 *   — rien à voler côté serveur : la table ne contient que des clés publiques,
 *     et une clé publique ne permet pas de se connecter ;
 *   — rien à hameçonner : la clé est scellée au domaine, et le navigateur
 *     refuse de la présenter à un site qui lui ressemble.
 *
 * Les routes vont par paires. La première rend un défi — une valeur aléatoire
 * que l'authentificateur devra signer — la seconde vérifie la signature. Entre
 * les deux, le défi est conservé en base, parce qu'il doit survivre au
 * redémarrage du serveur et valoir pour les deux instances d'un même site.
 */

const router = Router();

/** Refus commun quand le fournisseur n'est pas branché. */
function passkeysIndisponibles(res: Response): void {
  res.status(400).json({
    success: false,
    message: "Les passkeys ne sont pas activées sur cette installation.",
  });
}

/**
 * Ni le RP ID ni l'origine ne sont déterminables.
 *
 * En pratique cela veut dire une requête sans en-tête `Host` ni `Origin`, ce
 * qu'un navigateur n'envoie jamais. Le message vise donc l'administrateur, pas
 * l'agent : c'est dans son écran que les deux champs se renseignent.
 */
function identiteIntrouvable(res: Response): void {
  res.status(500).json({
    success: false,
    message:
      "Impossible de déterminer le domaine du site. Renseignez l'identifiant RP et l'origine dans Paramètres > Authentification > Passkey.",
  });
}

/** `authenticatorAttachment` absent laisse le choix entre biométrie et clé USB. */
function selectionAuthentificateur(config: EtatPasskey) {
  const choisi = config.authenticator_selection.authenticator_attachment;
  return {
    ...(choisi === 'any' ? {} : { authenticatorAttachment: choisi }),
    residentKey: config.authenticator_selection.resident_key,
    userVerification: config.authenticator_selection.user_verification,
  };
}

/**
 * La vérification de l'identité par l'authentificateur — code PIN, empreinte,
 * visage — n'est exigée au serveur que si l'administrateur l'a demandée.
 * L'exiger alors qu'elle est seulement « préférée » refuserait des clés USB
 * sans clavier, que la configuration accepte pourtant.
 */
function exigeVerification(config: EtatPasskey): boolean {
  return config.authenticator_selection.user_verification === 'required';
}

// ==================== ÉTAT PUBLIC ====================

/**
 * GET /api/auth/passkey/status - Ce que l'écran de connexion a besoin de savoir.
 *
 * Publique et volontairement avare : elle dit si le bouton « se connecter avec
 * une passkey » doit s'afficher, et rien d'autre. Un inconnu n'apprend ici ni
 * qui possède une passkey, ni combien.
 */
router.get('/status', async (_req: AuthRequest, res: Response) => {
  try {
    const config = await lireConfigPasskey();
    res.json({
      success: true,
      actif: config.actif,
      connexionSansMotDePasse: config.actif && config.allow_as_primary,
      secondFacteur: config.actif && config.allow_as_2fa,
    });
  } catch (error) {
    // L'écran de connexion ne doit jamais dépendre de cette route : en cas
    // d'erreur, le formulaire email + mot de passe reste affiché seul.
    res.json({ success: true, actif: false, connexionSansMotDePasse: false, secondFacteur: false });
  }
});

// ==================== MES PASSKEYS ====================

/** Ce qu'on montre d'une passkey : de quoi la reconnaître, jamais la clé. */
function decrire(passkey: Awaited<ReturnType<typeof passkeysDuCompte>>[number]) {
  return {
    id: passkey.id,
    name: passkey.name,
    transports: lireTransports(passkey.transports),
    synchronisee: passkey.device_type === 'multiDevice',
    sauvegardee: !!passkey.backed_up,
    createdAt: passkey.created_at,
    lastUsedAt: passkey.last_used_at,
  };
}

// GET /api/auth/passkey - Mes passkeys enregistrées
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const passkeys = await passkeysDuCompte(req.user!.userId);
    res.json({ success: true, passkeys: passkeys.map(decrire) });
  } catch (error: any) {
    console.error('Erreur liste passkeys:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/auth/passkey/register/options - Défi d'enregistrement
router.post('/register/options', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const config = await lireConfigPasskey();
    if (!config.actif) return passkeysIndisponibles(res);

    const identite = identiteDuSite(config, req);
    if (!identite) return identiteIntrouvable(res);

    const user = await db.queryOne(
      'SELECT id, email, first_name, last_name FROM users WHERE id = ?',
      [req.user!.userId]
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    const existantes = await passkeysDuCompte(user.id);

    const options = await generateRegistrationOptions({
      rpName: config.rp_name,
      rpID: identite.rpId,
      userID: identifiantWebAuthn(user.id),
      userName: user.email,
      userDisplayName: `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.email,
      timeout: config.timeout,
      attestationType: config.attestation,
      // Sans cette liste, réenregistrer le même appareil créerait un doublon
      // que l'agent ne saurait pas distinguer dans sa liste. L'authentificateur
      // répond « déjà enregistré » plutôt que d'ajouter une ligne.
      excludeCredentials: existantes.map((p) => ({
        id: p.credential_id,
        transports: lireTransports(p.transports) as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: selectionAuthentificateur(config),
    });

    await ouvrirDefi(options.challenge, 'enregistrement', user.id, config.timeout);

    res.json({ success: true, options });
  } catch (error: any) {
    console.error('Erreur options enregistrement passkey:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/auth/passkey/register/verify - Enregistre la clé publique
router.post('/register/verify', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const config = await lireConfigPasskey();
    if (!config.actif) return passkeysIndisponibles(res);

    const identite = identiteDuSite(config, req);
    if (!identite) return identiteIntrouvable(res);

    const reponse = req.body?.response as RegistrationResponseJSON | undefined;
    if (!reponse || typeof reponse !== 'object') {
      return res.status(400).json({ success: false, message: 'Réponse d\'enregistrement absente' });
    }

    const userId = req.user!.userId;

    const verification = await verifyRegistrationResponse({
      response: reponse,
      // Le défi est retrouvé à partir de celui que l'authentificateur a signé,
      // puis effacé : il ne vaut qu'une fois, et seulement pour le compte à
      // qui il a été remis.
      expectedChallenge: async (defi) => {
        const ouvert = await consommerDefi(defi, 'enregistrement');
        return ouvert !== null && ouvert.userId === userId;
      },
      expectedOrigin: identite.origines,
      expectedRPID: identite.rpId,
      requireUserVerification: exigeVerification(config),
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ success: false, message: 'Enregistrement refusé' });
    }

    const info = verification.registrationInfo;
    const transports = (reponse.response?.transports ?? []) as string[];
    const nom = nettoyerNom(
      req.body?.name,
      libelleParDefaut(transports, info.credentialDeviceType === 'multiDevice')
    );

    if (await passkeyParCredentialId(info.credential.id)) {
      return res.status(409).json({ success: false, message: 'Cette passkey est déjà enregistrée' });
    }

    const id = await enregistrerPasskey({
      userId,
      credentialId: info.credential.id,
      publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
      counter: info.credential.counter,
      transports,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      aaguid: info.aaguid || null,
      name: nom,
    });

    await logService.success(
      'security',
      'Passkey enregistrée',
      { nom, synchronisee: info.credentialDeviceType === 'multiDevice' },
      {
        userId,
        userEmail: req.user!.email,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }
    );

    const enregistree = (await passkeysDuCompte(userId)).find((p) => p.id === id);
    res.status(201).json({
      success: true,
      message: 'Passkey enregistrée',
      passkey: enregistree ? decrire(enregistree) : null,
    });
  } catch (error: any) {
    // La bibliothèque lève sur un défi inconnu, une origine inattendue ou une
    // signature invalide. Le message d'origine est technique : il est
    // journalisé, pas renvoyé.
    await logService.warning('security', 'Enregistrement de passkey refusé', {
      raison: error?.message,
    }, { userId: req.user?.userId, ipAddress: req.ip });
    res.status(400).json({
      success: false,
      message: "Cette passkey n'a pas pu être enregistrée. Réessayez depuis cet appareil.",
    });
  }
});

// PATCH /api/auth/passkey/:id - Renommer une de mes passkeys
router.patch('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const passkey = await db.queryOne('SELECT * FROM user_passkeys WHERE id = ? AND user_id = ?', [
      id,
      req.user!.userId,
    ]);
    if (!passkey) {
      return res.status(404).json({ success: false, message: 'Passkey introuvable' });
    }

    const nom = nettoyerNom(req.body?.name, passkey.name || 'Passkey');
    await db.execute('UPDATE user_passkeys SET name = ? WHERE id = ?', [nom, id]);

    res.json({ success: true, message: 'Passkey renommée', name: nom });
  } catch (error: any) {
    console.error('Erreur renommage passkey:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/auth/passkey/:id - Supprimer une de mes passkeys
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const passkey = await db.queryOne('SELECT * FROM user_passkeys WHERE id = ? AND user_id = ?', [
      id,
      req.user!.userId,
    ]);
    if (!passkey) {
      return res.status(404).json({ success: false, message: 'Passkey introuvable' });
    }

    await db.execute('DELETE FROM user_passkeys WHERE id = ?', [id]);

    await logService.warning(
      'security',
      'Passkey supprimée par son titulaire',
      { nom: passkey.name },
      {
        userId: req.user!.userId,
        userEmail: req.user!.email,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }
    );

    res.json({ success: true, message: 'Passkey supprimée' });
  } catch (error: any) {
    console.error('Erreur suppression passkey:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * DELETE /api/auth/passkey/user/:userId - Retirer les passkeys d'un agent.
 *
 * Le second facteur crée une impasse que le mot de passe seul ne connaissait
 * pas : un téléphone perdu, et son propriétaire ne peut plus entrer — donc plus
 * atteindre l'écran où il supprimerait la clé devenue inutilisable.
 * Désactiver le compte ne le débloque pas, cela l'enferme davantage.
 * Cette route est la sortie, et elle appartient à l'administrateur.
 */
router.delete('/user/:userId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userId = Number(req.params.userId);
    const cible = await db.queryOne('SELECT id, email FROM users WHERE id = ?', [userId]);
    if (!cible) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    const resultat = await db.execute('DELETE FROM user_passkeys WHERE user_id = ?', [userId]);

    await logService.warning(
      'security',
      'Passkeys retirées par un administrateur',
      { compte: cible.email, nombre: resultat.changes },
      {
        userId: req.user!.userId,
        userEmail: req.user!.email,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }
    );

    res.json({
      success: true,
      message:
        resultat.changes > 0
          ? `${resultat.changes} passkey(s) retirée(s). Le compte se reconnecte avec son mot de passe.`
          : 'Ce compte n\'avait aucune passkey.',
      supprimees: resultat.changes,
    });
  } catch (error: any) {
    console.error('Erreur suppression passkeys agent:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== CONNEXION SANS MOT DE PASSE ====================

/**
 * POST /api/auth/passkey/login/options - Défi de connexion.
 *
 * Aucun email n'est demandé, et aucune liste de clés n'est renvoyée : c'est
 * l'appareil qui propose les passkeys qu'il détient pour ce domaine. Réclamer
 * l'email d'abord obligerait à répondre « ce compte a-t-il une passkey ? »,
 * c'est-à-dire à confirmer l'existence du compte à qui le demande.
 */
router.post('/login/options', passkeyLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const config = await lireConfigPasskey();
    if (!config.actif || !config.allow_as_primary) return passkeysIndisponibles(res);

    const identite = identiteDuSite(config, req);
    if (!identite) return identiteIntrouvable(res);

    const options = await generateAuthenticationOptions({
      rpID: identite.rpId,
      timeout: config.timeout,
      userVerification: config.authenticator_selection.user_verification,
    });

    await ouvrirDefi(options.challenge, 'connexion', null, config.timeout);

    res.json({ success: true, options });
  } catch (error: any) {
    console.error('Erreur options connexion passkey:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/auth/passkey/login/verify - Vérifie la signature et ouvre la session
router.post('/login/verify', passkeyLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const config = await lireConfigPasskey();
    if (!config.actif || !config.allow_as_primary) return passkeysIndisponibles(res);

    const identite = identiteDuSite(config, req);
    if (!identite) return identiteIntrouvable(res);

    const reponse = req.body?.response as AuthenticationResponseJSON | undefined;
    const user = await verifierAssertion(reponse, identite, config, 'connexion', null, req);
    if ('erreur' in user) {
      return res.status(user.statut).json({ success: false, message: user.erreur });
    }

    const politique = await lirePolitique();
    res.json(await ouvrirSession(user.compte, req, res, 'passkey', politique));
  } catch (error: any) {
    console.error('Erreur connexion passkey:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== SECOND FACTEUR ====================

/** Ce que porte le ticket remis après un mot de passe vérifié. */
interface TicketSecondFacteur {
  userId: number;
  /** Distingue ce jeton d'un jeton de session : il n'ouvre aucune route. */
  usage: 'passkey-2fa';
  /** Version des jetons du compte, pour qu'une révocation périme le ticket. */
  tv: number;
}

/**
 * Le ticket dure le temps de poser un doigt sur un lecteur, pas davantage.
 * Au-delà, l'agent ressaisit son mot de passe — ce qui est le comportement
 * attendu de quelqu'un qui a laissé l'écran ouvert et s'est éloigné.
 */
const DUREE_TICKET = '5m';

/**
 * Le ticket est signé à part des jetons de session.
 *
 * Il porte un `userId` et une version de compte — de quoi passer pour un jeton
 * d'accès auprès de `authenticateToken`. Signé avec le même secret, il en
 * aurait été un : présenter son seul mot de passe aurait alors suffi, le
 * second facteur n'ayant plus qu'à être ignoré. Un secret dérivé rend les deux
 * familles de jetons illisibles l'une pour l'autre, sans rien à configurer.
 */
const SECRET_TICKET = () => getDerivedSecret('passkey-2fa');

/**
 * Prépare le second facteur après un mot de passe vérifié.
 *
 * Renvoie `null` si le domaine n'est pas déterminable : l'appelant ouvre alors
 * la session sans second facteur, plutôt que d'enfermer dehors un agent dont
 * le mot de passe est pourtant bon.
 */
export async function preparerSecondFacteur(
  compte: CompteConnecte,
  req: AuthRequest
): Promise<{ ticket: string; options: PublicKeyCredentialRequestOptionsJSON } | null> {
  const config = await lireConfigPasskey();
  if (!config.actif || !config.allow_as_2fa) return null;
  if ((await compterPasskeys(compte.id)) === 0) return null;

  const identite = identiteDuSite(config, req);
  if (!identite) return null;

  const passkeys = await passkeysDuCompte(compte.id);

  const options = await generateAuthenticationOptions({
    rpID: identite.rpId,
    timeout: config.timeout,
    // Ici l'identité est connue : on nomme les clés acceptées, pour que
    // l'appareil propose directement la bonne au lieu d'ouvrir un choix.
    allowCredentials: passkeys.map((p) => ({
      id: p.credential_id,
      transports: lireTransports(p.transports) as AuthenticatorTransportFuture[],
    })),
    userVerification: config.authenticator_selection.user_verification,
  });

  await ouvrirDefi(options.challenge, 'second-facteur', compte.id, config.timeout);

  const ticket = jwt.sign(
    { userId: compte.id, usage: 'passkey-2fa', tv: compte.token_version ?? 0 } as TicketSecondFacteur,
    SECRET_TICKET(),
    { expiresIn: DUREE_TICKET } as jwt.SignOptions
  );

  return { ticket, options };
}

// POST /api/auth/passkey/2fa/verify - Second facteur, après le mot de passe
router.post('/2fa/verify', passkeyLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const config = await lireConfigPasskey();
    if (!config.actif || !config.allow_as_2fa) return passkeysIndisponibles(res);

    const identite = identiteDuSite(config, req);
    if (!identite) return identiteIntrouvable(res);

    let ticket: TicketSecondFacteur;
    try {
      ticket = jwt.verify(String(req.body?.ticket ?? ''), SECRET_TICKET()) as TicketSecondFacteur;
    } catch {
      return res.status(401).json({
        success: false,
        message: 'La demande a expiré. Reprenez la connexion depuis le début.',
      });
    }

    if (ticket.usage !== 'passkey-2fa') {
      return res.status(401).json({ success: false, message: 'Demande invalide' });
    }

    const reponse = req.body?.response as AuthenticationResponseJSON | undefined;
    const resultat = await verifierAssertion(
      reponse,
      identite,
      config,
      'second-facteur',
      ticket.userId,
      req
    );
    if ('erreur' in resultat) {
      return res.status(resultat.statut).json({ success: false, message: resultat.erreur });
    }

    // Une révocation de sessions survenue entre le mot de passe et la passkey
    // périme le ticket : sans ce contrôle, un ticket volé survivrait au geste
    // même qui devait tout couper.
    if ((resultat.compte.token_version ?? 0) !== ticket.tv) {
      return res.status(401).json({
        success: false,
        message: 'La demande a expiré. Reprenez la connexion depuis le début.',
      });
    }

    const politique = await lirePolitique();
    res.json(await ouvrirSession(resultat.compte, req, res, 'mot de passe + passkey', politique));
  } catch (error: any) {
    console.error('Erreur second facteur passkey:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== VÉRIFICATION COMMUNE ====================

type ResultatAssertion =
  | { compte: CompteConnecte & { token_version: number } }
  | { erreur: string; statut: number };

/**
 * Vérifie une signature de connexion et rend le compte qu'elle désigne.
 *
 * Le chemin est le même pour la connexion sans mot de passe et pour le second
 * facteur ; seuls changent l'usage du défi et, pour le second facteur, le
 * compte auquel la clé doit appartenir.
 */
async function verifierAssertion(
  reponse: AuthenticationResponseJSON | undefined,
  identite: { rpId: string; origines: string[] },
  config: EtatPasskey,
  usage: 'connexion' | 'second-facteur',
  compteAttendu: number | null,
  req: AuthRequest
): Promise<ResultatAssertion> {
  const refus = { erreur: "Cette passkey n'a pas été reconnue.", statut: 401 };

  if (!reponse || typeof reponse !== 'object' || typeof reponse.id !== 'string') {
    return { erreur: 'Réponse de connexion absente', statut: 400 };
  }

  const passkey = await passkeyParCredentialId(reponse.id);
  if (!passkey) {
    await logService.warning('security', 'Passkey inconnue présentée à la connexion', {
      usage,
    }, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    return refus;
  }

  if (compteAttendu !== null && passkey.user_id !== compteAttendu) {
    await logService.warning('security', 'Passkey présentée pour un autre compte', {
      usage,
    }, { userId: compteAttendu, ipAddress: req.ip });
    return refus;
  }

  const compte = await db.queryOne(
    `SELECT id, email, role, first_name, last_name, avatar, is_active, can_login, password_changed_at, token_version
       FROM users WHERE id = ?`,
    [passkey.user_id]
  );
  if (!compte) return refus;

  /*
   * `locked_until` n'est volontairement pas consulté ici.
   *
   * Ce blocage compte des mots de passe faux, et ne protège que du devinage.
   * Une passkey ne se devine pas : il faudrait produire la signature d'un défi
   * aléatoire avec une clé privée qu'on ne possède pas. L'opposer à qui tient
   * l'appareil en main n'écarterait personne de dangereux, mais offrirait à un
   * inconnu un moyen de mettre un agent dehors — cinq mots de passe faux sur
   * son adresse, et son téléphone ne lui sert plus à rien.
   *
   * Un compte désactivé, lui, reste fermé : c'est une décision d'administrateur,
   * pas une conséquence d'attaque.
   */
  if (!compte.is_active) {
    await logService.warning('auth', 'Connexion par passkey sur compte désactivé', {}, {
      userId: compte.id,
      userEmail: compte.email,
      ipAddress: req.ip,
    });
    return { erreur: 'Compte désactivé', statut: 401 };
  }

  /*
   * Et un compte ramené à une fiche d'annuaire reste fermé, lui aussi.
   *
   * C'est la raison pour laquelle `can_login` est une colonne, et non la
   * déduction « pas de mot de passe, donc pas d'accès » : une passkey se passe
   * justement de mot de passe. Retirer l'accès sans regarder ici laisserait
   * entrer par l'appareil enregistré quelqu'un à qui on vient de le refuser.
   */
  if (!compte.can_login) {
    await logService.warning('auth', 'Connexion par passkey sur une fiche sans accès', {}, {
      userId: compte.id,
      userEmail: compte.email,
      ipAddress: req.ip,
    });
    return { erreur: "Ce compte n'a pas d'accès à l'application", statut: 401 };
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: reponse,
      expectedChallenge: async (defi) => {
        const ouvert = await consommerDefi(defi, usage);
        if (!ouvert) return false;
        // Un défi de second facteur est nominatif ; un défi de connexion ne
        // l'est pas, puisqu'il est émis avant de savoir qui se présente.
        return ouvert.userId === null || ouvert.userId === passkey.user_id;
      },
      expectedOrigin: identite.origines,
      expectedRPID: identite.rpId,
      credential: {
        id: passkey.credential_id,
        publicKey: enOctets(Buffer.from(passkey.public_key, 'base64url')),
        counter: passkey.counter,
        transports: lireTransports(passkey.transports) as AuthenticatorTransportFuture[],
      },
      requireUserVerification: exigeVerification(config),
    });
  } catch (error: any) {
    // Défi inconnu ou déjà consommé, origine inattendue, signature invalide,
    // compteur qui recule — le cas d'une clé clonée. Tous mènent au même refus
    // côté agent, et à une trace côté journal.
    await logService.warning('security', 'Signature de passkey refusée', {
      usage,
      raison: error?.message,
    }, { userId: compte.id, userEmail: compte.email, ipAddress: req.ip });
    return refus;
  }

  if (!verification.verified) return refus;

  await noterUsage(passkey.id, verification.authenticationInfo.newCounter);

  return { compte: { ...compte, token_version: compte.token_version ?? 0 } };
}

export default router;
