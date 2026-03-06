import swaggerJSDoc from 'swagger-jsdoc';
import path from 'path';
import fs from 'fs';

function getVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return '1.0.0';
  }
}

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Gestion Matériels API',
      version: getVersion(),
      description: 'Documentation complète de l\'API de gestion de matériels',
      contact: {
        name: 'Support',
      },
    },
    servers: [
      {
        url: '/api',
        description: 'Serveur API',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Token JWT obtenu via /api/auth/login',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
          },
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string' },
          },
        },
        // Auth
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
            user: { $ref: '#/components/schemas/User' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            email: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'supervisor', 'user'] },
            avatar: { type: 'string', nullable: true },
          },
        },
        // Categories
        Category: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            slug: { type: 'string' },
            description: { type: 'string' },
            icon: { type: 'string' },
            color: { type: 'string' },
          },
        },
        // Objects
        MatObject: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            description: { type: 'string' },
            category_id: { type: 'integer' },
            subcategory_id: { type: 'integer', nullable: true },
            status: { type: 'string' },
          },
        },
        // Webhook
        Webhook: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            url: { type: 'string', format: 'uri' },
            events: { type: 'string' },
            active: { type: 'boolean' },
          },
        },
        // Alert
        Alert: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            type: { type: 'string' },
            message: { type: 'string' },
            is_read: { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Authentification et gestion de session' },
      { name: 'Users', description: 'Gestion des utilisateurs' },
      { name: 'Categories', description: 'Gestion des catégories et sous-catégories' },
      { name: 'Objects', description: 'Gestion des objets / matériels' },
      { name: 'Calendar', description: 'Calendrier et événements' },
      { name: 'Alerts', description: 'Système d\'alertes' },
      { name: 'Tracking', description: 'Suivi et statistiques' },
      { name: 'Dashboard', description: 'Tableau de bord' },
      { name: 'Upload', description: 'Upload de fichiers et images' },
      { name: 'Settings', description: 'Paramètres de l\'application' },
      { name: 'Plugins', description: 'Gestion des plugins' },
      { name: 'Email Templates', description: 'Modèles d\'emails' },
      { name: 'Backup', description: 'Sauvegardes et restauration' },
      { name: 'Permissions', description: 'Gestion des droits et permissions' },
      { name: 'Custom Fields', description: 'Champs personnalisés' },
      { name: 'Logs', description: 'Journaux d\'activité' },
      { name: 'Webhooks', description: 'Configuration des webhooks' },
      { name: 'Security', description: 'Sécurité et rotation JWT' },
    ],
    paths: {
      // ─── Auth ───
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Connexion',
          security: [],
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } },
          responses: { '200': { description: 'Connexion réussie', content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } } }, '401': { description: 'Identifiants invalides' } },
        },
      },
      '/auth/register': {
        post: {
          tags: ['Auth'], summary: 'Inscription d\'un utilisateur (admin requis)',
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' }, firstName: { type: 'string' }, lastName: { type: 'string' }, role: { type: 'string' } } } } } },
          responses: { '201': { description: 'Utilisateur créé' } },
        },
      },
      '/auth/refresh': {
        post: {
          tags: ['Auth'], summary: 'Rafraîchir le token JWT', security: [],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { refreshToken: { type: 'string' } } } } } },
          responses: { '200': { description: 'Nouveau token' } },
        },
      },
      '/auth/logout': {
        post: { tags: ['Auth'], summary: 'Déconnexion', responses: { '200': { description: 'Déconnecté' } } },
      },
      '/auth/me': {
        get: { tags: ['Auth'], summary: 'Profil de l\'utilisateur courant', responses: { '200': { description: 'Profil utilisateur' } } },
      },
      '/auth/profile': {
        put: { tags: ['Auth'], summary: 'Mettre à jour le profil', responses: { '200': { description: 'Profil mis à jour' } } },
      },
      '/auth/change-password': {
        put: { tags: ['Auth'], summary: 'Changer le mot de passe', responses: { '200': { description: 'Mot de passe changé' } } },
      },
      '/auth/forgot-password': {
        post: { tags: ['Auth'], summary: 'Demander la réinitialisation du mot de passe', security: [], responses: { '200': { description: 'Email envoyé' } } },
      },
      '/auth/reset-password': {
        post: { tags: ['Auth'], summary: 'Réinitialiser le mot de passe', security: [], responses: { '200': { description: 'Mot de passe réinitialisé' } } },
      },
      '/auth/avatar': {
        post: { tags: ['Auth'], summary: 'Upload d\'avatar', requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { avatar: { type: 'string', format: 'binary' } } } } } }, responses: { '200': { description: 'Avatar uploadé' } } },
        delete: { tags: ['Auth'], summary: 'Supprimer l\'avatar', responses: { '200': { description: 'Avatar supprimé' } } },
      },

      // ─── Users ───
      '/users': {
        get: { tags: ['Users'], summary: 'Liste des utilisateurs', responses: { '200': { description: 'Liste des utilisateurs' } } },
        post: { tags: ['Users'], summary: 'Créer un utilisateur', responses: { '201': { description: 'Utilisateur créé' } } },
      },
      '/users/{id}': {
        get: { tags: ['Users'], summary: 'Détail d\'un utilisateur', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Détail utilisateur' } } },
        put: { tags: ['Users'], summary: 'Modifier un utilisateur', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Utilisateur modifié' } } },
        delete: { tags: ['Users'], summary: 'Supprimer un utilisateur', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Utilisateur supprimé' } } },
      },
      '/users/{id}/permissions': {
        put: { tags: ['Users'], summary: 'Modifier les permissions d\'un utilisateur', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Permissions modifiées' } } },
      },

      // ─── Categories ───
      '/categories': {
        get: { tags: ['Categories'], summary: 'Liste des catégories', responses: { '200': { description: 'Liste des catégories' } } },
        post: { tags: ['Categories'], summary: 'Créer une catégorie', responses: { '201': { description: 'Catégorie créée' } } },
      },
      '/categories/all': {
        get: { tags: ['Categories'], summary: 'Toutes les catégories (admin)', responses: { '200': { description: 'Liste complète' } } },
      },
      '/categories/all-with-subcategories': {
        get: { tags: ['Categories'], summary: 'Catégories avec sous-catégories', responses: { '200': { description: 'Catégories et sous-catégories' } } },
      },
      '/categories/{id}': {
        get: { tags: ['Categories'], summary: 'Détail d\'une catégorie', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Détail catégorie' } } },
        put: { tags: ['Categories'], summary: 'Modifier une catégorie', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Catégorie modifiée' } } },
        delete: { tags: ['Categories'], summary: 'Supprimer une catégorie', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Catégorie supprimée' } } },
      },
      '/categories/{categoryId}/subcategories': {
        get: { tags: ['Categories'], summary: 'Sous-catégories d\'une catégorie', parameters: [{ name: 'categoryId', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Liste sous-catégories' } } },
        post: { tags: ['Categories'], summary: 'Créer une sous-catégorie', parameters: [{ name: 'categoryId', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '201': { description: 'Sous-catégorie créée' } } },
      },

      // ─── Objects ───
      '/objects': {
        get: { tags: ['Objects'], summary: 'Liste des objets / matériels', responses: { '200': { description: 'Liste des objets' } } },
        post: { tags: ['Objects'], summary: 'Créer un objet', responses: { '201': { description: 'Objet créé' } } },
      },
      '/objects/{id}': {
        get: { tags: ['Objects'], summary: 'Détail d\'un objet', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Détail objet' } } },
        put: { tags: ['Objects'], summary: 'Modifier un objet', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Objet modifié' } } },
        delete: { tags: ['Objects'], summary: 'Supprimer un objet', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Objet supprimé' } } },
      },
      '/objects/{id}/fuel': {
        post: { tags: ['Objects'], summary: 'Ajouter une entrée carburant', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '201': { description: 'Entrée ajoutée' } } },
      },
      '/objects/{id}/maintenance': {
        post: { tags: ['Objects'], summary: 'Ajouter une maintenance', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '201': { description: 'Maintenance ajoutée' } } },
      },
      '/objects/{id}/technical-control': {
        post: { tags: ['Objects'], summary: 'Ajouter un contrôle technique', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '201': { description: 'Contrôle technique ajouté' } } },
      },

      // ─── Dashboard ───
      '/dashboard/stats': {
        get: { tags: ['Dashboard'], summary: 'Statistiques du tableau de bord', responses: { '200': { description: 'Statistiques' } } },
      },

      // ─── Calendar ───
      '/calendar': {
        get: { tags: ['Calendar'], summary: 'Liste du calendrier', responses: { '200': { description: 'Entrées calendrier' } } },
        post: { tags: ['Calendar'], summary: 'Créer une entrée', responses: { '201': { description: 'Entrée créée' } } },
      },
      '/calendar/events': {
        get: { tags: ['Calendar'], summary: 'Liste des événements', responses: { '200': { description: 'Événements' } } },
        post: { tags: ['Calendar'], summary: 'Créer un événement', responses: { '201': { description: 'Événement créé' } } },
      },
      '/calendar/upcoming': {
        get: { tags: ['Calendar'], summary: 'Événements à venir', responses: { '200': { description: 'Événements à venir' } } },
      },

      // ─── Alerts ───
      '/alerts': {
        get: { tags: ['Alerts'], summary: 'Liste des alertes', responses: { '200': { description: 'Alertes' } } },
        post: { tags: ['Alerts'], summary: 'Créer une alerte', responses: { '201': { description: 'Alerte créée' } } },
      },
      '/alerts/count': {
        get: { tags: ['Alerts'], summary: 'Nombre d\'alertes non lues', responses: { '200': { description: 'Compteur' } } },
      },

      // ─── Tracking ───
      '/tracking/data': {
        get: { tags: ['Tracking'], summary: 'Données de suivi', responses: { '200': { description: 'Données' } } },
      },
      '/tracking/charts': {
        get: { tags: ['Tracking'], summary: 'Données graphiques', responses: { '200': { description: 'Graphiques' } } },
      },
      '/tracking/filters': {
        get: { tags: ['Tracking'], summary: 'Filtres disponibles', responses: { '200': { description: 'Filtres' } } },
      },

      // ─── Upload ───
      '/upload/image': {
        post: { tags: ['Upload'], summary: 'Upload d\'une image', requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { image: { type: 'string', format: 'binary' } } } } } }, responses: { '200': { description: 'Image uploadée' } } },
      },
      '/upload/file': {
        post: { tags: ['Upload'], summary: 'Upload d\'un fichier', requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } }, responses: { '200': { description: 'Fichier uploadé' } } },
      },
      '/upload/images': {
        post: { tags: ['Upload'], summary: 'Upload d\'images multiples (max 10)', responses: { '200': { description: 'Images uploadées' } } },
      },

      // ─── Settings ───
      '/settings': {
        get: { tags: ['Settings'], summary: 'Récupérer les paramètres', responses: { '200': { description: 'Paramètres' } } },
        put: { tags: ['Settings'], summary: 'Modifier les paramètres', responses: { '200': { description: 'Paramètres modifiés' } } },
      },
      '/settings/smtp': {
        get: { tags: ['Settings'], summary: 'Configuration SMTP', responses: { '200': { description: 'Config SMTP' } } },
        put: { tags: ['Settings'], summary: 'Modifier la configuration SMTP', responses: { '200': { description: 'SMTP modifié' } } },
      },
      '/settings/smtp/test': {
        post: { tags: ['Settings'], summary: 'Tester la configuration SMTP', responses: { '200': { description: 'Test SMTP' } } },
      },
      '/settings/database': {
        get: { tags: ['Settings'], summary: 'Informations base de données', responses: { '200': { description: 'Info BDD' } } },
      },

      // ─── Plugins ───
      '/plugins': {
        get: { tags: ['Plugins'], summary: 'Liste des plugins', responses: { '200': { description: 'Plugins' } } },
      },
      '/plugins/menu': {
        get: { tags: ['Plugins'], summary: 'Menu des plugins', responses: { '200': { description: 'Menu plugins' } } },
      },
      '/plugins/{id}': {
        get: { tags: ['Plugins'], summary: 'Détail d\'un plugin', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Plugin' } } },
        delete: { tags: ['Plugins'], summary: 'Supprimer un plugin', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Plugin supprimé' } } },
      },
      '/plugins/{id}/toggle': {
        put: { tags: ['Plugins'], summary: 'Activer/désactiver un plugin', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Statut modifié' } } },
      },

      // ─── Email Templates ───
      '/email-templates': {
        get: { tags: ['Email Templates'], summary: 'Liste des modèles email', responses: { '200': { description: 'Modèles' } } },
        post: { tags: ['Email Templates'], summary: 'Créer un modèle', responses: { '201': { description: 'Modèle créé' } } },
      },
      '/email-templates/{id}': {
        get: { tags: ['Email Templates'], summary: 'Détail d\'un modèle', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Modèle' } } },
        put: { tags: ['Email Templates'], summary: 'Modifier un modèle', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Modèle modifié' } } },
        delete: { tags: ['Email Templates'], summary: 'Supprimer un modèle', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Modèle supprimé' } } },
      },

      // ─── Backup ───
      '/backup': {
        get: { tags: ['Backup'], summary: 'Liste des sauvegardes', responses: { '200': { description: 'Sauvegardes' } } },
        post: { tags: ['Backup'], summary: 'Créer une sauvegarde', responses: { '201': { description: 'Sauvegarde créée' } } },
      },
      '/backup/{id}/download': {
        get: { tags: ['Backup'], summary: 'Télécharger une sauvegarde', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Fichier sauvegarde' } } },
      },
      '/backup/restore': {
        post: { tags: ['Backup'], summary: 'Restaurer une sauvegarde', responses: { '200': { description: 'Restauration réussie' } } },
      },

      // ─── Permissions ───
      '/permissions/group/{role}': {
        get: { tags: ['Permissions'], summary: 'Permissions d\'un rôle', parameters: [{ name: 'role', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Permissions du rôle' } } },
        put: { tags: ['Permissions'], summary: 'Modifier les permissions d\'un rôle', parameters: [{ name: 'role', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Permissions modifiées' } } },
      },
      '/permissions/modules': {
        get: { tags: ['Permissions'], summary: 'Liste des modules', responses: { '200': { description: 'Modules' } } },
      },

      // ─── Custom Fields ───
      '/custom-fields/config/category/{categoryId}': {
        get: { tags: ['Custom Fields'], summary: 'Champs personnalisés d\'une catégorie', parameters: [{ name: 'categoryId', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Champs personnalisés' } } },
      },
      '/custom-fields/config': {
        post: { tags: ['Custom Fields'], summary: 'Créer un champ personnalisé', responses: { '201': { description: 'Champ créé' } } },
      },

      // ─── Logs ───
      '/logs': {
        get: { tags: ['Logs'], summary: 'Liste des logs', responses: { '200': { description: 'Logs' } } },
        delete: { tags: ['Logs'], summary: 'Supprimer tous les logs', responses: { '200': { description: 'Logs supprimés' } } },
      },
      '/logs/stats': {
        get: { tags: ['Logs'], summary: 'Statistiques des logs', responses: { '200': { description: 'Stats' } } },
      },
      '/logs/export': {
        get: { tags: ['Logs'], summary: 'Exporter les logs', responses: { '200': { description: 'Export CSV/JSON' } } },
      },

      // ─── Webhooks ───
      '/webhooks': {
        get: { tags: ['Webhooks'], summary: 'Liste des webhooks', responses: { '200': { description: 'Webhooks' } } },
        post: { tags: ['Webhooks'], summary: 'Créer un webhook', responses: { '201': { description: 'Webhook créé' } } },
      },
      '/webhooks/{id}': {
        get: { tags: ['Webhooks'], summary: 'Détail d\'un webhook', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Webhook' } } },
        put: { tags: ['Webhooks'], summary: 'Modifier un webhook', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Webhook modifié' } } },
        delete: { tags: ['Webhooks'], summary: 'Supprimer un webhook', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Webhook supprimé' } } },
      },
      '/webhooks/{id}/test': {
        post: { tags: ['Webhooks'], summary: 'Tester un webhook', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Test envoyé' } } },
      },

      // ─── Security ───
      '/security/jwt/status': {
        get: { tags: ['Security'], summary: 'Statut JWT', responses: { '200': { description: 'Statut' } } },
      },
      '/security/jwt/settings': {
        get: { tags: ['Security'], summary: 'Paramètres JWT', responses: { '200': { description: 'Paramètres' } } },
        put: { tags: ['Security'], summary: 'Modifier les paramètres JWT', responses: { '200': { description: 'Paramètres modifiés' } } },
      },
      '/security/jwt/rotate': {
        post: { tags: ['Security'], summary: 'Rotation de la clé JWT', responses: { '200': { description: 'Clé tournée' } } },
      },
      '/security/jwt/history': {
        get: { tags: ['Security'], summary: 'Historique des rotations JWT', responses: { '200': { description: 'Historique' } } },
      },
    },
  },
  apis: [], // No JSDoc annotations needed, paths are defined inline
};

export const swaggerSpec = swaggerJSDoc(options);
