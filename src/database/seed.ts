import bcrypt from 'bcryptjs';
import { db } from './index';

const DEFAULT_SETTINGS = [
  { key: 'site_name', value: 'Gestion Matériels', type: 'string', description: 'Nom du site' },
  { key: 'site_version', value: '1.0.0', type: 'string', description: 'Version du site' },
  { key: 'site_url', value: 'http://localhost:3000', type: 'string', description: 'URL du site' },
  { key: 'site_logo', value: '', type: 'string', description: 'Logo du site' },
  { key: 'site_favicon', value: '', type: 'string', description: 'Favicon du site' },
  { key: 'default_image', value: '', type: 'string', description: 'Image par défaut' },
  { key: 'items_per_page', value: '20', type: 'number', description: 'Éléments par page' },
  { key: 'date_format', value: 'DD/MM/YYYY', type: 'string', description: 'Format de date' },
  { key: 'currency', value: 'EUR', type: 'string', description: 'Devise' },
  { key: 'currency_symbol', value: '€', type: 'string', description: 'Symbole de la devise' },
  { key: 'reminder_days_before', value: '30', type: 'number', description: 'Jours avant rappel' },
  { key: 'auto_backup', value: 'false', type: 'boolean', description: 'Sauvegarde automatique' },
  { key: 'backup_frequency', value: 'weekly', type: 'string', description: 'Fréquence de sauvegarde' },
  { key: 'maintenance_mode', value: 'false', type: 'boolean', description: 'Mode maintenance' }
];

const DEFAULT_EMAIL_TEMPLATES = [
  {
    name: 'welcome',
    subject: 'Bienvenue sur {{site_name}}',
    body: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #3b82f6; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9fafb; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    .button { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Bienvenue sur {{site_name}}</h1>
    </div>
    <div class="content">
      <p>Bonjour {{first_name}} {{last_name}},</p>
      <p>Votre compte a été créé avec succès sur {{site_name}}.</p>
      <p>Voici vos informations de connexion :</p>
      <ul>
        <li><strong>Email :</strong> {{email}}</li>
        <li><strong>Rôle :</strong> {{role}}</li>
      </ul>
      <p>Vous pouvez vous connecter en cliquant sur le bouton ci-dessous :</p>
      <p style="text-align: center;">
        <a href="{{site_url}}/login" class="button">Se connecter</a>
      </p>
    </div>
    <div class="footer">
      <p>© {{year}} {{site_name}} - Tous droits réservés</p>
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['site_name', 'first_name', 'last_name', 'email', 'role', 'site_url', 'year']),
    description: 'Email de bienvenue envoyé aux nouveaux utilisateurs'
  },
  {
    name: 'password_reset',
    subject: 'Réinitialisation de votre mot de passe - {{site_name}}',
    body: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #ef4444; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9fafb; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    .button { display: inline-block; padding: 12px 24px; background: #ef4444; color: white; text-decoration: none; border-radius: 4px; }
    .warning { background: #fef2f2; border: 1px solid #fecaca; padding: 10px; border-radius: 4px; margin: 10px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Réinitialisation du mot de passe</h1>
    </div>
    <div class="content">
      <p>Bonjour {{first_name}},</p>
      <p>Vous avez demandé la réinitialisation de votre mot de passe sur {{site_name}}.</p>
      <p>Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe :</p>
      <p style="text-align: center;">
        <a href="{{reset_link}}" class="button">Réinitialiser le mot de passe</a>
      </p>
      <div class="warning">
        <p><strong>⚠️ Ce lien expire dans {{expiry_hours}} heures.</strong></p>
        <p>Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.</p>
      </div>
    </div>
    <div class="footer">
      <p>© {{year}} {{site_name}} - Tous droits réservés</p>
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['site_name', 'first_name', 'reset_link', 'expiry_hours', 'year']),
    description: 'Email envoyé lors d\'une demande de réinitialisation de mot de passe'
  },
  {
    name: 'alert_notification',
    subject: '⚠️ Alerte : {{alert_title}} - {{site_name}}',
    body: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #f59e0b; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9fafb; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    .alert-box { background: #fffbeb; border: 1px solid #fcd34d; padding: 15px; border-radius: 4px; margin: 10px 0; }
    .button { display: inline-block; padding: 12px 24px; background: #f59e0b; color: white; text-decoration: none; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔔 Alerte</h1>
    </div>
    <div class="content">
      <p>Bonjour,</p>
      <div class="alert-box">
        <h2>{{alert_title}}</h2>
        <p>{{alert_message}}</p>
        <p><strong>Objet concerné :</strong> {{object_name}}</p>
        <p><strong>Date d'échéance :</strong> {{due_date}}</p>
      </div>
      <p style="text-align: center;">
        <a href="{{site_url}}/objects/{{object_id}}" class="button">Voir le détail</a>
      </p>
    </div>
    <div class="footer">
      <p>© {{year}} {{site_name}} - Tous droits réservés</p>
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['site_name', 'alert_title', 'alert_message', 'object_name', 'object_id', 'due_date', 'site_url', 'year']),
    description: 'Email d\'alerte pour les rappels (contrôle technique, maintenance, etc.)'
  },
  {
    name: 'maintenance_reminder',
    subject: '🔧 Rappel maintenance : {{object_name}} - {{site_name}}',
    body: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #8b5cf6; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9fafb; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    .info-box { background: #f5f3ff; border: 1px solid #c4b5fd; padding: 15px; border-radius: 4px; margin: 10px 0; }
    .button { display: inline-block; padding: 12px 24px; background: #8b5cf6; color: white; text-decoration: none; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔧 Rappel de maintenance</h1>
    </div>
    <div class="content">
      <p>Bonjour,</p>
      <p>Ceci est un rappel concernant la maintenance prévue :</p>
      <div class="info-box">
        <p><strong>Véhicule/Matériel :</strong> {{object_name}}</p>
        <p><strong>Type de maintenance :</strong> {{maintenance_type}}</p>
        <p><strong>Date prévue :</strong> {{scheduled_date}}</p>
        <p><strong>Kilométrage prévu :</strong> {{scheduled_mileage}} km</p>
      </div>
      <p style="text-align: center;">
        <a href="{{site_url}}/objects/{{object_id}}" class="button">Voir le détail</a>
      </p>
    </div>
    <div class="footer">
      <p>© {{year}} {{site_name}} - Tous droits réservés</p>
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['site_name', 'object_name', 'object_id', 'maintenance_type', 'scheduled_date', 'scheduled_mileage', 'site_url', 'year']),
    description: 'Email de rappel pour les maintenances programmées'
  },
  {
    name: 'backup_notification',
    subject: '💾 Sauvegarde - {{site_name}} - {{backup_date}}',
    body: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #10b981; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9fafb; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    .info-box { background: #ecfdf5; border: 1px solid #6ee7b7; padding: 15px; border-radius: 4px; margin: 10px 0; }
    .warning { background: #fffbeb; border: 1px solid #fcd34d; padding: 10px; border-radius: 4px; margin: 15px 0; }
    .button { display: inline-block; padding: 12px 24px; background: #10b981; color: white; text-decoration: none; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>💾 Sauvegarde de la base de données</h1>
    </div>
    <div class="content">
      <p>Bonjour,</p>
      <p>Veuillez trouver ci-joint la sauvegarde de votre application <strong>{{site_name}}</strong>.</p>
      <div class="info-box">
        <p><strong>📁 Fichier :</strong> {{backup_filename}}</p>
        <p><strong>📅 Date :</strong> {{backup_date}}</p>
        <p><strong>📦 Taille :</strong> {{backup_size}}</p>
      </div>
      <div class="warning">
        <p><strong>⚠️ Important :</strong></p>
        <p>Conservez cette sauvegarde dans un endroit sûr. Elle contient toutes les données de votre application (base de données, images, plugins).</p>
      </div>
      <p style="text-align: center;">
        <a href="{{site_url}}/settings/backup" class="button">Gérer les sauvegardes</a>
      </p>
    </div>
    <div class="footer">
      <p>© {{year}} {{site_name}} - Tous droits réservés</p>
      <p>Cette sauvegarde a été générée automatiquement.</p>
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['site_name', 'backup_filename', 'backup_date', 'backup_size', 'site_url', 'year']),
    description: 'Email envoyé lors de l\'envoi d\'une sauvegarde par email'
  }
];

