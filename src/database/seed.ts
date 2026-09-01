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
