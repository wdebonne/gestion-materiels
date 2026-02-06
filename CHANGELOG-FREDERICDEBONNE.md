# Changelog

Toutes les modifications notables de ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/lang/fr/).

## [Non publié]

## [1.2.9] - 2026-02-04

### Ajouté
- **Plugin Carburant** : Gestion des stations de carburant (ajouter, modifier, supprimer)
- Bouton paramètres (icône engrenage) à côté de "Ajouter un plein" pour gérer les stations
- Champ Station avec autocomplétion basée sur la liste des stations enregistrées
- Table `fuel_stations` pour stocker les stations favorites
- Routes API CRUD pour les stations : GET, POST, PUT, DELETE

### Amélioré
- L'autocomplétion du champ Station fonctionne dans les modals d'ajout et de modification

## [1.2.8] - 2026-02-04

### Ajouté
- **Plugin Carburant** : Les administrateurs peuvent modifier et supprimer les entrées de l'historique carburant
- Boutons d'action (modifier/supprimer) dans le tableau carburant pour les admins
- Modal d'édition avec recalcul automatique du prix unitaire
- Confirmation avant suppression d'une entrée

### Backend
- Route PUT `/api/objects/:id/fuel/:entryId` pour modification
- La route DELETE existante est désormais utilisée depuis l'interface

## [1.2.7] - 2026-02-04

### Amélioré
- **Plugin Carburant** : Calcul automatique du prix unitaire (€/L) à partir du coût total et de la quantité
- **Plugin Carburant** : Le type de carburant est récupéré automatiquement depuis les champs personnalisés de l'objet
- **Plugin Carburant** : Affichage enrichi du tableau avec colonnes Type et Prix/L

### Corrigé
- Correction de l'erreur 500 lors de l'ajout d'un plein carburant
- Alignement des noms de champs entre frontend (`date`, `cost`) et backend (`entryDate`, `unitPrice`)
- Gestion correcte des valeurs NULL pour les champs optionnels

## [1.2.6] - 2026-02-04

### Amélioré
- La recherche filtre maintenant aussi sur les champs personnalisés
- Possibilité de rechercher par plaque d'immatriculation, marque, ou tout autre champ personnalisé

## [1.2.5] - 2026-02-04

### Corrigé
- Correction de l'affichage des champs personnalisés dans la fiche objet
- La route `/custom-fields/for-object/:id` résout maintenant correctement la catégorie parente via la sous-catégorie
- Les champs configurés (Marque, Numéro d'immatriculation, etc.) s'affichent maintenant correctement

## [1.2.4] - 2026-02-04

### Corrigé
- Correction de l'affichage de la catégorie dans la fiche objet quand l'objet est associé uniquement à une sous-catégorie
- La catégorie parente est maintenant récupérée via la sous-catégorie si `category_id` est NULL
- Correction de l'erreur "Catégorie non trouvée" lors du clic sur "Configurer les champs" depuis un objet

## [1.2.3] - 2026-02-04

### Corrigé
- Correction de l'erreur 400 Bad Request sur `/api/custom-fields/config` lors de la sauvegarde de la configuration des champs
- La validation express-validator n'acceptait pas les valeurs `null` pour `categoryId` et `subcategoryId`
- Ajout de `{ nullable: true }` aux validateurs optionnels pour accepter les valeurs nulles

## [1.2.2] - 2026-02-04

### Ajouté

#### Configuration des Champs Personnalisés
- Nouvelle page de configuration des champs par catégorie/sous-catégorie
- Possibilité de masquer les champs système (Catégorie, Sous-catégorie, etc.)
- Ajout de champs personnalisés avec différents types :
  - Texte, Nombre, Date, Liste déroulante, Zone de texte
  - Email, Téléphone, URL, Case à cocher
- Héritage des configurations : les sous-catégories héritent de leur catégorie parente
- Réorganisation de l'ordre d'affichage des champs (drag & drop)
- Réinitialisation aux valeurs par défaut
- Prévisualisation en temps réel de la configuration

#### API Champs Personnalisés
- Nouvelle route `/api/custom-fields` avec endpoints complets
- Table `custom_fields_config` pour stocker les configurations
- Support de la personnalisation par catégorie et sous-catégorie

#### Interface Utilisateur
- Bouton ⚙️ dans les pages catégorie/sous-catégorie pour configurer les champs
- Édition des champs personnalisés directement dans la fiche objet
- Affichage dynamique des champs selon la configuration
- Centrage du nom sur les cartes d'objets (ImageCard)

---

## [1.2.1] - 2026-02-04

### Ajouté

#### Menu Latéral Rétractable
- Bouton "Réduire" en bas du menu pour réduire/agrandir la sidebar
- État réduit : seules les icônes sont visibles (largeur 80px au lieu de 256px)
- Tooltips au survol des éléments en mode réduit
- Badges d'alertes compacts en mode réduit
- Persistance de l'état dans le localStorage (conservé après rechargement)
- Animations fluides de transition (300ms)
- Version affichée en format court en mode réduit

---

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
