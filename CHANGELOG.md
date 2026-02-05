# Changelog

Toutes les modifications notables de ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/lang/fr/).

## [Non publié]

## [1.2.27] - 2026-02-05

### Amélioré
- **Rafraîchissement automatique des alertes** : La liste des alertes se met à jour automatiquement après :
  - Ajout, modification ou suppression d'un plein carburant
  - Ajout, modification ou suppression d'un entretien
  - Ajout, modification ou suppression d'un contrôle technique
- **Compteur d'alertes synchronisé** : Le badge d'alertes dans le menu se met à jour en temps réel

## [1.2.26] - 2026-02-05

### Ajouté
- **Paramètres des alertes** : Nouveau bouton "Paramètres" sur la page Alertes permettant de configurer :
  - Le nombre de jours avant l'échéance pour déclencher une alerte (par type)
  - Le niveau de priorité par défaut (basse, moyenne, élevée) pour chaque type d'alerte
- Configuration distincte pour : Contrôle technique, Maintenance, Carburant, Autres alertes

### API
- `GET /api/alerts/settings` - Récupérer les paramètres des alertes
- `PUT /api/alerts/settings` - Mettre à jour les paramètres des alertes

### Amélioré
- **Service cron** : Utilise désormais les paramètres configurés pour déclencher les alertes
- **Calendrier** : Correction du chargement initial des événements

## [1.2.25] - 2026-02-05

### Corrigé
- **Calendrier - Affichage des en-têtes** : Les en-têtes de jours affichent maintenant les jours de la semaine (lun., mar., mer...) au lieu des numéros
- **Calendrier - Erreur 500 sur sync/status** : La route de statut de synchronisation retourne maintenant un statut par défaut en cas d'erreur au lieu d'une erreur 500

## [1.2.24] - 2026-02-05

### Amélioré
- **Rafraîchissement automatique des champs personnalisés** : La page de configuration des champs se rafraîchit automatiquement après la sauvegarde

## [1.2.23] - 2026-02-05

### Ajouté
- **Système de logs complet** : Nouveau menu "Logs" dans les paramètres (administrateurs uniquement)
- **Service de logs** : Enregistrement automatique des événements système avec niveaux (info, warning, error, debug, success) et catégories (auth, system, user, backup, plugin, database, email, api, security)
- **Page de gestion des logs** avec :
  - Statistiques en temps réel (total, 24h, 7j, 30j, erreurs, avertissements)
  - Filtrage avancé par niveau, catégorie, période et recherche textuelle
  - Pagination configurable (25, 50, 100, 200 par page)
  - Vue détaillée de chaque log (IP, user agent, requête, etc.)
  - Export des logs en CSV ou JSON
  - Suppression manuelle ou par filtres
- **Paramètres de logs configurables** :
  - Durée de rétention des logs (1-365 jours)
  - Nettoyage automatique des vieux logs
  - Activation/désactivation par niveau et catégorie
  - Options de logging (requêtes API, tentatives auth, événements système)
  - Limite d'export configurable
- **Logs automatiques** pour les événements importants :
  - Connexions réussies et échouées
  - Création de sauvegardes
  - Démarrage du serveur
  - Modifications des paramètres de logs

### API
- `GET /api/logs` - Récupérer les logs avec filtres et pagination
- `GET /api/logs/stats` - Statistiques des logs
- `GET /api/logs/settings` - Récupérer les paramètres de logs
- `PUT /api/logs/settings` - Modifier les paramètres de logs
- `GET /api/logs/export` - Exporter les logs (CSV/JSON)
- `POST /api/logs/cleanup` - Nettoyage manuel des vieux logs
- `DELETE /api/logs` - Supprimer des logs selon les filtres

## [1.2.22] - 2026-02-05

### Amélioré
- **Sélecteur de sous-catégories** : Désormais disponible à tous les niveaux (catégorie ET sous-catégorie)
- **Chargement des sous-catégories** : Les sous-catégories sont maintenant toujours chargées pour le sélecteur
- **Cohérence de l'interface** : Mêmes options de configuration disponibles partout

## [1.2.21] - 2026-02-05

### Corrigé
- **Sélecteur de sous-catégories** : Correction du bug où le sélecteur n'apparaissait pas toujours lors de la modification d'un champ au niveau catégorie
- **Chargement des sous-catégories** : Suppression de la condition `hasSubcategories` qui empêchait le chargement des sous-catégories dans certains cas

## [1.2.20] - 2026-02-05

### Ajouté
- **Restriction des champs par sous-catégorie** : Possibilité de limiter un champ personnalisé à certaines sous-catégories seulement
- **Sélecteur de sous-catégories applicables** : Nouvelle option dans les modales d'ajout et d'édition de champ au niveau catégorie
- **Badge de restriction** : Affichage d'un badge orange indiquant à quelle(s) sous-catégorie(s) un champ s'applique
- **Migration automatique** : Ajout de la colonne `applicable_subcategories` dans la table `custom_fields_config`