const DEFAULT_PLUGINS = [
  {
    name: 'Carburant',
    slug: 'fuel',
    version: '1.0.0',
    description: 'Gestion de la consommation de carburant des véhicules',
    author: 'Système',
    icon: 'fuel',
    is_system: 1,
    config: JSON.stringify({
      fuel_types: ['Diesel', 'Essence SP95', 'Essence SP98', 'E85', 'GPL', 'Électrique'],
      track_mileage: true,
      track_cost: true
    })
  },
  {
    name: 'Contrôle Technique',
    slug: 'technical-control',
    version: '1.0.0',
    description: 'Suivi des contrôles techniques et rappels automatiques',
    author: 'Système',
    icon: 'clipboard-check',
    is_system: 1,
    config: JSON.stringify({
      reminder_days: [30, 15, 7, 1],
      control_validity_years: 2,
      results: ['Favorable', 'Défavorable', 'Contre-visite']
    })
  },
  {
    name: 'Maintenance',
    slug: 'maintenance',
    version: '1.0.0',
    description: 'Gestion des maintenances et entretiens des équipements',
    author: 'Système',
    icon: 'wrench',
    is_system: 1,
    config: JSON.stringify({
      maintenance_types: [
        'Vidange moteur',
        'Vidange boîte de vitesse',
        'Changement filtres',
        'Pression des pneus',
        'Changement de pneus',
        'Changement plaquettes de frein',
        'Changement disques de frein',
        'Révision générale',
        'Changement courroie distribution',
        'Climatisation',
        'Batterie',
        'Autre'
      ],
      reminder_days: [30, 15, 7],
      track_mileage: true
    })
  },
  {
    name: 'Calendrier',
    slug: 'calendar',
    version: '1.0.0',
    description: 'Calendrier avec agenda pour planifier les événements',
    author: 'Système',
    icon: 'calendar',
    plugin_type: 'menu',
    is_system: 1,
    is_active: 1,
    config: JSON.stringify({
      default_view: 'month',
      first_day_of_week: 1,
      event_colors: {
        maintenance: '#8b5cf6',
        technical_control: '#ef4444',
        fuel: '#22c55e',
        other: '#3b82f6'
      }
    })
  },
  {
    name: 'Réservations',
    slug: 'reservations',
    version: '1.0.0',
    description: 'Gestion des réservations et prêts de matériel entre services',
    author: 'Système',
    icon: 'calendar-clock',
    plugin_type: 'menu',
    route: 'reservations',
    is_system: 1,
    is_active: 1,
    config: JSON.stringify({
      statuses: ['pending', 'approved', 'active', 'returned', 'overdue', 'cancelled'],
      require_approval: true,
      overdue_check_cron: '0 8 * * *'
    })
  },
  {
    name: 'Amortissement',
    slug: 'depreciation',
    version: '1.0.0',
    description: 'Calcul de la dépréciation et valeur résiduelle du matériel',
    author: 'Système',
    icon: 'trending-down',
    plugin_type: 'menu',
    route: 'depreciation',
    is_system: 1,
    is_active: 1,
    config: JSON.stringify({
      default_lifespan_years: 5,
      depreciation_method: 'linear'
    })
  },
  {
    name: 'Cartographie',
    slug: 'map',
    version: '1.0.0',
    description: 'Localisation géographique des équipements sur carte interactive',
    author: 'Système',
    icon: 'map-pin',
    plugin_type: 'menu',
    route: 'map',
    is_system: 1,
    is_active: 1,
    config: JSON.stringify({
      default_center: [49.5833, 0.9500],
      default_zoom: 13,
      tile_provider: 'openstreetmap'
    })
  }
];

