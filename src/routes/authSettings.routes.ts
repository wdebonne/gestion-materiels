import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';

const router = Router();

// Interfaces pour typage
interface AuthProviderConfig {
  provider: string;
  is_active: boolean;
  config: Record<string, any>;
}

// Valeurs par défaut pour chaque provider
const DEFAULT_CONFIGS: Record<string, Record<string, any>> = {
  ldap: {
    server_url: '',
    bind_dn: '',
    bind_password: '',
    search_base: '',
    search_filter: '(uid={{username}})',
    tls: false,
    port: 389,
    username_attribute: 'uid',
    email_attribute: 'mail',
    first_name_attribute: 'givenName',
    last_name_attribute: 'sn',
    group_search_base: '',
    group_search_filter: '(member={{dn}})',
    admin_group: '',
    supervisor_group: '',
    auto_create_user: true,
    default_role: 'user'
  },
  saml: {
    entry_point: '',
    issuer: '',
    cert: '',
    callback_url: '',
    signature_algorithm: 'sha256',
    want_assertions_signed: true,
    auto_create_user: true,
    default_role: 'user',
    attribute_mapping: {
      email: 'email',
      first_name: 'givenName',
      last_name: 'surname'
    }
  },
  oidc: {
    discovery_url: '',
    client_id: '',
    client_secret: '',
    redirect_uri: '',
    scope: 'openid profile email',
    response_type: 'code',
    auto_create_user: true,
    default_role: 'user',
    attribute_mapping: {
      email: 'email',
      first_name: 'given_name',
      last_name: 'family_name'
    }
  },
  passkey: {
    rp_name: 'Gestion Matériels',
    rp_id: '',
    origin: '',
    attestation: 'none',
    authenticator_selection: {
      authenticator_attachment: 'platform',
      resident_key: 'preferred',
      user_verification: 'preferred'
    },
    timeout: 60000,
    allow_as_primary: false,
    allow_as_2fa: true
  },
  general: {
    allow_local_login: true,
    allow_registration: false,
    enforce_2fa: false,
    session_timeout_minutes: 480,
    max_login_attempts: 5,
    lockout_duration_minutes: 15,
    password_min_length: 8,
    password_require_uppercase: true,
    password_require_lowercase: true,
    password_require_number: true,
    password_require_special: false,
    password_expiry_days: 0
  }
};