### Amélioré
- **Filtrage intelligent** : Les champs restreints à certaines sous-catégories n'apparaissent que pour les objets concernés
- **Interface utilisateur** : Le sélecteur n'apparaît que lors de la configuration au niveau catégorie

### Exemple d'utilisation
- Créer un champ "Pas de la chaîne" au niveau "Matériels"
- Cocher uniquement "Tronçonneuses" dans les sous-catégories applicables
- Ce champ n'apparaîtra que sur les tronçonneuses, pas sur les tondeuses

## [1.2.19] - 2026-02-05

### Ajouté
- **Configuration des champs par sous-catégorie** : Possibilité de définir des champs personnalisés différents pour chaque sous-catégorie
- **Badge de niveau de configuration** : Indication claire dans l'interface si on configure une catégorie ou une sous-catégorie
- **Indication d'héritage** : Message clair quand une sous-catégorie hérite de la configuration de sa catégorie parente
- **Bouton "Créer config. spécifique"** : Permet de créer facilement une configuration propre à une sous-catégorie

### Amélioré
- **Boutons de configuration des champs** : Tooltips explicatifs sur les pages Catégorie et Sous-catégorie
- **Texte du bouton** : Affichage "Champs" avec icône pour plus de clarté
- **Message d'héritage amélioré** : Affiche le nom de la catégorie parente et une explication détaillée

### Exemple d'utilisation
- Une tronçonneuse et une tondeuse sont dans la catégorie "Matériels"
- Mais peuvent avoir des champs différents (ex: "Pas de la chaîne" pour les tronçonneuses uniquement)
- Chaque sous-catégorie peut avoir sa propre configuration de champs

## [1.2.18] - 2026-02-05

### Corrigé
- **Système de sauvegarde SQLite** : Ajout d'un checkpoint WAL avant la sauvegarde pour garantir que toutes les données sont écrites dans le fichier principal
- **Restauration des sauvegardes** : Suppression des fichiers WAL (-wal et -shm) existants avant la restauration pour éviter les conflits de données
- **Seed admin** : Le seed vérifie maintenant s'il existe un utilisateur admin (par rôle) au lieu de vérifier un email spécifique, évitant ainsi la recréation d'un compte admin par défaut lors d'une restauration

## [1.2.17] - 2026-02-05

### Ajouté
- **Calendrier modernisé** avec interface entièrement repensée
- **Mini-calendrier** dans un panneau latéral repliable pour navigation rapide
- **Navigation libre** dans le temps (plus de limitation à 2026)
- Boutons de navigation par année (double chevrons) et par mois (simple chevron)
- Bouton "Aujourd'hui" pour retourner à la date courante
- **Sélecteur de vue** moderne avec icônes (Mois, Semaine, Jour, Liste)
- **Recherche intégrée** pour filtrer les événements par titre, description ou matériel
- **Filtres par type** d'événement (Maintenance, Réunion, Échéance, Rappel, Autre)
- **Liste des événements du jour** sélectionné dans le panneau latéral
- Indicateurs visuels des jours avec événements dans le mini-calendrier
- **Synchronisation Microsoft Outlook** via Azure AD (Client ID, Secret, Tenant ID)
- **Synchronisation CalDAV** compatible Nextcloud, Synology, iCloud, Google Calendar
- Modal de configuration de synchronisation avec test de connexion
- Bouton de synchronisation manuelle avec indicateur de statut
- Nouvelles colonnes `source` et `external_id` dans la table calendar_events

### Amélioré
- Interface du calendrier plus moderne et intuitive
- Navigation fluide entre les mois et années
- Meilleure gestion des événements externes (non modifiables localement)
- Affichage du type de source pour les événements synchronisés (badge Outlook/CalDAV)

### API
- `GET /api/calendar/sync/status` - Statut de synchronisation
- `GET /api/calendar/sync/config` - Configuration de synchronisation
- `POST /api/calendar/sync/outlook/config` - Configurer Outlook
- `POST /api/calendar/sync/caldav/config` - Configurer CalDAV
- `POST /api/calendar/sync/outlook/test` - Tester connexion Outlook
- `POST /api/calendar/sync/caldav/test` - Tester connexion CalDAV
- `POST /api/calendar/sync` - Synchroniser tous les calendriers
- `DELETE /api/calendar/sync/outlook` - Déconnecter Outlook
- `DELETE /api/calendar/sync/caldav` - Déconnecter CalDAV

## [1.2.16] - 2026-02-05

### Ajouté
- **Pièces jointes** dans les plugins Carburant, Entretien et Contrôle technique
- Nouveau composant `FileUpload` pour uploader des PDFs et images (drag & drop supporté)
- Nouveau composant `AttachmentViewer` pour visualiser les pièces jointes
- Nouvel endpoint API `/api/upload/file` pour uploader des fichiers (images + PDF)
- Colonne "Pièces jointes" dans les tableaux avec prévisualisation
- Support des formats : JPEG, PNG, GIF, WebP, SVG, PDF
- Prévisualisation des images et PDFs en modal
- Conservation des pièces jointes lors de la modification des entrées

