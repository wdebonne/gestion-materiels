import bcrypt from 'bcryptjs';
import { db } from './index';

/**
 * URL publique utilisée dans les liens des emails, semée à la première
 * installation puis modifiable dans Paramètres.
 *
 * La valeur codée en dur pointait sur le port 3000 alors que le serveur écoute
 * sur 3001 : sur une installation neuve, tous les liens des emails menaient
 * vers un port fermé.
 */
const URL_PAR_DEFAUT = process.env.SITE_URL || `http://localhost:${process.env.PORT || 3001}`;

const DEFAULT_SETTINGS = [
  { key: 'site_name', value: 'Gestion Matériels', type: 'string', description: 'Nom du site' },
  { key: 'site_version', value: '1.0.0', type: 'string', description: 'Version du site' },
  { key: 'site_url', value: URL_PAR_DEFAUT, type: 'string', description: 'URL du site' },
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
  { key: 'maintenance_mode', value: 'false', type: 'boolean', description: 'Mode maintenance' },

  // Page publique des étiquettes de clés. Le message s'adresse à quelqu'un qui
  // vient de ramasser un trousseau et n'a pas de compte : il doit dire quoi en
  // faire, et rien de plus.
  { key: 'cle_public_titre', value: 'Trousseau de clés', type: 'string', description: 'Titre de la page publique des clés' },
  { key: 'cle_public_message', value: 'Clé de la ville de Pavilly. Merci de rapporter ce trousseau à la mairie ou à la police municipale.', type: 'string', description: 'Message affiché à qui trouve un trousseau' },
  { key: 'cle_public_contact', value: '', type: 'string', description: 'Coordonnées affichées sur la page publique des clés' },
  // Vide par défaut : l'hôte courant sert de repli. Renseigner un domaine court
  // raccourcit l'URL, donc allège le QR code — décisif sur une étiquette Avery
  // L6008, qui ne fait que dix millimètres de haut.
  { key: 'cle_public_base_url', value: '', type: 'string', description: 'Base courte des liens d\'étiquettes (ex. pavilly.fr/t)' }
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
  },
  // ---------------------------------------------------------------- Manifestations
  //
  // Un service ne reçoit ces messages que s'il est concerné par la
  // manifestation — c'est-à-dire si elle demande du matériel de ses catégories.
  // Voir `manifestationServices.service.ts`.
  {
    name: 'manifestation_approval_request',
    subject: '✅ Votre approbation est attendue — {{manifestation_title}}',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #0284c7; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">Approbation attendue</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p>Bonjour,</p>
      <p>La manifestation <strong>{{manifestation_title}}</strong> demande du matériel relevant de
         <strong>{{service_name}}</strong>. Votre approbation est attendue.</p>
      {{#if comment}}<p style="background: #eff6ff; border-left: 3px solid #0284c7; padding: 10px;">{{comment}}</p>{{/if}}
      <p>Vous pouvez approuver, refuser, ou indiquer que votre service n'est pas concerné —
         et préciser vos propres dates de livraison et de récupération.</p>
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{manifestation_url}}" style="display: inline-block; padding: 12px 24px; background: #0284c7; color: white; text-decoration: none; border-radius: 4px;">Voir la manifestation</a>
      </p>
    </div>
    <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
      <p>© {{year}} {{site_name}}</p>
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['site_name', 'manifestation_title', 'service_name', 'comment', 'manifestation_url', 'year']),
    description: "Demande d'approbation envoyée à un service concerné par une manifestation"
  },
  {
    name: 'manifestation_information_request',
    subject: 'ℹ️ Demande d\'information — {{manifestation_title}}',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #6366f1; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">Demande d'information</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p>Bonjour,</p>
      <p>Votre avis est demandé sur la manifestation <strong>{{manifestation_title}}</strong>.</p>
      {{#if comment}}<p style="background: #eef2ff; border-left: 3px solid #6366f1; padding: 10px;">{{comment}}</p>{{/if}}
      <p>Cette demande n'est pas bloquante : la manifestation peut être validée sans votre réponse.</p>
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{manifestation_url}}" style="display: inline-block; padding: 12px 24px; background: #6366f1; color: white; text-decoration: none; border-radius: 4px;">Répondre</a>
      </p>
    </div>
    <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
      <p>© {{year}} {{site_name}}</p>
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['site_name', 'manifestation_title', 'comment', 'manifestation_url', 'year']),
    description: "Demande d'avis non bloquante sur une manifestation"
  },
  {
    name: 'manifestation_decision',
    subject: '📋 {{service_name}} {{decision}} {{manifestation_title}}',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #0f766e; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">Décision d'un service</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p><strong>{{service_name}}</strong> {{decision}} la manifestation <strong>{{manifestation_title}}</strong>.</p>
      {{#if comment}}<p style="background: #f0fdfa; border-left: 3px solid #0f766e; padding: 10px;">{{comment}}</p>{{/if}}
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{manifestation_url}}" style="display: inline-block; padding: 12px 24px; background: #0f766e; color: white; text-decoration: none; border-radius: 4px;">Voir le suivi</a>
      </p>
    </div>
    <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
      <p>© {{year}} {{site_name}}</p>
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['site_name', 'manifestation_title', 'service_name', 'decision', 'comment', 'manifestation_url', 'year']),
    description: 'Décision rendue par un service sur une manifestation'
  },
  {
    name: 'manifestation_message',
    subject: '💬 Nouveau message — {{manifestation_title}}',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #7c3aed; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">Nouveau message</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p>Un message a été ajouté au suivi de <strong>{{manifestation_title}}</strong> :</p>
      <p style="background: #f5f3ff; border-left: 3px solid #7c3aed; padding: 12px; white-space: pre-wrap;">{{message}}</p>
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{manifestation_url}}" style="display: inline-block; padding: 12px 24px; background: #7c3aed; color: white; text-decoration: none; border-radius: 4px;">Répondre</a>
      </p>
    </div>
    <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
      <p>© {{year}} {{site_name}}</p>
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['site_name', 'manifestation_title', 'message', 'manifestation_url', 'year']),
    description: 'Message ajouté au fil de suivi d\'une manifestation'
  },
  {
    name: 'manifestation_date_changed',
    subject: '📅 Dates modifiées — {{manifestation_title}}',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #d97706; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">Dates modifiées</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p>Les dates de <strong>{{manifestation_title}}</strong> ont changé :</p>
      <p style="background: #fffbeb; border-left: 3px solid #d97706; padding: 12px;">{{changes}}</p>
      <p>Si votre service avait réservé un créneau ou une équipe, il est temps de le revoir.</p>
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{manifestation_url}}" style="display: inline-block; padding: 12px 24px; background: #d97706; color: white; text-decoration: none; border-radius: 4px;">Voir la manifestation</a>
      </p>
    </div>
    <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
      <p>© {{year}} {{site_name}}</p>
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['site_name', 'manifestation_title', 'changes', 'manifestation_url', 'year']),
    description: 'Changement de date, de livraison ou de récupération sur une manifestation'
  },
  {
    name: 'manifestation_material_changed',
    subject: '📦 Matériel modifié — {{manifestation_title}}',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #0369a1; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">Matériel modifié</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p>Le matériel demandé pour <strong>{{manifestation_title}}</strong> a été modifié :</p>
      <p style="background: #f0f9ff; border-left: 3px solid #0369a1; padding: 12px;">{{changes}}</p>
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{manifestation_url}}" style="display: inline-block; padding: 12px 24px; background: #0369a1; color: white; text-decoration: none; border-radius: 4px;">Voir le détail</a>
      </p>
    </div>
    <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
      <p>© {{year}} {{site_name}}</p>
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['site_name', 'manifestation_title', 'changes', 'manifestation_url', 'year']),
    description: 'Ajout ou retrait de matériel sur une manifestation'
  },
  {
    name: 'manifestation_delivery_reminder',
    subject: '🚚 Livraison dans {{days}} jour(s) — {{manifestation_title}}',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #ca8a04; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">Livraison à préparer</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p>La livraison de <strong>{{manifestation_title}}</strong> est prévue le <strong>{{delivery_date}}</strong>,
         dans {{days}} jour(s).</p>
      <p><strong>Lieu :</strong> {{delivery_address}}</p>
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{manifestation_url}}" style="display: inline-block; padding: 12px 24px; background: #ca8a04; color: white; text-decoration: none; border-radius: 4px;">Voir la manifestation</a>
      </p>
    </div>
    <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
      <p>© {{year}} {{site_name}}</p>
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['site_name', 'manifestation_title', 'delivery_date', 'delivery_address', 'days', 'manifestation_url', 'year']),
    description: 'Rappel envoyé quelques jours avant la livraison d\'une manifestation'
  },
  {
    name: 'manifestation_recovery_overdue',
    subject: '⚠️ Matériel non récupéré — {{manifestation_title}}',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #dc2626; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">Matériel non récupéré</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p>La récupération du matériel de <strong>{{manifestation_title}}</strong> était prévue le
         <strong>{{recovery_date}}</strong>. Elle n'a pas été enregistrée.</p>
      <p>Tant qu'elle ne l'est pas, le stock considère ce matériel comme encore dehors et
         il reste indisponible pour les autres manifestations.</p>
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{manifestation_url}}" style="display: inline-block; padding: 12px 24px; background: #dc2626; color: white; text-decoration: none; border-radius: 4px;">Saisir la récupération</a>
      </p>
    </div>
    <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
      <p>© {{year}} {{site_name}}</p>
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['site_name', 'manifestation_title', 'recovery_date', 'manifestation_url', 'year']),
    description: 'Alerte de récupération en retard sur une manifestation'
  },
  {
    name: 'ticket_nouveau',
    subject: '🎫 Nouvelle demande — {{titre}}',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #0284c7; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">Nouvelle demande</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p><strong>{{demandeur}}</strong> a ouvert une demande :</p>
      <p style="background: #f0f9ff; border-left: 3px solid #0284c7; padding: 12px; white-space: pre-wrap;">{{titre}}{{#if description}}

{{description}}{{/if}}</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding: 4px 8px; color: #6b7280;">Référence</td><td style="padding: 4px 8px;"><strong>{{reference}}</strong></td></tr>
        <tr><td style="padding: 4px 8px; color: #6b7280;">Catégorie</td><td style="padding: 4px 8px;">{{categorie}}{{#if sous_categorie}} › {{sous_categorie}}{{/if}}</td></tr>
        {{#if batiment}}<tr><td style="padding: 4px 8px; color: #6b7280;">Bâtiment</td><td style="padding: 4px 8px;">{{batiment}}</td></tr>{{/if}}
        {{#if materiel}}<tr><td style="padding: 4px 8px; color: #6b7280;">Matériel</td><td style="padding: 4px 8px;">{{materiel}}</td></tr>{{/if}}
        <tr><td style="padding: 4px 8px; color: #6b7280;">Demandeur</td><td style="padding: 4px 8px;">{{demandeur}}</td></tr>
        {{#if technicien}}<tr><td style="padding: 4px 8px; color: #6b7280;">Confiée à</td><td style="padding: 4px 8px;">{{technicien}}</td></tr>{{/if}}
        <tr><td style="padding: 4px 8px; color: #6b7280;">État</td><td style="padding: 4px 8px;">{{statut}}</td></tr>
      </table>
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{lien}}" style="display: inline-block; padding: 12px 24px; background: #0284c7; color: white; text-decoration: none; border-radius: 4px;">Ouvrir la demande</a>
      </p>
    </div>
    <div style="padding: 12px; text-align: center; color: #9ca3af; font-size: 12px;">
      {{site_name}} — {{year}}
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['reference', 'titre', 'description', 'categorie', 'sous_categorie', 'batiment', 'materiel', 'demandeur', 'technicien', 'statut', 'lien']),
    description: 'Envoyé à l’ouverture d’une demande'
  },
  {
    name: 'ticket_assigne',
    subject: '👤 Demande confiée — {{titre}}',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #4f46e5; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">Une demande vous est confiée</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p>Cette demande vient de vous être confiée, ou l’a été à votre service :</p>
      <p style="background: #eef2ff; border-left: 3px solid #4f46e5; padding: 12px; white-space: pre-wrap;">{{titre}}{{#if description}}

{{description}}{{/if}}</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding: 4px 8px; color: #6b7280;">Référence</td><td style="padding: 4px 8px;"><strong>{{reference}}</strong></td></tr>
        <tr><td style="padding: 4px 8px; color: #6b7280;">Catégorie</td><td style="padding: 4px 8px;">{{categorie}}{{#if sous_categorie}} › {{sous_categorie}}{{/if}}</td></tr>
        {{#if batiment}}<tr><td style="padding: 4px 8px; color: #6b7280;">Bâtiment</td><td style="padding: 4px 8px;">{{batiment}}</td></tr>{{/if}}
        {{#if materiel}}<tr><td style="padding: 4px 8px; color: #6b7280;">Matériel</td><td style="padding: 4px 8px;">{{materiel}}</td></tr>{{/if}}
        <tr><td style="padding: 4px 8px; color: #6b7280;">Demandeur</td><td style="padding: 4px 8px;">{{demandeur}}</td></tr>
        {{#if technicien}}<tr><td style="padding: 4px 8px; color: #6b7280;">Confiée à</td><td style="padding: 4px 8px;">{{technicien}}</td></tr>{{/if}}
        <tr><td style="padding: 4px 8px; color: #6b7280;">État</td><td style="padding: 4px 8px;">{{statut}}</td></tr>
      </table>
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{lien}}" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 4px;">Ouvrir la demande</a>
      </p>
    </div>
    <div style="padding: 12px; text-align: center; color: #9ca3af; font-size: 12px;">
      {{site_name}} — {{year}}
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['reference', 'titre', 'description', 'categorie', 'sous_categorie', 'batiment', 'materiel', 'demandeur', 'technicien', 'statut', 'lien']),
    description: 'Envoyé quand une demande est confiée à quelqu’un ou à un service'
  },
  {
    name: 'ticket_a_valider',
    subject: '✅ Clôture à valider — {{titre}}',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #0d9488; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">Une clôture attend votre validation</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p>{{#if technicien}}{{technicien}} a terminé{{else}}Un agent a terminé{{/if}} cette demande. Relisez le temps passé et les personnes qui ont travaillé, corrigez-les au besoin, puis validez — ou renvoyez-la avec ce qui reste à faire.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding: 4px 8px; color: #6b7280;">Référence</td><td style="padding: 4px 8px;"><strong>{{reference}}</strong></td></tr>
        <tr><td style="padding: 4px 8px; color: #6b7280;">Demande</td><td style="padding: 4px 8px;">{{titre}}</td></tr>
        <tr><td style="padding: 4px 8px; color: #6b7280;">Catégorie</td><td style="padding: 4px 8px;">{{categorie}}{{#if sous_categorie}} › {{sous_categorie}}{{/if}}</td></tr>
        {{#if batiment}}<tr><td style="padding: 4px 8px; color: #6b7280;">Bâtiment</td><td style="padding: 4px 8px;">{{batiment}}</td></tr>{{/if}}
        <tr><td style="padding: 4px 8px; color: #6b7280;">Demandeur</td><td style="padding: 4px 8px;">{{demandeur}}</td></tr>
      </table>
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{lien}}" style="display: inline-block; padding: 12px 24px; background: #0d9488; color: white; text-decoration: none; border-radius: 4px;">Contrôler et valider</a>
      </p>
    </div>
    <div style="padding: 12px; text-align: center; color: #9ca3af; font-size: 12px;">
      {{site_name}} — {{year}}
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['reference', 'titre', 'categorie', 'sous_categorie', 'batiment', 'demandeur', 'technicien', 'lien']),
    description: 'Envoyé aux superviseurs d’une catégorie quand un agent non autonome termine une demande'
  },
  {
    name: 'ticket_message',
    subject: '💬 Nouveau message — {{titre}}',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #7c3aed; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">Nouveau message</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p>Un message a été ajouté à la demande <strong>{{titre}}</strong> :</p>
      <p style="background: #f5f3ff; border-left: 3px solid #7c3aed; padding: 12px; white-space: pre-wrap;">{{message}}</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding: 4px 8px; color: #6b7280;">Référence</td><td style="padding: 4px 8px;"><strong>{{reference}}</strong></td></tr>
        <tr><td style="padding: 4px 8px; color: #6b7280;">Catégorie</td><td style="padding: 4px 8px;">{{categorie}}{{#if sous_categorie}} › {{sous_categorie}}{{/if}}</td></tr>
        {{#if batiment}}<tr><td style="padding: 4px 8px; color: #6b7280;">Bâtiment</td><td style="padding: 4px 8px;">{{batiment}}</td></tr>{{/if}}
        {{#if materiel}}<tr><td style="padding: 4px 8px; color: #6b7280;">Matériel</td><td style="padding: 4px 8px;">{{materiel}}</td></tr>{{/if}}
        <tr><td style="padding: 4px 8px; color: #6b7280;">Demandeur</td><td style="padding: 4px 8px;">{{demandeur}}</td></tr>
        {{#if technicien}}<tr><td style="padding: 4px 8px; color: #6b7280;">Confiée à</td><td style="padding: 4px 8px;">{{technicien}}</td></tr>{{/if}}
        <tr><td style="padding: 4px 8px; color: #6b7280;">État</td><td style="padding: 4px 8px;">{{statut}}</td></tr>
      </table>
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{lien}}" style="display: inline-block; padding: 12px 24px; background: #7c3aed; color: white; text-decoration: none; border-radius: 4px;">Ouvrir la demande</a>
      </p>
    </div>
    <div style="padding: 12px; text-align: center; color: #9ca3af; font-size: 12px;">
      {{site_name}} — {{year}}
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['reference', 'titre', 'message', 'categorie', 'batiment', 'demandeur', 'technicien', 'statut', 'lien']),
    description: 'Envoyé quand quelqu’un écrit dans le fil d’une demande'
  },
  {
    name: 'ticket_statut',
    subject: '🔄 {{titre}} — {{statut}}',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #0891b2; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">État modifié</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p>La demande <strong>{{titre}}</strong> est passée de <strong>{{ancien_statut}}</strong> à <strong>{{statut}}</strong>.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding: 4px 8px; color: #6b7280;">Référence</td><td style="padding: 4px 8px;"><strong>{{reference}}</strong></td></tr>
        <tr><td style="padding: 4px 8px; color: #6b7280;">Catégorie</td><td style="padding: 4px 8px;">{{categorie}}{{#if sous_categorie}} › {{sous_categorie}}{{/if}}</td></tr>
        {{#if batiment}}<tr><td style="padding: 4px 8px; color: #6b7280;">Bâtiment</td><td style="padding: 4px 8px;">{{batiment}}</td></tr>{{/if}}
        {{#if materiel}}<tr><td style="padding: 4px 8px; color: #6b7280;">Matériel</td><td style="padding: 4px 8px;">{{materiel}}</td></tr>{{/if}}
        <tr><td style="padding: 4px 8px; color: #6b7280;">Demandeur</td><td style="padding: 4px 8px;">{{demandeur}}</td></tr>
        {{#if technicien}}<tr><td style="padding: 4px 8px; color: #6b7280;">Confiée à</td><td style="padding: 4px 8px;">{{technicien}}</td></tr>{{/if}}
        <tr><td style="padding: 4px 8px; color: #6b7280;">État</td><td style="padding: 4px 8px;">{{statut}}</td></tr>
      </table>
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{lien}}" style="display: inline-block; padding: 12px 24px; background: #0891b2; color: white; text-decoration: none; border-radius: 4px;">Ouvrir la demande</a>
      </p>
    </div>
    <div style="padding: 12px; text-align: center; color: #9ca3af; font-size: 12px;">
      {{site_name}} — {{year}}
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['reference', 'titre', 'statut', 'ancien_statut', 'categorie', 'batiment', 'demandeur', 'technicien', 'lien']),
    description: 'Envoyé à chaque changement d’état qui ne clôt pas la demande'
  },
  {
    name: 'ticket_resolu',
    subject: '✅ {{titre}} — {{statut}}',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #16a34a; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">Demande close</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p>La demande <strong>{{titre}}</strong> est close : <strong>{{statut}}</strong>.</p>
      <p>Si le problème persiste, répondez dans le fil plutôt que d’ouvrir une nouvelle demande : l’historique reste au même endroit.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding: 4px 8px; color: #6b7280;">Référence</td><td style="padding: 4px 8px;"><strong>{{reference}}</strong></td></tr>
        <tr><td style="padding: 4px 8px; color: #6b7280;">Catégorie</td><td style="padding: 4px 8px;">{{categorie}}{{#if sous_categorie}} › {{sous_categorie}}{{/if}}</td></tr>
        {{#if batiment}}<tr><td style="padding: 4px 8px; color: #6b7280;">Bâtiment</td><td style="padding: 4px 8px;">{{batiment}}</td></tr>{{/if}}
        {{#if materiel}}<tr><td style="padding: 4px 8px; color: #6b7280;">Matériel</td><td style="padding: 4px 8px;">{{materiel}}</td></tr>{{/if}}
        <tr><td style="padding: 4px 8px; color: #6b7280;">Demandeur</td><td style="padding: 4px 8px;">{{demandeur}}</td></tr>
        {{#if technicien}}<tr><td style="padding: 4px 8px; color: #6b7280;">Confiée à</td><td style="padding: 4px 8px;">{{technicien}}</td></tr>{{/if}}
        <tr><td style="padding: 4px 8px; color: #6b7280;">État</td><td style="padding: 4px 8px;">{{statut}}</td></tr>
      </table>
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{lien}}" style="display: inline-block; padding: 12px 24px; background: #16a34a; color: white; text-decoration: none; border-radius: 4px;">Ouvrir la demande</a>
      </p>
    </div>
    <div style="padding: 12px; text-align: center; color: #9ca3af; font-size: 12px;">
      {{site_name}} — {{year}}
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['reference', 'titre', 'statut', 'ancien_statut', 'categorie', 'batiment', 'demandeur', 'technicien', 'lien']),
    description: 'Envoyé quand une demande est résolue ou refusée'
  },
  {
    name: 'ticket_echeance',
    subject: '⏰ Délai dépassé — {{titre}}',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #dc2626; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">Délai dépassé</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p>Le délai <strong>{{echeance}}</strong> de cette demande est dépassé, et elle n’est pas close :</p>
      <p style="background: #fef2f2; border-left: 3px solid #dc2626; padding: 12px; white-space: pre-wrap;">{{titre}}</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding: 4px 8px; color: #6b7280;">Référence</td><td style="padding: 4px 8px;"><strong>{{reference}}</strong></td></tr>
        <tr><td style="padding: 4px 8px; color: #6b7280;">Catégorie</td><td style="padding: 4px 8px;">{{categorie}}{{#if sous_categorie}} › {{sous_categorie}}{{/if}}</td></tr>
        {{#if batiment}}<tr><td style="padding: 4px 8px; color: #6b7280;">Bâtiment</td><td style="padding: 4px 8px;">{{batiment}}</td></tr>{{/if}}
        {{#if materiel}}<tr><td style="padding: 4px 8px; color: #6b7280;">Matériel</td><td style="padding: 4px 8px;">{{materiel}}</td></tr>{{/if}}
        <tr><td style="padding: 4px 8px; color: #6b7280;">Demandeur</td><td style="padding: 4px 8px;">{{demandeur}}</td></tr>
        {{#if technicien}}<tr><td style="padding: 4px 8px; color: #6b7280;">Confiée à</td><td style="padding: 4px 8px;">{{technicien}}</td></tr>{{/if}}
        <tr><td style="padding: 4px 8px; color: #6b7280;">État</td><td style="padding: 4px 8px;">{{statut}}</td></tr>
      </table>
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{lien}}" style="display: inline-block; padding: 12px 24px; background: #dc2626; color: white; text-decoration: none; border-radius: 4px;">Ouvrir la demande</a>
      </p>
    </div>
    <div style="padding: 12px; text-align: center; color: #9ca3af; font-size: 12px;">
      {{site_name}} — {{year}}
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['reference', 'titre', 'echeance', 'categorie', 'batiment', 'demandeur', 'technicien', 'statut', 'lien']),
    description: 'Envoyé une seule fois, quand un délai de prise en charge ou de résolution est passé'
  },
  {
    name: 'batiment_echeance',
    subject: '{{#if en_retard}}⚠️ Contrôle en retard{{else}}⏰ Contrôle à prévoir{{/if}} — {{rubrique}} ({{site_nom}})',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: {{#if en_retard}}#dc2626{{else}}#d97706{{/if}}; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">{{#if en_retard}}Contrôle en retard{{else}}Contrôle à prévoir{{/if}}</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p>{{#if en_retard}}L'échéance de ce contrôle est passée depuis le <strong>{{echeance}}</strong>.{{else}}Ce contrôle doit être réalisé avant le <strong>{{echeance}}</strong>.{{/if}}</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding: 4px 8px; color: #6b7280;">Bâtiment</td><td style="padding: 4px 8px;"><strong>{{site_nom}}</strong></td></tr>
        <tr><td style="padding: 4px 8px; color: #6b7280;">Contrôle</td><td style="padding: 4px 8px;">{{rubrique}}{{#if libelle}} — {{libelle}}{{/if}}</td></tr>
        {{#if derniere_realisation}}<tr><td style="padding: 4px 8px; color: #6b7280;">Dernière réalisation</td><td style="padding: 4px 8px;">{{derniere_realisation}}</td></tr>{{/if}}
      </table>
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{site_url}}/{{chemin}}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 4px;">Voir les contrôles du bâtiment</a>
      </p>
    </div>
    <div style="padding: 12px; text-align: center; color: #9ca3af; font-size: 12px;">
      {{site_name}} — {{year}}
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['site_nom', 'rubrique', 'libelle', 'echeance', 'en_retard', 'derniere_realisation', 'chemin']),
    description: "Envoyé aux gestionnaires d'un bâtiment quand un contrôle entre dans son délai de rappel ou passe son échéance"
  },
  {
    name: 'batiment_contrat',
    subject: '{{#if tacite}}📑 Contrat à dénoncer avant le {{date_cle}}{{else}}📑 Contrat qui se termine le {{date_cle}}{{/if}} — {{objet}}',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #d97706; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">{{#if tacite}}Un contrat va se reconduire{{else}}Un contrat se termine{{/if}}</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p>{{#if tacite}}Ce contrat se reconduit seul le <strong>{{fin}}</strong>. Pour le dénoncer, le préavis impose d'agir avant le <strong>{{date_cle}}</strong>.{{else}}Ce contrat prend fin le <strong>{{date_cle}}</strong> : c'est le moment de le renouveler ou de relancer une consultation.{{/if}}</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding: 4px 8px; color: #6b7280;">Contrat</td><td style="padding: 4px 8px;"><strong>{{objet}}</strong>{{#if reference}} ({{reference}}){{/if}}</td></tr>
        {{#if entreprise}}<tr><td style="padding: 4px 8px; color: #6b7280;">Entreprise</td><td style="padding: 4px 8px;">{{entreprise}}</td></tr>{{/if}}
        <tr><td style="padding: 4px 8px; color: #6b7280;">Bâtiments</td><td style="padding: 4px 8px;">{{sites}}</td></tr>
      </table>
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{site_url}}/{{chemin}}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 4px;">Voir le contrat</a>
      </p>
    </div>
    <div style="padding: 12px; text-align: center; color: #9ca3af; font-size: 12px;">
      {{site_name}} — {{year}}
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['objet', 'reference', 'entreprise', 'sites', 'tacite', 'fin', 'date_cle', 'chemin']),
    description: "Envoyé aux gestionnaires des bâtiments d'un contrat de maintenance un mois avant sa date de préavis, ou sa fin"
  },
  {
    name: 'batiment_document_depose',
    subject: '📄 Document à valider — {{titre}} ({{site_nom}})',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #2563eb; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">Un document attend votre validation</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding: 4px 8px; color: #6b7280;">Bâtiment</td><td style="padding: 4px 8px;"><strong>{{site_nom}}</strong></td></tr>
        <tr><td style="padding: 4px 8px; color: #6b7280;">Titre</td><td style="padding: 4px 8px;">{{titre}}</td></tr>
        <tr><td style="padding: 4px 8px; color: #6b7280;">Objet</td><td style="padding: 4px 8px;">{{rubrique}}</td></tr>
        {{#if date_document}}<tr><td style="padding: 4px 8px; color: #6b7280;">Date du document</td><td style="padding: 4px 8px;">{{date_document}}</td></tr>{{/if}}
        <tr><td style="padding: 4px 8px; color: #6b7280;">Déposé par</td><td style="padding: 4px 8px;">{{depose_par}}</td></tr>
      </table>
      {{#if commentaire}}<p style="background: #eff6ff; border-left: 3px solid #2563eb; padding: 12px; white-space: pre-wrap;">{{commentaire}}</p>{{/if}}
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{site_url}}/{{chemin}}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 4px;">Relire et valider</a>
      </p>
    </div>
    <div style="padding: 12px; text-align: center; color: #9ca3af; font-size: 12px;">
      {{site_name}} — {{year}}
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['site_nom', 'titre', 'rubrique', 'date_document', 'depose_par', 'commentaire', 'chemin']),
    description: "Envoyé aux gestionnaires d'un bâtiment quand un document y est déposé et attend d'être validé"
  },
  {
    name: 'batiment_document_refuse',
    subject: 'Document refusé — {{titre}} ({{site_nom}})',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #6b7280; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">Document refusé</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p>Bonjour {{first_name}},</p>
      <p>Le document <strong>{{titre}}</strong> déposé pour <strong>{{site_nom}}</strong> n'a pas été retenu, pour la raison suivante :</p>
      <p style="background: #fef2f2; border-left: 3px solid #dc2626; padding: 12px; white-space: pre-wrap;">{{motif}}</p>
      <p>Vous pouvez déposer une version corrigée.</p>
    </div>
    <div style="padding: 12px; text-align: center; color: #9ca3af; font-size: 12px;">
      {{site_name}} — {{year}}
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['first_name', 'site_nom', 'titre', 'motif']),
    description: "Envoyé à la personne qui a déposé un document de bâtiment quand il est refusé"
  },
  {
    name: 'entreprise_acces',
    subject: 'Votre accès à l\'espace documents — {{site_name}}',
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #2563eb; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">Votre espace documents</h1>
    </div>
    <div style="padding: 20px; background: #f9fafb;">
      <p>Bonjour,</p>
      <p>{{site_name}} ouvre à <strong>{{entreprise}}</strong> un espace pour consulter les documents qui vous concernent et déposer vos rapports (vérifications, contrôles, factures…).</p>
      <p style="text-align: center; margin: 25px 0;">
        <a href="{{lien}}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 4px;">Ouvrir l'espace documents</a>
      </p>
      {{#if avec_code}}
      <p>Votre code d'accès :</p>
      <p style="text-align: center; font-family: 'Courier New', monospace; font-size: 26px; letter-spacing: 4px; background: #fff; border: 1px dashed #93c5fd; padding: 12px;"><strong>{{code}}</strong></p>
      {{else}}
      <p>Votre code d'accès vous sera communiqué séparément.</p>
      {{/if}}
      <p style="font-size: 13px; color: #6b7280;">Ce code est propre à votre entreprise : il reste valable tant qu'il n'est pas remplacé{{#if fin}}, et jusqu'au {{fin}}{{/if}}. Si vous recevez un nouveau code, l'ancien ne fonctionne plus.</p>
      <p style="font-size: 13px; color: #6b7280;">Si le bouton ne s'ouvre pas, copiez cette adresse : {{lien}}</p>
    </div>
    <div style="padding: 12px; text-align: center; color: #9ca3af; font-size: 12px;">
      {{site_name}} — {{year}}
    </div>
  </div>
</body>
</html>`,
    variables: JSON.stringify(['entreprise', 'lien', 'code', 'avec_code', 'fin']),
    description: "Envoyé à une entreprise extérieure et à ses contacts quand un gestionnaire lui ouvre (ou renouvelle) l'accès au portail des documents"
  },
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
    // `track_mileage` a disparu : le relevé dépend maintenant des compteurs
    // déclarés par la catégorie du matériel, et non d'un drapeau valable pour
    // tout le parc à la fois — tondeuses et tables comprises.
    config: JSON.stringify({
      fuel_types: ['Diesel', 'Essence SP95', 'Essence SP98', 'E85', 'GPL', 'Électrique'],
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
      reminder_days: [30, 15, 7]
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
  },
  {
    name: 'Import / Export',
    slug: 'import-export',
    version: '1.0.0',
    description: 'Import et export de matériels au format Excel ou CSV',
    author: 'Système',
    icon: 'FileSpreadsheet',
    plugin_type: 'menu',
    route: 'import-export',
    is_system: 1,
    is_active: 1,
    config: JSON.stringify({
      max_file_size_mb: 10,
      allowed_formats: ['csv', 'xlsx', 'xls'],
      export_formats: ['xlsx', 'csv']
    })
  },
  {
    name: 'Manifestations',
    slug: 'manifestations',
    version: '1.0.0',
    description: 'Gestion des manifestations avec prêt et suivi de matériel, stock, livraison et récupération',
    author: 'Système',
    icon: 'party-popper',
    plugin_type: 'menu',
    route: 'manifestations',
    is_system: 1,
    is_active: 1,
    config: JSON.stringify({
      statuses: ['draft', 'validated', 'delivered', 'recovered', 'archived', 'cancelled'],
      enable_pdf_export: true,
      enable_stock_management: true
    })
  },
  {
    name: 'Espaces Verts',
    slug: 'espaces-verts',
    version: '1.0.0',
    description: 'Gestion des espaces verts, arbres, mobilier urbain et interventions',
    author: 'Système',
    icon: 'tree-pine',
    plugin_type: 'menu',
    route: 'espaces-verts',
    is_system: 1,
    is_active: 1,
    config: JSON.stringify({
      space_types: ['parc', 'jardin', 'square', 'rond_point', 'allee', 'autre'],
      element_types: ['arbre', 'haie', 'massif', 'pelouse', 'mobilier', 'eclairage', 'arrosage', 'cloture', 'autre'],
      condition_states: ['bon', 'moyen', 'mauvais', 'danger', 'remplace']
    })
  },
  {
    name: 'Clés et badges',
    slug: 'cles',
    version: '1.0.0',
    description: 'Clés, badges et trousseaux : ce qu\'ils ouvrent, leur coût et leur traçabilité',
    author: 'Système',
    icon: 'key-round',
    plugin_type: 'menu',
    route: 'cles',
    is_system: 1,
    is_active: 1,
    // Les préfixes sont un point de départ, pas une liste fermée : chaque
    // commune nomme ses services autrement, et le numéro reste modifiable à la
    // création du trousseau.
    config: JSON.stringify({
      prefixes: [
        { code: 'TST', label: 'Trousseau Service Technique' },
        { code: 'TMR', label: 'Trousseau Mairie' },
        { code: 'TEC', label: 'Trousseau École' },
        { code: 'TPM', label: 'Trousseau Police Municipale' }
      ],
      etats_retour: ['bon', 'usé', 'endommagé', 'perdu'],
      formats_etiquettes: ['L7160', 'L7163', 'L7165', 'L7651', 'L6008']
    })
  },
  {
    name: 'Plannings et heures',
    slug: 'plannings',
    version: '1.0.0',
    description: 'Temps passé par tâche et par catégorie : saisie, planning, statistiques et rapports',
    author: 'Système',
    icon: 'clock',
    plugin_type: 'menu',
    route: 'plannings',
    is_system: 1,
    is_active: 1,
    // Un point de départ, pas une liste fermée : un agent crée la catégorie
    // qui lui manque depuis le formulaire de saisie. Une liste vide au premier
    // démarrage renverrait tout le monde vers « Autre », et la statistique
    // qu'on cherche à bâtir s'effondrerait dans cette case-là.
    config: JSON.stringify({
      categories_initiales: [
        'Livraison Manifestation',
        'Entretien du matériel',
        'Espaces verts',
        'Voirie',
        'Interventions bâtiments',
        'Réunion'
      ]
    })
  },
  {
    name: 'Bâtiments',
    slug: 'batiments',
    version: '1.0.0',
    description: 'Contrôles obligatoires, documents et échéances des bâtiments',
    author: 'Système',
    icon: 'building-2',
    plugin_type: 'menu',
    route: 'batiments',
    is_system: 1,
    is_active: 1,
    // Le catalogue des contrôles ne vit pas ici mais dans `batiments.service`
    // (`CATALOGUE_RUBRIQUES`) : il est semé code par code, et non une seule
    // fois sur une table vide.
    config: JSON.stringify({})
  },
  {
    name: 'Tickets',
    slug: 'tickets',
    version: '1.0.0',
    description: 'Demandes internes : ouverture, routage automatique, échanges et suivi',
    author: 'Système',
    icon: 'life-buoy',
    plugin_type: 'menu',
    route: 'tickets',
    is_system: 1,
    is_active: 1,
    // Un point de départ, pas une liste fermée. Les six statuts sont ceux que
    // la commune employait dans GestSup : les retrouver au premier démarrage
    // évite de les faire ressaisir, et de les voir diverger d'un service à
    // l'autre. La liste vit dans la configuration du plugin pour se modifier à
    // un seul endroit.
    config: JSON.stringify({
      statuts_initiaux: [
        { nom: 'À traiter', couleur: 'red', ouvert: true, defaut: true, final: false, systeme: true },
        { nom: 'En cours', couleur: 'blue', ouvert: true, defaut: false, final: false, systeme: false },
        { nom: 'En attente de retour', couleur: 'amber', ouvert: true, defaut: false, final: false, systeme: false },
        { nom: 'En commande', couleur: 'purple', ouvert: true, defaut: false, final: false, systeme: false },
        // Résolue par un agent qui n'est pas autonome : attend son superviseur.
        // Voir la migration 046.
        { nom: 'À valider', couleur: 'teal', ouvert: false, defaut: false, final: false, systeme: true, validation: true },
        { nom: 'Résolu', couleur: 'green', ouvert: false, defaut: false, final: true, systeme: true },
        { nom: 'Refusé', couleur: 'gray', ouvert: false, defaut: false, final: true, systeme: false }
      ],
      categories_initiales: [
        { nom: 'Informatique', couleur: 'sky', visibilite: 'privee' },
        { nom: 'Bâtiment', couleur: 'amber', visibilite: 'site' },
        { nom: 'Voirie', couleur: 'stone', visibilite: 'site' },
        { nom: 'Espaces verts', couleur: 'green', visibilite: 'site' },
        { nom: 'Matériel et véhicules', couleur: 'indigo', visibilite: 'site' }
      ]
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

  await semerCategoriesPlanning();
  await semerReferentielTickets();
  await semerRubriquesBatiments();

  console.log('🎉 Seed terminé avec succès!');
}

/**
 * Le catalogue des contrôles obligatoires des bâtiments.
 *
 * Code par code, à chaque démarrage : une rubrique ajoutée au catalogue dans une
 * version future arrive ainsi sur les installations existantes, sans reposer
 * celles que la commune a renommées ou désactivées. Le catalogue et la règle
 * vivent dans le service, qui est seul à écrire ces lignes.
 */
async function semerRubriquesBatiments(): Promise<void> {
  try {
    const { semerRubriques } = await import('../services/batiments.service');
    const inserees = await semerRubriques();
    if (inserees > 0) console.log(`✅ ${inserees} contrôle(s) de bâtiment ajouté(s) au catalogue`);
  } catch (erreur) {
    // Base pas encore migrée : le reste du seed n'a pas à s'arrêter pour ça.
    console.warn('Catalogue des contrôles de bâtiment non semé :', (erreur as Error).message);
  }
}

/**
 * Quelques catégories de temps, pour que le premier écran ne soit pas vide.
 *
 * Elles ne sont posées qu'une fois, sur un référentiel encore vierge : les
 * reposer à chaque démarrage ferait réapparaître celles qu'une commune a
 * volontairement supprimées. La liste vient de la configuration du plugin,
 * pour qu'elle se modifie à un seul endroit.
 */
async function semerCategoriesPlanning(): Promise<void> {
  try {
    const deja = await db.queryOne('SELECT COUNT(*) as cnt FROM planning_categories');
    if (Number(deja?.cnt ?? 0) > 0) return;

    const plugin = DEFAULT_PLUGINS.find((p) => p.slug === 'plannings');
    const noms: string[] = JSON.parse(plugin?.config ?? '{}').categories_initiales ?? [];

    const { resoudreCategorie } = await import('../services/plannings.service');
    for (const nom of noms) await resoudreCategorie(nom, null);

    console.log('✅ Catégories de temps initiales insérées');
  } catch (erreur) {
    // Base pas encore migrée : le reste du seed n'a pas à s'arrêter pour ça.
    console.warn('Catégories de temps non insérées :', (erreur as Error).message);
  }
}

/**
 * Les statuts et catégories de demande, au premier démarrage.
 *
 * Posés une seule fois, sur un référentiel encore vierge. Les reposer à chaque
 * démarrage ferait réapparaître ce qu'une commune a volontairement renommé ou
 * retiré — et le renommage est prévu : ce sont ses statuts, pas ceux du code.
 *
 * Les listes viennent de la configuration du plugin, pour qu'elles se modifient
 * à un seul endroit. C'est le fonctionnement de `semerCategoriesPlanning()`.
 */
async function semerReferentielTickets(): Promise<void> {
  try {
    const deja = await db.queryOne('SELECT COUNT(*) as cnt FROM ticket_statuts');
    if (Number(deja?.cnt ?? 0) > 0) return;

    const plugin = DEFAULT_PLUGINS.find((p) => p.slug === 'tickets');
    const config = JSON.parse(plugin?.config ?? '{}');
    const maintenant = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // La normalisation vient du service, et non d'une copie locale : c'est elle
    // qui garde l'unicité des noms, et deux implémentations finiraient par
    // diverger d'un accent — donc par accepter un doublon que l'index refuse.
    const { normaliserCategorie } = await import('../services/ticketsReferentiel.service');
    const enSlug = (nom: string) =>
      normaliserCategorie(nom).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    for (const [rang, statut] of (config.statuts_initiaux ?? []).entries()) {
      await db.execute(
        `INSERT INTO ticket_statuts (nom, slug, couleur, ordre, is_ouvert, is_defaut, is_final, is_systeme, is_validation, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          statut.nom,
          enSlug(statut.nom),
          statut.couleur ?? null,
          rang + 1,
          statut.ouvert ? 1 : 0,
          statut.defaut ? 1 : 0,
          statut.final ? 1 : 0,
          statut.systeme ? 1 : 0,
          statut.validation ? 1 : 0,
          maintenant,
          maintenant,
        ]
      );
    }

    /*
     * Les catégories ne sont semées que si personne n'en a créé.
     *
     * Elles arrivent **sans service ni technicien** : le routage dépend de
     * l'organisation de la commune, que le code ne connaît pas. Les inventer
     * enverrait les demandes au hasard, ce qui est pire que de ne rien
     * envoyer — l'écran de réglage le signale et demande de les rattacher.
     *
     * La visibilité, elle, est posée : une demande informatique est
     * personnelle, un problème de bâtiment intéresse ceux qui y travaillent.
     * C'est le défaut qu'on veut, et il se corrige d'une case.
     */
    const dejaCat = await db.queryOne('SELECT COUNT(*) as cnt FROM ticket_categories');
    if (Number(dejaCat?.cnt ?? 0) === 0) {
      for (const [rang, categorie] of (config.categories_initiales ?? []).entries()) {
        const normalise = normaliserCategorie(categorie.nom);

        await db.execute(
          `INSERT INTO ticket_categories (nom, name_normalise, parent_id, parent_cle, couleur, ordre, is_active, visibilite, materiel_mode, site_mode, created_at, updated_at)
           VALUES (?, ?, NULL, 0, ?, ?, 1, ?, ?, ?, ?, ?)`,
          [
            categorie.nom,
            normalise,
            categorie.couleur ?? null,
            rang + 1,
            categorie.visibilite ?? 'privee',
            categorie.visibilite === 'site' ? 'optionnel' : 'aucun',
            'auto',
            maintenant,
            maintenant,
          ]
        );
      }
    }

    console.log('✅ Référentiel des demandes initialisé');
  } catch (erreur) {
    // Base pas encore migrée : le reste du seed n'a pas à s'arrêter pour ça.
    console.warn('Référentiel des demandes non initialisé :', (erreur as Error).message);
  }
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
