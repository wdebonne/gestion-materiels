import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { body, validationResult } from 'express-validator';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin, requireFieldWrite, requireSupervisor } from '../middleware/auth.middleware';
import { ROLES, isRole } from '../config/roles';
import { lirePolitique, verifierMotDePasse } from '../services/passwordPolicy.service';
import { notifierWebhooks } from '../services/webhook.service';
import { logService } from '../services/log.service';
import { anonymiser, desactiver, estDernierAdmin, tracesDe } from '../services/comptes.service';
import { definirDroits, lireDroits } from '../services/droitsUtilisateur.service';
import { SaisieInvalide } from '../services/tickets.service';

const router = Router();

/**
 * Un même annuaire pour deux sortes de gens.
 *
 * `users` ne contient plus seulement des comptes : depuis la migration 028,
 * une **personne** peut y figurer sans adresse ni mot de passe, pour être
 * désignée — détentrice d'un trousseau, emprunteuse de matériel — sans jamais
 * ouvrir l'application. Un seul endroit où saisir les gens, et un agent qui
 * obtient un accès garde l'historique qu'il avait déjà.
 *
 * `can_login` sépare les deux, et rien d'autre : ni le rôle, ni la présence
 * d'un mot de passe. Le déduire de l'absence de mot de passe ouvrirait l'accès
 * à qui a enregistré une passkey, qui s'en passe.
 */
function peutSeConnecter(corps: any): boolean {
  return corps?.canLogin !== false && corps?.canLogin !== 0 && corps?.canLogin !== 'false';
}

/** Adresse normalisée, ou `null` quand le champ est vide — jamais `''`. */
function adresse(valeur: unknown): string | null {
  const texte = typeof valeur === 'string' ? valeur.trim() : '';
  return texte === '' ? null : texte;
}

/**
 * Qui tient l'annuaire, et jusqu'où.
 *
 * Le superviseur inscrit et corrige les **personnes sans compte** : c'est lui
 * qui remet les clés, et le renvoyer vers l'administrateur pour un nom manquant
 * revient à le renvoyer vers « un externe » — du texte libre, où le même nom
 * s'écrit de trois façons. C'est exactement ce que cet annuaire existe pour
 * éviter.
 *
 * Tout ce qui touche à un **accès** reste à l'administrateur : créer un compte,
 * en modifier un, accorder ou retirer la connexion, distribuer un rôle, poser
 * un mot de passe, supprimer, anonymiser, couper les sessions. La frontière
 * n'est pas « quels champs », mais « est-ce que cela ouvre une porte ».
 */
function estAdmin(req: AuthRequest): boolean {
  return req.user?.role === 'admin';
}

/**
 * GET /api/users - Liste des utilisateurs et des personnes.
 *
 * Le superviseur n'y voit que les personnes sans compte. Lui montrer les
 * comptes lui donnerait les adresses, les rôles et les dernières connexions de
 * toute la collectivité, alors qu'il n'a rien à en faire : il tient un annuaire
 * de noms, pas l'organigramme des accès.
 */
