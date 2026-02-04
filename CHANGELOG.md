# Changelog

Toutes les modifications notables de ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/lang/fr/).

## [Non publié]

## [1.2.0] - 2026-02-04

### Ajouté

#### Interface Utilisateur Moderne
- Nouvelle palette de couleurs (Sky Blue) plus professionnelle
- Système d'ombres personnalisées (`shadow-soft`, `shadow-medium`, `shadow-hard`)
- Effet Glassmorphism sur la barre de navigation supérieure
- Fond d'écran avec dégradé radial subtil
- Scrollbars personnalisées plus fines et élégantes

### Modifié

#### Composants UI Redessinés
- **Boutons** : Dégradés subtils, effet d'enfoncement au clic (`active:scale`)
- **Cartes** : Ombres diffuses, animation de survol avec élévation
- **Champs de saisie** : Focus ring plus élégant (ring-4 avec opacité)
- **Sidebar** : Espacement amélioré, indicateurs d'état plus visibles
- **Header** : Semi-transparent avec backdrop-blur

#### Améliorations Visuelles
- Transitions fluides sur tous les éléments interactifs
- Couleurs d'accent plus cohérentes
- Meilleure hiérarchie visuelle dans la navigation

---

## [1.1.0] - 2026-02-04

### Ajouté

#### Système de Plugins Avancé
- Import de plugins via fichiers ZIP
- Création dynamique de tables de base de données depuis JSON
- Pages de plugins dynamiques définies en JSON
- API endpoints configurables dans les plugins
- Composants UI dynamiques : Header, Filtres, DataGrid, DataTable, Stats, Form
- Service `pluginAdvanced.service.ts` pour la gestion avancée
- Composant `DynamicPluginPage.tsx` pour le rendu des pages
- Route `/plugin/:pluginSlug` pour les plugins de type menu
- Exemples de plugins : image-manager, file-manager

#### Gestion des Plugins
- Types de plugins : `menu` (page dédiée) et `object` (associé aux objets)
- Association des plugins aux catégories et sous-catégories
- Route personnalisable pour chaque plugin
- Indicateurs visuels (tables, pages) dans la page de gestion

#### Documentation
- Guide de déploiement Portainer (`docs/DEPLOIEMENT_PORTAINER.md`)
- Documentation structure des plugins (`docs/PLUGIN_STRUCTURE.md`)
- README pour les exemples de plugins

#### Améliorations
- Compteur d'alertes en temps réel dans la navigation
- Navigation dynamique pour les plugins de type menu
- Gestion des permissions par catégorie/sous-catégorie

### Modifié
- Architecture des routes pour supporter les plugins dynamiques
- Layout pour distinguer les plugins built-in des plugins dynamiques
- Page de gestion des plugins avec import ZIP

---

## [1.0.0] - 2024-01-15

### Ajouté

#### Authentification & Utilisateurs
- Système d'authentification JWT avec tokens de rafraîchissement
- Trois rôles utilisateur : Administrateur, Superviseur, Utilisateur
- Page de connexion avec validation
- Fonctionnalité "Mot de passe oublié" avec envoi d'email
- Réinitialisation de mot de passe sécurisée avec token
- Page de profil utilisateur
- Gestion des utilisateurs (CRUD) pour les administrateurs

#### Gestion du matériel
- Système de catégories avec images
- Sous-catégories rattachées aux catégories
- Objets (équipements) avec fiches détaillées
- Navigation par cartes visuelles
- Upload d'images pour les catégories, sous-catégories et objets
- Champs personnalisables pour les objets

#### Plugins
- Architecture de plugins extensible
- **Plugin Carburant** : 
  - Enregistrement des pleins (date, quantité, prix, kilométrage)
  - Calcul automatique de la consommation
  - Statistiques et graphiques
- **Plugin Maintenance** :
  - Historique des interventions
  - Types de maintenance (préventive, corrective, révision)
  - Suivi des coûts
- **Plugin Contrôle Technique** :
  - Enregistrement des contrôles
  - Suivi des dates d'expiration
  - Alertes automatiques

#### Calendrier & Alertes
- Calendrier interactif avec FullCalendar
- Vues jour, semaine, mois
- Création d'événements par clic
- Modification par drag & drop
- Système d'alertes automatiques
- Notifications par email pour les alertes
- Alertes pour contrôles techniques expirés
- Alertes pour maintenances à venir

#### Administration
- Paramètres généraux du site :
  - Nom du site
  - Logo personnalisable
  - Favicon personnalisable
  - URL du site
  - Version
- Configuration SMTP complète :
  - Paramètres de connexion
  - Test d'envoi d'email
- Templates d'emails personnalisables :
  - Template de bienvenue
  - Template de réinitialisation de mot de passe
  - Template d'alertes
  - Variables dynamiques avec Handlebars
- Sauvegarde et restauration :
  - Création de sauvegardes automatiques et manuelles
  - Téléchargement des sauvegardes
  - Restauration depuis une sauvegarde
  - Suppression des anciennes sauvegardes
- Migration de base de données :
  - Support SQLite (par défaut)
  - Support MySQL/MariaDB
  - Assistant de migration SQLite → MySQL

#### Technique
- Backend Node.js avec Express et TypeScript
- Frontend React 18 avec TypeScript
- Base de données SQLite avec support MySQL
- Interface utilisateur avec Tailwind CSS
- Gestion d'état avec Zustand
- Requêtes API avec React Query
- Tâches planifiées avec node-cron
- Emails avec Nodemailer

#### Déploiement
- Dockerfile optimisé multi-stage
- Docker Compose avec services :
  - Application Node.js
  - MySQL (optionnel)
  - Nginx reverse proxy (optionnel)
- Configuration Nginx avec :
  - Rate limiting
  - Compression gzip
  - Support HTTPS/SSL
- Documentation complète

### Sécurité
- Mots de passe hashés avec bcrypt (12 rounds)
- Tokens JWT avec expiration
- Refresh tokens pour renouvellement automatique
- Validation des entrées utilisateur
- Protection contre les injections SQL
- Rate limiting sur les endpoints sensibles
- Headers de sécurité HTTP

---

## Types de changements

- `Ajouté` pour les nouvelles fonctionnalités
- `Modifié` pour les changements dans les fonctionnalités existantes
- `Déprécié` pour les fonctionnalités qui seront bientôt supprimées
- `Supprimé` pour les fonctionnalités supprimées
- `Corrigé` pour les corrections de bugs
- `Sécurité` pour les vulnérabilités corrigées