### Amélioré
- Migration automatique de la base de données pour ajouter la colonne `attachments`

### Corrigé
- Correction des erreurs TypeScript pour le build (PORT converti en number, jwt.SignOptions)

## [1.2.15] - 2026-02-04

### Ajouté
- **Édition des champs personnalisés** dans la page Configuration des champs
- Bouton crayon (modifier) pour chaque champ personnalisé
- Modal d'édition permettant de modifier : nom technique, libellé, type, options, champ obligatoire

### Corrigé
- Correction de la synchronisation du kilométrage vers les champs personnalisés
- Le kilométrage saisi dans les plugins (Carburant, Entretien, Contrôle technique) met maintenant à jour correctement le champ "Kilométrage" dans les informations détaillées

## [1.2.14] - 2026-02-04

### Ajouté
- **Tri des tableaux plugins** : Bouton double flèche (haut/bas) pour inverser l'ordre des listes
- Choix entre "Plus récent en premier" et "Plus ancien en premier"
- Fonctionne sur Carburant, Entretiens et Contrôle technique
- Tri par défaut : plus récent en premier

## [1.2.13] - 2026-02-04

### Amélioré
- **Champs de filtrage** : Fond blanc pour une meilleure cohérence visuelle avec le style du site
- **Recherche par date** : Les filtres recherchent maintenant aussi dans les dates formatées (ex: "février", "2026")

### Corrigé
- Correction du filtrage carburant qui ne filtrait pas correctement sur les dates affichées
- Amélioration de la recherche dans les tableaux Entretiens et Contrôle technique

## [1.2.12] - 2026-02-04

### Ajouté
- **Filtres de recherche** sur les tableaux plugins (Carburant, Entretiens, Contrôle technique)
- Champ de recherche intégré dans l'en-tête de chaque tableau
- Filtrage en temps réel sur tous les champs visibles (date, station, coût, type, prestataire, centre, etc.)
- Message "Aucun résultat" personnalisé quand le filtre ne correspond à aucune entrée
- **Synchronisation du kilométrage** entre les plugins et les champs personnalisés
- Pré-remplissage automatique du kilométrage depuis le champ personnalisé "kilometrage"
- Mise à jour automatique du champ kilométrage quand une valeur plus élevée est saisie

### Amélioré
- Uniformisation du style des champs de formulaire dans les modals (Type d'entretien, Prestataire)
- Meilleure cohérence visuelle entre les différents formulaires de plugins

## [1.2.11] - 2026-02-04

### Ajouté
- **Plugin Contrôle technique** : Gestion complète des centres de contrôle
- Bouton paramètres (⚙️) à côté de "Ajouter un contrôle" pour gérer les centres de contrôle
- Modal de gestion des centres de contrôle (nom, adresse, téléphone)
- Champ Centre de contrôle avec autocomplétion (datalist)
- Table `control_centers` pour stocker les centres
- Routes API CRUD pour les centres de contrôle : GET, POST, PUT, DELETE
- Les administrateurs peuvent modifier et supprimer les contrôles techniques
- Affichage de l'historique des contrôles en tableau (avec date d'expiration en couleur)
- Boutons d'action (modifier/supprimer) dans le tableau pour les admins
- Modal d'édition de contrôle technique avec autocomplétion du centre
- Route PUT `/api/objects/:id/technical-control/:controlId` pour modification
- **Calcul automatique de la date d'expiration** : +2 ans par défaut lors de l'ajout/modification d'un contrôle technique

### Corrigé
- Correction de l'erreur 500 lors de l'ajout d'un contrôle technique (mapping des champs client → serveur)
- Les champs `date`, `expirationDate`, `center` sont maintenant correctement mappés vers `controlDate`, `expiryDate`, `centerName`

## [1.2.10] - 2026-02-04

### Ajouté
- **Plugin Maintenance** : Gestion complète des types d'entretien et prestataires
- Bouton paramètres (⚙️) à côté de "Ajouter un entretien" pour gérer les types et prestataires
- Modal de gestion avec deux sections : Types d'entretien et Prestataires
- Champs avec autocomplétion (datalist) pour Type d'entretien et Prestataire
- Tables `maintenance_types` et `maintenance_providers` pour stocker les données
- Routes API CRUD pour les types d'entretien : GET, POST, PUT, DELETE
- Routes API CRUD pour les prestataires : GET, POST, PUT, DELETE (avec adresse et téléphone)
- Les administrateurs peuvent modifier et supprimer les entrées d'entretien
- Affichage de l'historique des entretiens en tableau (comme le carburant)
- Boutons d'action (modifier/supprimer) dans le tableau entretien pour les admins
- Modal d'édition d'entretien avec autocomplétion
- Route PUT `/api/objects/:id/maintenance/:maintenanceId` pour modification

### Corrigé
- Correction de l'erreur 500 lors de l'ajout d'un entretien (mapping des champs client → serveur)
- Les champs `date` et `type` sont maintenant correctement mappés vers `maintenanceDate` et `maintenanceType`

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