// GET /api/settings/auth - Récupérer toute la configuration d'authentification
router.get('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await db.query('SELECT * FROM auth_config ORDER BY provider');

    const configs: Record<string, AuthProviderConfig> = {};

    // Initialiser avec les valeurs par défaut
    for (const [provider, defaultConfig] of Object.entries(DEFAULT_CONFIGS)) {
      configs[provider] = {
        provider,
        is_active: false,
        config: { ...defaultConfig }
      };
    }

    // Écraser avec les valeurs de la BDD
    for (const row of rows) {
      const parsed = row.config ? JSON.parse(row.config) : {};
      configs[row.provider] = {
        provider: row.provider,
        is_active: !!row.is_active,
        config: { ...DEFAULT_CONFIGS[row.provider], ...parsed }
      };
    }

    res.json({ success: true, providers: configs });
  } catch (error: any) {
    console.error('Erreur get auth config:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/settings/auth/:provider - Récupérer la config d'un provider
router.get('/:provider', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { provider } = req.params;

    if (!DEFAULT_CONFIGS[provider]) {
      res.status(400).json({ success: false, message: 'Provider inconnu' });
      return;
    }

    const row = await db.queryOne('SELECT * FROM auth_config WHERE provider = ?', [provider]);

    if (row) {
      const parsed = row.config ? JSON.parse(row.config) : {};
      res.json({
        success: true,
        provider: {
          provider: row.provider,
          is_active: !!row.is_active,
          config: { ...DEFAULT_CONFIGS[provider], ...parsed }
        }
      });
    } else {
      res.json({
        success: true,
        provider: {
          provider,
          is_active: false,
          config: { ...DEFAULT_CONFIGS[provider] }
        }
      });
    }
  } catch (error: any) {
    console.error('Erreur get auth provider:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/settings/auth/:provider - Mettre à jour la config d'un provider
router.put('/:provider', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { provider } = req.params;
    const { is_active, config } = req.body;

    if (!DEFAULT_CONFIGS[provider]) {
      res.status(400).json({ success: false, message: 'Provider inconnu' });
      return;
    }

    // Fusionner avec les defaults pour ne pas perdre de clés
    const mergedConfig = { ...DEFAULT_CONFIGS[provider], ...config };

    // Masquer les mots de passe existants si non fournis
    const existing = await db.queryOne('SELECT * FROM auth_config WHERE provider = ?', [provider]);
    if (existing) {
      const existingConfig = JSON.parse(existing.config || '{}');
      // Conserver les secrets si envoyé vide ou masqué
      const secretFields = ['bind_password', 'client_secret', 'cert'];
      for (const field of secretFields) {
        if (mergedConfig[field] === '' || mergedConfig[field] === '********') {
          mergedConfig[field] = existingConfig[field] || '';
        }
      }
    }

    const configJson = JSON.stringify(mergedConfig);
    const now = new Date().toISOString();

    if (existing) {
      await db.execute(
        'UPDATE auth_config SET is_active = ?, config = ?, updated_at = ? WHERE provider = ?',
        [is_active ? 1 : 0, configJson, now, provider]
      );
    } else {
      await db.execute(
        'INSERT INTO auth_config (provider, is_active, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [provider, is_active ? 1 : 0, configJson, now, now]
      );
    }

    await logService.log({
      action: 'update',
      category: 'other',
      userId: req.user!.userId,
      details: `Configuration ${provider} mise à jour (${is_active ? 'activé' : 'désactivé'})`
    });

    res.json({ success: true, message: `Configuration ${provider} mise à jour` });
  } catch (error: any) {
    console.error('Erreur update auth provider:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/settings/auth/:provider/test - Tester la connexion d'un provider
router.post('/:provider/test', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { provider } = req.params;

    if (!DEFAULT_CONFIGS[provider]) {
      res.status(400).json({ success: false, message: 'Provider inconnu' });
      return;
    }

    const row = await db.queryOne('SELECT * FROM auth_config WHERE provider = ?', [provider]);
    if (!row) {
      res.status(400).json({ success: false, message: 'Provider non configuré' });
      return;
    }

    const config = JSON.parse(row.config || '{}');

    // Tests de connectivité basiques selon le type
    switch (provider) {
      case 'ldap': {
        if (!config.server_url) {
          res.status(400).json({ success: false, message: 'URL du serveur LDAP non configurée' });
          return;
        }
        // Vérification basique du format de l'URL
        try {
          const url = new URL(config.server_url);
          if (!['ldap:', 'ldaps:'].includes(url.protocol)) {
            res.status(400).json({ success: false, message: 'L\'URL doit commencer par ldap:// ou ldaps://' });
            return;
          }
          res.json({ 
            success: true, 
            message: `Configuration LDAP valide. Serveur: ${url.hostname}:${url.port || config.port}` 
          });
        } catch {
          res.status(400).json({ success: false, message: 'URL du serveur LDAP invalide' });
        }
        return;
      }

      case 'saml': {
        if (!config.entry_point || !config.issuer) {
          res.status(400).json({ success: false, message: 'Point d\'entrée et Issuer requis' });
          return;
        }
        res.json({ 
          success: true, 
          message: `Configuration SAML valide. Entry Point: ${config.entry_point}` 
        });
        return;
      }

      case 'oidc': {
        if (!config.discovery_url || !config.client_id) {
          res.status(400).json({ success: false, message: 'URL de découverte et Client ID requis' });
          return;
        }
        // Tenter de valider l'URL de découverte
        try {
          new URL(config.discovery_url);
          res.json({ 
            success: true, 
            message: `Configuration OIDC valide. Discovery: ${config.discovery_url}` 
          });
        } catch {
          res.status(400).json({ success: false, message: 'URL de découverte invalide' });
        }
        return;
      }

      case 'passkey': {
        if (!config.rp_id || !config.origin) {
          res.status(400).json({ success: false, message: 'RP ID et Origine requis' });
          return;
        }
        res.json({ 
          success: true, 
          message: `Configuration Passkey valide. RP: ${config.rp_name} (${config.rp_id})` 
        });
        return;
      }

      default:
        res.json({ success: true, message: 'Configuration valide' });
    }
  } catch (error: any) {
    console.error('Erreur test auth provider:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