export async function seedDatabase(): Promise<void> {
  console.log('🌱 Début du seed de la base de données...');

  // Créer l'utilisateur admin par défaut seulement s'il n'y a aucun admin dans la base
  // Cela évite de recréer un admin par défaut lors d'une restauration de backup
  const existingAdmin = await db.queryOne('SELECT id FROM users WHERE role = ?', ['admin']);
  
  if (!existingAdmin) {
    const adminPassword = await bcrypt.hash('admin123', 12);
    await db.execute(
      `INSERT INTO users (email, password, first_name, last_name, role, is_active) VALUES (?, ?, ?, ?, ?, ?)`,
      ['admin@example.com', adminPassword, 'Admin', 'Système', 'admin', 1]
    );
    console.log('✅ Utilisateur admin créé (admin@example.com / admin123)');
  } else {
    console.log('ℹ️ Un utilisateur admin existe déjà');
  }

  // Insérer les paramètres par défaut
  for (const setting of DEFAULT_SETTINGS) {
    const existing = await db.queryOne('SELECT id FROM settings WHERE setting_key = ?', [setting.key]);
    if (!existing) {
      await db.execute(
        `INSERT INTO settings (setting_key, setting_value, setting_type, description) VALUES (?, ?, ?, ?)`,
        [setting.key, setting.value, setting.type, setting.description]
      );
    }
  }
  console.log('✅ Paramètres par défaut insérés');

  // Insérer les templates email par défaut
  for (const template of DEFAULT_EMAIL_TEMPLATES) {
    const existing = await db.queryOne('SELECT id FROM email_templates WHERE name = ?', [template.name]);
    if (!existing) {
      await db.execute(
        `INSERT INTO email_templates (name, subject, body, variables, description) VALUES (?, ?, ?, ?, ?)`,
        [template.name, template.subject, template.body, template.variables, template.description]
      );
    }
  }
  console.log('✅ Templates email par défaut insérés');

  // Insérer les plugins par défaut
  for (const plugin of DEFAULT_PLUGINS) {
    const existing = await db.queryOne('SELECT id FROM plugins WHERE slug = ?', [plugin.slug]);
    if (!existing) {
      await db.execute(
        `INSERT INTO plugins (name, slug, version, description, author, icon, plugin_type, route, is_system, is_active, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [plugin.name, plugin.slug, plugin.version, plugin.description, plugin.author, plugin.icon, (plugin as any).plugin_type || 'object', (plugin as any).route || plugin.slug, plugin.is_system, plugin.is_active || 0, plugin.config]
      );
    }
  }
  console.log('✅ Plugins par défaut insérés');

  console.log('🎉 Seed terminé avec succès!');
}

// Exécuter le seed si appelé directement
if (require.main === module) {
  (async () => {
    const { initDatabase } = await import('./index');
    await initDatabase();
    await seedDatabase();
    process.exit(0);
  })();
}