router.get('/', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    let query = `SELECT id, email, first_name, last_name, role, avatar, is_active, can_login, created_at, last_login
       FROM users`;
    const conditions: string[] = [];
    const params: any[] = [];

    if (!estAdmin(req)) {
      conditions.push('can_login = 0');
    }

    // Filtre par recherche (nom, prénom, email)
    if (req.query.search) {
      const search = `%${req.query.search}%`;
      conditions.push('(first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)');
      params.push(search, search, search);
    }

    // Filtre par rôles
    if (req.query.roles) {
      const roles = (req.query.roles as string).split(',').filter(isRole);
      if (roles.length > 0) {
        conditions.push(`role IN (${roles.map(() => '?').join(',')})`);
        params.push(...roles);
      }
    }

    // Filtre comptes / personnes. Les écrans qui distribuent des droits — Droits,
    // membres d'un service, permissions de plugin — n'ont rien à proposer à qui
    // ne se connecte pas : leur liste demande `canLogin=1`.
    if (req.query.canLogin !== undefined) {
      conditions.push('can_login = ?');
      params.push(req.query.canLogin === '0' || req.query.canLogin === 'false' ? 0 : 1);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC';

    const users = await db.query(query, params);

    res.json({
      success: true,
      users: users.map((u: any) => ({
        id: u.id,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        role: u.role,
        avatar: u.avatar,
        isActive: !!u.is_active,
        canLogin: !!u.can_login,
        createdAt: u.created_at,
        lastLogin: u.last_login
      }))
    });
  } catch (error: any) {
    console.error('Erreur get users:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * GET /api/users/annuaire - Liste réduite, pour désigner quelqu'un.
 *
 * L'écran des réservations demande à qui prêter le matériel, et remplissait
 * sa liste avec `GET /api/users`, réservé à l'administrateur. Un superviseur
 * recevait donc un 403 silencieux, une liste vide, et un bouton « Créer »
 * définitivement désactivé : il ne pouvait enregistrer aucune réservation.
 *
 * D'où cette vue étroite — de quoi afficher un nom, rien de plus. Ni rôle, ni
 * état du compte, ni dernière connexion : désigner un emprunteur n'exige pas
 * de connaître l'organigramme.
 *
 * Les personnes sans compte y figurent au même titre que les autres : c'est
 * tout l'objet de l'annuaire, et le gardien à qui on remet un trousseau est
 * précisément quelqu'un qu'on désigne sans qu'il se connecte jamais.
 *
 * Ouvert à l'agent de terrain, et non au seul superviseur : remettre une clé
 * est un geste de terrain, et une liste vide y renverrait chaque détenteur vers
 * « un externe », c'est-à-dire vers du texte libre où trois orthographes d'un
 * même nom deviennent trois personnes.
 */
router.get('/annuaire', authenticateToken, requireFieldWrite, async (_req: AuthRequest, res: Response) => {
  try {
    const utilisateurs = await db.query(
      `SELECT id, first_name, last_name FROM users
       WHERE is_active = 1 AND anonymized_at IS NULL
       ORDER BY last_name, first_name`
    );

    res.json({
      success: true,
      users: utilisateurs.map((u: any) => ({
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
      })),
    });
  } catch (error: any) {
    console.error('Erreur annuaire utilisateurs:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * POST /api/users/:id/revoke-sessions - Couper les sessions d'un compte.
 *
 * Le seul recours était jusqu'ici de désactiver le compte, donc d'empêcher
 * la personne de travailler — puis de le réactiver, ce qui rouvrait la même
 * faille, l'ancien jeton redevenant valable. Ici le compte reste actif : il
 * faut simplement se reconnecter.
 */
router.post('/:id/revoke-sessions', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const compte = await db.queryOne('SELECT id, email FROM users WHERE id = ?', [id]);
    if (!compte) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    await db.execute(
      'UPDATE users SET token_version = token_version + 1, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), id]
    );

    await logService.warning('auth', `Sessions révoquées pour ${compte.email}`, {}, {
      userId: req.user?.userId,
      userEmail: req.user?.email,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      message: `Les sessions de ${compte.email} ont été fermées.`,
    });
  } catch (error: any) {
    console.error('Erreur revoke-sessions:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/users/:id - Détail d'un utilisateur
/**
 * Tous les droits d'une personne, d'un bloc : les modules qu'elle voit, ce
 * qu'elle fait de chaque catégorie de demandes, ses bâtiments, son matériel,
 * les champs de son formulaire. Voir `droitsUtilisateur.service`.
 *
 * Déclarées avant `/:id` pour ne pas être prises pour un identifiant.
 */
router.get('/:id/droits', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const droits = await lireDroits(Number(req.params.id));
    if (!droits) return res.status(404).json({ success: false, message: 'Personne introuvable' });
    res.json({ success: true, ...droits });
  } catch (error) {
    console.error('Erreur lecture des droits :', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

router.put('/:id/droits', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    await definirDroits(Number(req.params.id), req.body ?? {}, Number(req.user!.userId));
    const droits = await lireDroits(Number(req.params.id));
    res.json({ success: true, message: 'Droits enregistrés', ...droits });
  } catch (error: any) {
    if (error instanceof SaisieInvalide) return res.status(400).json({ success: false, message: error.message });
    console.error('Enregistrement des droits :', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

router.get('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const user = await db.queryOne(
      `SELECT id, email, first_name, last_name, role, avatar, is_active, can_login, created_at, last_login
       FROM users WHERE id = ?`,
      [id]
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    // Récupérer les permissions
    const permissions = await db.query(
      `SELECT * FROM user_permissions WHERE user_id = ?`,
      [id]
    );

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        avatar: user.avatar,
        isActive: !!user.is_active,
        canLogin: !!user.can_login,
        createdAt: user.created_at,
        lastLogin: user.last_login,
        permissions
      }
    });
  } catch (error: any) {
    console.error('Erreur get user:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * POST /api/users - Créer un compte, ou une personne sans compte.
 *
 * `canLogin: false` décrit quelqu'un qu'on désigne sans qu'il se connecte : un
 * nom suffit alors, et c'est bien le nom qui devient obligatoire à la place de
 * l'adresse. Une adresse reste acceptée — on la connaît souvent — mais elle
 * n'ouvre aucun accès tant que la case n'est pas cochée.
 *
 * Le rôle d'une personne sans compte est ramené à `user` : il ne décrit alors
 * plus aucun pouvoir, et laisser passer `admin` poserait une promotion prête à
 * prendre effet le jour où la connexion serait accordée, sans que personne
 * l'ait relue.
 *
 * Le superviseur s'arrête là : il inscrit des personnes, il ne crée pas de
 * comptes.
 */
router.post('/', authenticateToken, requireSupervisor, [
  body('email').optional({ values: 'falsy' }).isEmail().normalizeEmail().withMessage('Email invalide'),
  // Facultatif depuis qu'une personne peut n'avoir aucun pouvoir à décrire.
  // `user` — la consultation seule — est le défaut le moins surprenant.
  body('role').optional().isIn(ROLES).withMessage('Rôle invalide')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array(), message: errors.array()[0]?.msg });
    }

    const { password, firstName, lastName, role } = req.body;
    const email = adresse(req.body?.email);
    const connexion = peutSeConnecter(req.body);

    if (connexion && !estAdmin(req)) {
      return res.status(403).json({
        success: false,
        message: "Seul un administrateur ouvre un accès à l'application. Décochez « Se connecte à l'application » pour inscrire une personne."
      });
    }

    if (connexion && !email) {
      return res.status(400).json({ success: false, message: 'Email invalide' });
    }
    // La longueur relève de la politique configurée, pas d'une constante :
    // sinon un minimum réglé à 10 laisserait passer 8, et un minimum réglé
    // à 6 serait refusé ici avec un message qui contredirait l'écran.
    if (connexion && !password) {
      return res.status(400).json({ success: false, message: 'Le mot de passe est obligatoire' });
    }
    if (!connexion && !`${firstName ?? ''}${lastName ?? ''}`.trim()) {
      return res.status(400).json({
        success: false,
        message: "Sans adresse ni connexion, le nom est la seule chose qui désigne cette personne : il est obligatoire"
      });
    }

    // Vérifier si l'email existe
    if (email) {
      const existing = await db.queryOne('SELECT id FROM users WHERE email = ?', [email]);
      if (existing) {
        return res.status(400).json({ success: false, message: 'Cet email est déjà utilisé' });
      }
    }

    let hashedPassword: string | null = null;
    if (connexion) {
      const controle = verifierMotDePasse(password, await lirePolitique());
      if (!controle.valide) {
        return res.status(400).json({ success: false, message: controle.message, manquements: controle.manquements });
      }

      // Hasher le mot de passe
      hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'));
    }

    // Créer l'utilisateur
    const result = await db.execute(
      `INSERT INTO users (email, password, first_name, last_name, role, can_login, password_changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        email,
        hashedPassword,
        firstName || '',
        lastName || '',
        connexion ? (role ?? 'user') : 'user',
        connexion ? 1 : 0,
        connexion ? new Date().toISOString() : null
      ]
    );

    // Ni le mot de passe ni son empreinte ne sortent : un webhook part vers un
    // service tiers, sur lequel personne ici n'a la main.
    notifierWebhooks('user.created', { id: result.lastInsertRowid, email, role, canLogin: connexion });

    res.status(201).json({
      success: true,
      message: connexion ? 'Utilisateur créé' : 'Personne ajoutée à l’annuaire',
      userId: result.lastInsertRowid
    });
  } catch (error: any) {
    console.error('Erreur create user:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/users/me - Modifier son propre profil
router.put('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { email, firstName, lastName } = req.body;

    // Vérifier que l'utilisateur existe
    const user = await db.queryOne('SELECT id, email, first_name, last_name, role, avatar FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    // Vérifier l'unicité de l'email
    if (email && email !== user.email) {
      const existing = await db.queryOne('SELECT id FROM users WHERE email = ? AND id != ?', [email, userId]);
      if (existing) {
        return res.status(400).json({ success: false, message: 'Cet email est déjà utilisé' });
      }
    }

    // Construire la requête de mise à jour
    const updateFields: string[] = [];
    const values: any[] = [];

    if (email) {
      updateFields.push('email = ?');
      values.push(email);
    }
    if (firstName !== undefined) {
      updateFields.push('first_name = ?');
      values.push(firstName);
    }
    if (lastName !== undefined) {
      updateFields.push('last_name = ?');
      values.push(lastName);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, message: 'Aucune donnée à mettre à jour' });
    }

    updateFields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(userId);

    await db.execute(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      values
    );

    // Retourner les données utilisateur mises à jour
    const updatedUser = await db.queryOne(
      'SELECT id, email, first_name, last_name, role, avatar FROM users WHERE id = ?',
      [userId]
    );

    res.json({
      id: updatedUser.id,
      email: updatedUser.email,
      firstName: updatedUser.first_name,
      lastName: updatedUser.last_name,
      role: updatedUser.role,
      avatar: updatedUser.avatar
    });
  } catch (error: any) {
    console.error('Erreur update profil:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/users/me/password - Changer son mot de passe
router.put('/me/password', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Mot de passe actuel et nouveau mot de passe requis' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Le nouveau mot de passe doit contenir au moins 8 caractères' });
    }

    // Récupérer l'utilisateur avec son mot de passe hashé
    const user = await db.queryOne('SELECT id, password FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Utilisateur non trouvé' });
    }

    // Vérifier le mot de passe actuel
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      return res.status(400).json({ success: false, error: 'Mot de passe actuel incorrect' });
    }

    const controle = verifierMotDePasse(newPassword, await lirePolitique());
    if (!controle.valide) {
      return res.status(400).json({ success: false, message: controle.message, manquements: controle.manquements });
    }

    // Hasher et mettre à jour le nouveau mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS || '12'));
    const maintenant = new Date().toISOString();
    await db.execute(
      'UPDATE users SET password = ?, password_changed_at = ?, updated_at = ? WHERE id = ?',
      [hashedPassword, maintenant, maintenant, userId]
    );

    res.json({ success: true, message: 'Mot de passe modifié avec succès' });
  } catch (error: any) {
    console.error('Erreur changement mot de passe:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

/**
 * PUT /api/users/:id - Modifier un compte, ou basculer d'une forme à l'autre.
 *
 * Les deux sens comptent autant l'un que l'autre :
 *
 * - **accorder la connexion** à une personne déjà connue — un saisonnier
 *   embauché, un agent qui reprend un poste — exige à ce moment-là une adresse
 *   et un mot de passe, les deux choses dont on s'était passé jusqu'ici. Son
 *   identifiant ne change pas : les clés qu'elle détient, les réservations à son
 *   nom et son passage dans l'historique la suivent ;
 * - **la retirer** ferme l'accès sans effacer personne. Les jetons en cours sont
 *   périmés au passage : sans cela, une session ouverte resterait valable
 *   jusqu'à sept jours après la décision.
 *
 * Le mot de passe est conservé en base plutôt qu'effacé. Il ne sert plus à rien
 * tant que `can_login` vaut 0 — la connexion est refusée avant même de le lire —
 * et le garder évite qu'un retrait par erreur, corrigé dans la minute, oblige à
 * en redistribuer un.
 *
 * Le superviseur corrige les personnes sans compte, et rien d'autre. Sans ce
 * droit, une faute de frappe le laisserait devant un nom qu'il ne peut pas
 * réparer, et il en créerait un second — le doublon que cet annuaire existe
 * pour empêcher. Un compte, en revanche, ne se touche qu'en administrateur : il
 * porte un accès.
 */
router.put('/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, role, isActive, password } = req.body;
    const emailFourni = req.body?.email !== undefined;
    const email = adresse(req.body?.email);

    // Vérifier que l'utilisateur existe
    const user = await db.queryOne(
      'SELECT id, email, password, can_login FROM users WHERE id = ?',
      [id]
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    const connexion = req.body?.canLogin === undefined ? !!user.can_login : peutSeConnecter(req.body);
    const administre = estAdmin(req);

    if (!administre) {
      if (user.can_login) {
        return res.status(403).json({
          success: false,
          message: "Ce compte a un accès à l'application : seul un administrateur le modifie"
        });
      }
      if (connexion) {
        return res.status(403).json({
          success: false,
          message: "Seul un administrateur ouvre un accès à l'application"
        });
      }
    }

    if (connexion) {
      const adresseRetenue = emailFourni ? email : user.email;
      if (!adresseRetenue) {
        return res.status(400).json({
          success: false,
          message: "Un compte se connecte avec son adresse : renseignez-la avant d'autoriser la connexion"
        });
      }
      if (!password && !user.password) {
        return res.status(400).json({
          success: false,
          message: "Cette personne n'a pas de mot de passe : donnez-lui-en un pour lui ouvrir la connexion"
        });
      }
    } else {
      if (Number(id) === req.user?.userId) {
        return res.status(400).json({
          success: false,
          message: 'Vous ne pouvez pas retirer votre propre accès'
        });
      }
      if (user.can_login && (await estDernierAdmin(id))) {
        return res.status(400).json({
          success: false,
          message: "C'est le dernier administrateur actif : plus personne ne pourrait configurer l'application"
        });
      }
    }

    // Vérifier l'unicité de l'email
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, message: 'Email invalide' });
      }
      const existing = await db.queryOne('SELECT id FROM users WHERE email = ? AND id != ?', [email, id]);
      if (existing) {
        return res.status(400).json({ success: false, message: 'Cet email est déjà utilisé' });
      }
    }

    // Construire la requête de mise à jour
    let updateFields = [];
    let values = [];

    if (emailFourni) {
      updateFields.push('email = ?');
      values.push(email);
    }
    if (req.body?.canLogin !== undefined && !!user.can_login !== connexion) {
      updateFields.push('can_login = ?');
      values.push(connexion ? 1 : 0);
      if (!connexion) {
        // Un jeton vaut sept jours par lui-même : sans ce coup de compteur,
        // l'accès retiré resterait ouvert jusqu'à son expiration.
        updateFields.push('token_version = token_version + 1');
      }
    }
    if (firstName !== undefined) {
      updateFields.push('first_name = ?');
      values.push(firstName);
    }
    if (lastName !== undefined) {
      updateFields.push('last_name = ?');
      values.push(lastName);
    }
    // Rôle et mot de passe ne sont lus que d'un administrateur. Le superviseur
    // ne modifie ici que des personnes sans compte, dont le rôle ne décrit aucun
    // pouvoir et dont le mot de passe n'ouvrirait rien : les ignorer vaut mieux
    // que de refuser l'enregistrement pour un champ que le formulaire recopie.
    if (role && administre) {
      updateFields.push('role = ?');
      values.push(role);
    }
    if (isActive !== undefined) {
      updateFields.push('is_active = ?');
      values.push(isActive ? 1 : 0);
    }
    if (password && administre) {
      const controle = verifierMotDePasse(password, await lirePolitique());
      if (!controle.valide) {
        return res.status(400).json({ success: false, message: controle.message, manquements: controle.manquements });
      }
      const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'));
      updateFields.push('password = ?');
      values.push(hashedPassword);
      updateFields.push('password_changed_at = ?');
      values.push(new Date().toISOString());
      // Un mot de passe réattribué débloque le compte : c'est la voie de sortie
      // qu'un administrateur utilise quand un agent s'est fait bloquer.
      updateFields.push('failed_login_attempts = 0');
      updateFields.push('locked_until = NULL');
    }

    updateFields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    await db.execute(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      values
    );

    res.json({ success: true, message: 'Utilisateur mis à jour' });
  } catch (error: any) {
    console.error('Erreur update user:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/users/:id - Supprimer un utilisateur
router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Empêcher de se supprimer soi-même
    if (parseInt(id) === req.user?.userId) {
      return res.status(400).json({ success: false, message: 'Vous ne pouvez pas vous supprimer vous-même' });
    }

    const compte = await db.queryOne('SELECT id FROM users WHERE id = ?', [id]);
    if (!compte) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    if (await estDernierAdmin(id)) {
      return res.status(400).json({
        success: false,
        message: "C'est le dernier administrateur actif : plus personne ne pourrait configurer l'application"
      });
    }

    /**
     * Supprimer effaçait la ligne, et chaque clé étrangère en `ON DELETE SET
     * NULL` vidait au passage l'auteur des décisions, des messages et de
     * l'historique. Une manifestation perdait la trace de qui l'avait validée le
     * jour où la personne quittait la collectivité — précisément ce qu'un litige
     * exige de retrouver, des mois plus tard.
     *
     * Un compte qui a laissé des traces est donc désactivé, jamais effacé. Pour
     * le RGPD, `POST /:id/anonymize` retire l'identité en gardant les liens.
     */
    const traces = await tracesDe(id);
    if (traces.total > 0) {
      await desactiver(id);
      await logService.warning('user', `Compte désactivé (traces conservées) : ${id}`, { traces }, { userId: req.user?.userId });

      return res.json({
        success: true,
        desactive: true,
        traces,
        message:
          "Cette personne a laissé des traces dans l'application : elle a été désactivée, pas supprimée. " +
          "L'effacer retirerait de l'historique le nom de qui a validé, livré, échangé ou détenu une clé. " +
          "Utilisez l'anonymisation si le RGPD l'exige."
      });
    }

    const result = await db.execute('DELETE FROM users WHERE id = ?', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    res.json({ success: true, message: 'Utilisateur supprimé' });
  } catch (error: any) {
    console.error('Erreur delete user:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * GET /api/users/:id/traces - Ce qu'un compte laisserait derrière lui.
 *
 * Affiché avant toute suppression : l'administrateur doit savoir ce qu'il
 * s'apprête à retirer, plutôt que de le découvrir après coup.
 */
router.get('/:id/traces', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const compte = await db.queryOne('SELECT id, anonymized_at FROM users WHERE id = ?', [req.params.id]);
    if (!compte) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    res.json({
      success: true,
      data: { traces: await tracesDe(req.params.id), anonymized_at: compte.anonymized_at }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/users/:id/anonymize - Retirer l'identité, garder les liens.
 *
 * Ce que le RGPD demande sans détruire la traçabilité : « qui a validé cette
 * manifestation ? » garde une réponse — un compte, distinct des autres — sans
 * que cette réponse nomme quelqu'un. Irréversible.
 */
router.post('/:id/anonymize', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const resultat = await anonymiser(req.params.id, req.user?.userId);
    if (!resultat.ok) {
      return res.status(400).json({ success: false, message: resultat.message });
    }

    await logService.warning('security', `Compte anonymisé : ${req.params.id}`, {}, { userId: req.user?.userId });
    res.json({ success: true, message: resultat.message });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/users/:id/permissions - Mettre à jour les permissions
router.put('/:id/permissions', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body;

    // Supprimer les anciennes permissions
    await db.execute('DELETE FROM user_permissions WHERE user_id = ?', [id]);

    // Ajouter les nouvelles permissions
    if (permissions && Array.isArray(permissions)) {
      for (const perm of permissions) {
        await db.execute(
          `INSERT INTO user_permissions (user_id, category_id, subcategory_id, can_view, can_edit, can_delete) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, perm.categoryId || null, perm.subcategoryId || null, perm.canView ? 1 : 0, perm.canEdit ? 1 : 0, perm.canDelete ? 1 : 0]
        );
      }
    }

    res.json({ success: true, message: 'Permissions mises à jour' });
  } catch (error: any) {
    console.error('Erreur update permissions:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
