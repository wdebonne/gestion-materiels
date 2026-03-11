# 🚗 Gestion Matériels

Application web de gestion du matériel municipal (véhicules, tondeuses, équipements divers).

![Version](https://img.shields.io/badge/version-1.2.61-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)
![React](https://img.shields.io/badge/React-18-61dafb.svg)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-38bdf8.svg)

## ✨ Points forts

- 🎨 **Interface moderne** avec effets Glassmorphism et animations fluides
- 🔌 **Système de plugins** extensible avec import ZIP
- 📱 **Design responsive** adapté mobile et desktop
- 🔒 **Sécurisé** avec authentification JWT
- � **Documentation API Swagger** interactive intégrée- 🌙 **Dark Mode** avec persistance des préférences
- 🌍 **Multilingue** (FR/EN) avec détection automatique
- 📲 **PWA installable** sur mobile avec cache hors-ligne
- ⚡ **Temps réel** via WebSocket (Socket.io)- �🐳 **Docker ready** pour un déploiement facile

## 📋 Fonctionnalités

### Gestion des utilisateurs
- 🔐 Authentification sécurisée (JWT)
- 👥 Trois rôles : Administrateur, Superviseur, Utilisateur
- 🔑 Réinitialisation de mot de passe par email
- 👤 Profil utilisateur personnalisable

### Gestion du matériel
- 📁 Organisation par catégories et sous-catégories
- 🎴 Affichage en cartes avec images
- 📝 Fiches détaillées pour chaque objet
- 🔍 Recherche et filtres avancés
- 📊 Champs personnalisés et spécifications

### ⚙️ Configuration des Champs
- 🎛️ Personnalisation des champs par catégorie et sous-catégorie
- 🔀 **Configuration spécifique par sous-catégorie** : Champs différents pour tronçonneuses vs tondeuses
- 🎯 **Restriction par sous-catégorie** : Limiter un champ à certaines sous-catégories seulement
- 👁️ Masquage des champs système non pertinents
- ➕ Ajout de champs personnalisés (texte, nombre, date, liste...)
- 📋 Héritage automatique des configurations (sous-catégorie → catégorie)
- 🔄 Réorganisation de l'ordre des champs par glisser-déposer
- 👀 Prévisualisation en temps réel des modifications
- 🏷️ Badges visuels indiquant le niveau de configuration et les restrictions

### 📊 Module Suivi (Nouveau!)
- 📈 **Tableau de bord** : Vue consolidée des coûts (carburant, entretiens, contrôles techniques)
- 🔍 **Filtres avancés** : Par période, catégorie, sous-catégorie, objet(s), type de données
- 📉 **Graphiques interactifs** : Évolution des coûts, répartition par type, coûts par objet/catégorie
- 🔄 **Comparaison unifiée** : Trois modes de comparaison disponibles
  - Périodes personnalisées : Comparer deux plages de dates libres
  - Années : Graphiques comparatifs année par année (ex: 2025 vs 2026)
  - Mois spécifiques : Comparer deux mois (ex: Janvier 2025 vs Janvier 2024)
- 📊 **Graphiques comparatifs** : Barres mois par mois, lignes par type de coût, résumé avec différence
- 📑 **Export PDF natif** : Téléchargement direct du rapport (jsPDF + html2canvas)
  - Barre de progression pendant la génération
  - Capture des graphiques en haute qualité
  - Pièces jointes optionnelles
- 🔐 **Permissions granulaires** : Contrôle d'accès par rôle et par utilisateur

### 📦 Gestion des Manifestations (Nouveau!)
- 🎪 **Page dédiée** : Gestion complète des manifestations (prêts de matériel pour événements)
- 🔍 **Recherche avancée** : Recherche en temps réel avec debounce sur les manifestations
- 📊 **Tableau de bord** : Statistiques avec compteurs par statut (brouillons, en cours, archivées)
- 🔄 **Workflow complet** : Circuit de validation en 5 étapes (Brouillon → Validée → Livrée → Récupérée → Archivée)
- 🎨 **Indicateurs visuels** : Cartes colorées par statut (bordure, fond, badge) avec barre de progression du workflow
- ✅ **Modales de changement de statut** :
  - Refus/Validation avec commentaire optionnel
  - Livraison avec gestion des quantités livrées (individuel ou global)
  - Récupération avec gestion des quantités retournées
- 📝 **Historique horodaté** : Timeline complète de toutes les actions avec utilisateur, date et commentaire
- 📄 **Export PDF** : Génération de rapport PDF avec en-tête, articles (commandé/livré/récupéré), et historique
- 🗂️ **Onglets** : Vue par manifestations actives, stock, et archives
- 🔗 **Recherche d'objets** : Autocomplete de recherche d'objets du parc pour ajout aux manifestations

### 🌳 Espaces Verts (Nouveau!)
- 🗺️ **Plan interactif** : Upload du plan, placement de repères par clic avec drag & drop, popup persistant, labels visibles
- 🌿 **Éléments du plan** : 8 types (arbre, arbuste, massif floral, haie, pelouse, bassin, mobilier, autre) avec état de santé et fiche détaillée
- 📐 **Zones polygonales** : Dessin de zones par clics successifs avec couleur et opacité
- 📦 **Groupes de composition** : Regroupement logique d'éléments avec couleur et description
- 🔧 **Entretiens** : Historique complet avec type, intervenant, durée, coût, éléments concernés, documents joints
- 📄 **Documents** : Upload, catégorisation par type, liaison aux éléments
- 📋 **Types personnalisés** : Gestion des types d'entretien et de documents (ajout, modification, activation/désactivation)
- ⚙️ **Options d'espace** : Gestion des types et statuts d'espaces verts depuis une modale dédiée
- 📸 **Clonage d'espace** : Copie vierge ou avec éléments sélectionnés, statut initial configurable (projet → travaux → actif), snapshot automatique avant clonage
- 🗂️ **Archives & Snapshots** : Capture de l'état complet (plan, éléments, annotations, groupes) à un instant T, liste chronologique, vue détaillée du plan archivé
- 🔄 **Comparaison de versions** : Mode côte-à-côte entre snapshot archivé et état actuel avec résumé des différences (éléments, annotations, groupes)
- 📜 **Historique de l'espace source** : Accès aux documents et entretiens de l'espace original si l'espace est un clone
- � **Types de groupes** : Gestion CRUD des types de groupes de composition (massif, haie, bosquet, rocaille, jardinière...) avec icône et couleur personnalisables
- ♻️ **Remplacement d'éléments** : Archivage automatique de l'état avant remplacement avec contexte saisonnier (printemps/été/automne/hiver) — timeline visuelle de l'historique pour traçabilité
- �📊 **Export PDF** : Plan annoté en paysage + légende + tableaux détaillés
- 🔗 **Intégrations** : Alertes automatiques (cron), événements calendrier, coûts dans le module Suivi

### Plugins intégrés
- ⛽ **Carburant** : Suivi des consommations et coûts, gestion des stations, filtrage avancé, pièces jointes (PDF/images)
- 🔧 **Maintenance** : Historique des interventions, gestion des types d'entretien et prestataires, synchronisation kilométrage, pièces jointes (PDF/images)
- 📋 **Contrôle technique** : Suivi des échéances, gestion des centres, calcul automatique expiration (+2 ans), pièces jointes (PDF/images)
- 📅 **Calendrier** *(plugin système)* : Planning et événements
- 🔄 **Réservations** *(plugin système)* : Gestion des prêts de matériel, statuts, alertes retards
- 📉 **Amortissement** *(plugin système)* : Dépréciation linéaire, graphiques Recharts
- 🗺️ **Cartographie** *(plugin système)* : Carte interactive Leaflet/OpenStreetMap
- 📥 **Import/Export** *(plugin système)* : Import CSV/Excel et export filtrable
- 🎉 **Manifestations** *(plugin système)* : Gestion d'événements avec prêt/livraison/récupération de matériel et suivi de stock
- 🌳 **Espaces Verts** *(plugin système)* : Plan interactif annoté, composition botanique, entretiens, clonage, archives & snapshots

### 🔌 Système de Plugins Avancé (Nouveau!)
- 📦 Import de plugins via fichiers ZIP
- 🗄️ Création dynamique de tables de base de données
- 📄 Pages personnalisées définies en JSON
- 🔗 API dynamiques configurables
- 🎨 Composants UI : Header, Filtres, DataGrid, Stats, Formulaires

### Calendrier & Alertes
- 📅 **Calendrier modernisé** avec interface intuitive et responsive (mobile/tablette)
- 🗓️ Mini-calendrier avec navigation rapide (overlay sur mobile)
- 🔍 Recherche et filtres par type d'événement
- 📆 Vues : Mois, Semaine, Jour, Liste (adaptées aux petits écrans)
- 🔄 **Synchronisation Outlook** via Azure AD
- 🔄 **Synchronisation CalDAV** (Nextcloud, Synology, iCloud, Google)
- ⚠️ Système d'alertes automatiques
- 📧 Notifications par email
- 🔔 Compteur d'alertes en temps réel

### Administration
- ⚙️ Paramètres généraux (nom du site, logo, favicon)
- 📧 Configuration SMTP avec test d'envoi
- 📝 Templates d'emails personnalisables
- 💾 Sauvegarde et restauration de base de données
- 🔄 Migration SQLite vers MySQL/MariaDB
- 🔐 Gestion des permissions par catégorie
- 📋 **Journal des logs** avec filtrage, export et paramètres avancés
- 🔗 **Webhooks** : Notifications HTTP vers des services externes
- 📖 **API** : Documentation interactive Swagger UI, spécification OpenAPI, statistiques

### 📦 QR Codes
- 📱 **QR Codes** : Génération par matériel, scan terrain pour accès rapide à la fiche

### 🔌 Plugins système (activables/désactivables depuis Paramètres > Plugins)

#### 🔄 Réservation / Prêt de matériel
- 📅 Formulaire de réservation (dates, motif, emprunteur)
- 🔄 Statuts : réservé, en prêt, retourné, en retard
- ⏰ Alertes automatiques CRON pour retours en retard
- 📜 Historique complet des emprunts

#### 💰 Amortissement / Dépréciation
- 📉 Calcul linéaire automatique de la valeur résiduelle
- 📊 Graphiques interactifs (barres + camembert)
- 🏷️ Vision financière du patrimoine matériel

#### 🗺️ Cartographie
- 🗺️ **Carte interactive** OpenStreetMap (Leaflet) avec marqueurs par matériel
- 📜 **Timeline** : Frise chronologique consolidée sur la fiche objet (maintenances, contrôles, carburant, alertes)

#### 📥 Import / Export
- 📥 **Import CSV/Excel** : Import massif avec validation des données
- 📤 **Export** : Export filtrable par catégorie au format CSV ou XLSX
- 📋 Template d'import téléchargeable

### 📧 Reporting automatique
- 📊 Rapport hebdomadaire envoyé par email aux admins/superviseurs
- 📈 Stats : objets, alertes, réservations, retards

### 🌙 Dark Mode & i18n
- 🌙 Mode sombre togglable (clair/sombre/système) avec persistance
- 🌍 Support multilingue FR/EN avec détection automatique du navigateur

### ⚡ Temps réel (WebSocket)
- 🔔 Alertes instantanées via Socket.io
- 🔄 Invalidation automatique du cache côté client

### 📲 PWA (Progressive Web App)
- 📱 Installation sur l'écran d'accueil mobile
- 💾 Cache intelligent pour consultation hors-ligne
- ⚙️ Service worker Workbox

### 🎨 Interface Utilisateur (v1.2)
- 🌟 Design moderne avec palette Sky Blue
- ✨ Effets Glassmorphism sur la navigation
- 🎭 Animations fluides et transitions
- 📐 Composants UI soignés (boutons, cartes, inputs)
- 🎯 Hiérarchie visuelle claire

## 🚀 Installation

### Prérequis

- Node.js >= 18.0.0
- npm >= 9.0.0
- (Optionnel) Docker et Docker Compose

### Installation locale

1. **Cloner le dépôt**
```bash
git clone https://github.com/votre-repos/gestion-materiels.git
cd gestion-materiels
```

2. **Configurer les variables d'environnement**
```bash
cp .env.example .env
# Éditer le fichier .env avec vos paramètres
```

3. **Installer les dépendances**
```bash
# Backend
npm install

# Frontend
cd client
npm install
cd ..
```

4. **Lancer l'application en développement**
```bash
# Terminal 1 - Backend
npm run dev

# Terminal 2 - Frontend
cd client
npm run dev
```

5. **Accéder à l'application**
- Frontend : http://localhost:5173
- Backend API : http://localhost:3000

### Identifiants par défaut

| Rôle | Email | Mot de passe |
|------|-------|--------------|
| Administrateur | admin@example.com | admin123 |

⚠️ **Important** : Changez ces identifiants dès la première connexion !

## 🐳 Déploiement avec Docker

### Configuration rapide

1. **Créer le fichier d'environnement**
```bash
cp .env.example .env
```

2. **Configurer les variables importantes**
```env
# Sécurité - OBLIGATOIRE en production
JWT_SECRET=votre_secret_jwt_tres_long_minimum_32_caracteres
JWT_REFRESH_SECRET=autre_secret_pour_refresh_token

# Base de données
DB_TYPE=sqlite  # ou mysql

# SMTP (optionnel mais recommandé)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASS=votre_mot_de_passe
SMTP_FROM=noreply@example.com
```

3. **Lancer avec Docker Compose**
```bash
# Avec SQLite (simple)
docker-compose up -d app

# Avec MySQL
docker-compose up -d
```

4. **Accéder à l'application**
```
http://localhost:3001
```

### Avec Nginx (production)

```bash
# Créer le dossier SSL
mkdir -p nginx/ssl
# Copier vos certificats SSL
cp fullchain.pem nginx/ssl/
cp privkey.pem nginx/ssl/

# Lancer avec le profil production
docker-compose --profile production up -d
```

## 📁 Structure du projet

```
gestion-materiels/
├── client/                 # Frontend React
│   ├── src/
│   │   ├── components/    # Composants réutilisables
│   │   │   ├── ui/        # Composants UI (Button, Modal, etc.)
│   │   │   ├── Layout.tsx # Layout principal
│   │   │   ├── ManifestationPDFExport.tsx # Export PDF manifestations
│   │   │   └── DynamicPluginPage.tsx # Pages plugins dynamiques
│   │   ├── pages/         # Pages de l'application
│   │   │   ├── ManifestationsPage.tsx # Gestion des manifestations
│   │   │   ├── EspacesVertsPage.tsx   # Gestion des espaces verts
│   │   │   └── settings/  # Pages d'administration
│   │   ├── stores/        # État global (Zustand)
│   │   └── lib/           # Utilitaires et API
│   └── ...
├── src/                    # Backend Node.js
│   ├── routes/            # Routes API (dont manifestation.routes.ts, espaceVert.routes.ts)
│   ├── services/          # Services métier
│   │   ├── plugin.service.ts         # Gestion plugins
│   │   ├── pluginAdvanced.service.ts # Plugins avancés (ZIP, tables)
│   │   ├── email.service.ts          # Service email
│   │   └── cron.service.ts           # Tâches planifiées
│   ├── middleware/        # Middlewares (auth)
│   ├── database/          # Gestion BDD
│   └── server.ts          # Point d'entrée
├── data/                   # Base de données SQLite
├── uploads/                # Fichiers uploadés
├── backups/                # Sauvegardes
├── plugins/                # Plugins installés
│   └── pages/             # Pages des plugins
├── examples/               # Exemples de plugins
│   └── plugins/           # Plugins d'exemple (ZIP)
├── tests/                  # Tests backend (Jest)
│   ├── slugify.test.ts    # Tests utilitaire slugify
│   └── api.test.ts        # Tests routes API & WebSocket
├── docs/                   # Documentation
│   ├── ROADMAP_FONCTIONNALITES.md # Roadmap 12 fonctionnalités
│   ├── PLUGIN_STRUCTURE.md # Structure des plugins
│   ├── AUDIT_SECURITE_API.md # Audit sécurité
│   ├── JWT_ROTATION.md    # Rotation JWT
│   └── DEPLOIEMENT_PORTAINER.md # Déploiement Portainer
├── nginx/                  # Configuration Nginx
├── docker-compose.yml
├── Dockerfile
└── README.md
```

## 🔧 Configuration

### Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `PORT` | Port du serveur | 3000 |
| `NODE_ENV` | Environnement | development |
| `JWT_SECRET` | Secret JWT (obligatoire) | - |
| `JWT_REFRESH_SECRET` | Secret refresh token | - |
| `DB_TYPE` | Type de BDD (sqlite/mysql) | sqlite |
| `SQLITE_PATH` | Chemin BDD SQLite | ./data/database.sqlite |
| `MYSQL_HOST` | Hôte MySQL | localhost |
| `MYSQL_PORT` | Port MySQL | 3306 |
| `MYSQL_USER` | Utilisateur MySQL | - |
| `MYSQL_PASSWORD` | Mot de passe MySQL | - |
| `MYSQL_DATABASE` | Nom BDD MySQL | gestion_materiels |
| `SMTP_HOST` | Serveur SMTP | - |
| `SMTP_PORT` | Port SMTP | 587 |
| `SMTP_USER` | Utilisateur SMTP | - |
| `SMTP_PASS` | Mot de passe SMTP | - |
| `SMTP_FROM` | Email expéditeur | - |

### Templates d'emails

Les templates d'emails utilisent la syntaxe Handlebars :

- `{{userName}}` - Nom de l'utilisateur
- `{{userEmail}}` - Email de l'utilisateur
- `{{resetLink}}` - Lien de réinitialisation
- `{{siteName}}` - Nom du site
- `{{siteUrl}}` - URL du site
- `{{alertTitle}}` - Titre de l'alerte
- `{{alertMessage}}` - Message de l'alerte

## 📖 API

### Documentation interactive

L'API dispose d'une documentation Swagger UI interactive :

| Ressource | URL | Description |
|-----------|-----|-------------|
| Swagger UI | `/api-docs` | Interface interactive pour explorer et tester les endpoints |
| OpenAPI Spec | `/api/swagger.json` | Spécification OpenAPI 3.0 (importable dans Postman, Insomnia) |
| API Info | `/api/api-info` | Métadonnées et statistiques de l'API |

La documentation est également accessible depuis **Paramètres > API** dans l'interface d'administration.

### Authentification

```
POST /api/auth/login          # Connexion
POST /api/auth/register       # Inscription (admin)
POST /api/auth/forgot-password # Mot de passe oublié
POST /api/auth/reset-password # Réinitialisation
POST /api/auth/refresh        # Refresh token
GET  /api/auth/me             # Utilisateur courant
```

### Catégories

```
GET    /api/categories        # Liste des catégories
POST   /api/categories        # Créer une catégorie
GET    /api/categories/:id    # Détail d'une catégorie
PUT    /api/categories/:id    # Modifier une catégorie
DELETE /api/categories/:id    # Supprimer une catégorie
```

### Sous-catégories

```
GET    /api/categories/:id/subcategories     # Liste
POST   /api/categories/:id/subcategories     # Créer
GET    /api/subcategories/:id                # Détail
PUT    /api/subcategories/:id                # Modifier
DELETE /api/subcategories/:id                # Supprimer
```

### Objets

```
GET    /api/objects           # Liste des objets
POST   /api/objects           # Créer un objet
GET    /api/objects/:id       # Détail d'un objet
PUT    /api/objects/:id       # Modifier un objet
DELETE /api/objects/:id       # Supprimer un objet
```

### Plugins

```
GET  /api/plugins                     # Liste des plugins
GET  /api/plugins/menu                # Plugins de type menu (navigation)
GET  /api/plugins/:id                 # Détail d'un plugin
PUT  /api/plugins/:id                 # Activer/désactiver
PUT  /api/plugins/:id/settings        # Modifier les paramètres
PUT  /api/plugins/:id/associations    # Associer à des catégories
POST /api/plugins/import              # Importer un plugin (JSON)
POST /api/plugins/import-zip          # Importer un plugin avancé (ZIP)
GET  /api/plugins/:slug/pages         # Pages d'un plugin
GET  /api/plugins/:slug/data/*        # API dynamique d'un plugin

# Carburant
GET  /api/objects/:id/fuel            # Historique carburant
POST /api/objects/:id/fuel            # Ajouter un plein

# Maintenance
GET  /api/objects/:id/maintenance     # Historique maintenance
POST /api/objects/:id/maintenance     # Ajouter une maintenance

# Contrôle technique
GET  /api/objects/:id/controls        # Historique contrôles
POST /api/objects/:id/controls        # Ajouter un contrôle
```

### Manifestations

```
GET    /api/manifestations           # Liste des manifestations (filtres: search, status)
GET    /api/manifestations/stats     # Statistiques par statut
GET    /api/manifestations/search/objects  # Recherche d'objets du parc
POST   /api/manifestations           # Créer une manifestation
GET    /api/manifestations/:id       # Détail (avec articles et historique)
PUT    /api/manifestations/:id       # Modifier une manifestation
DELETE /api/manifestations/:id       # Supprimer une manifestation
POST   /api/manifestations/:id/status # Changer le statut (avec validation des transitions)
GET    /api/manifestations/:id/history # Historique des changements
```

### Espaces Verts

```
GET    /api/green-spaces              # Liste des espaces verts
GET    /api/green-spaces/stats        # Statistiques
POST   /api/green-spaces              # Créer un espace vert
GET    /api/green-spaces/:id          # Détail (avec éléments, annotations, groupes, documents, entretiens, snapshots)
PUT    /api/green-spaces/:id          # Modifier un espace vert
DELETE /api/green-spaces/:id          # Supprimer un espace vert

# Éléments
POST   /api/green-spaces/:id/elements      # Ajouter un élément
PUT    /api/green-spaces/elements/:eid     # Modifier un élément
DELETE /api/green-spaces/elements/:eid     # Supprimer un élément

# Annotations
POST   /api/green-spaces/:id/annotations   # Ajouter une annotation
PUT    /api/green-spaces/annotations/:aid  # Modifier une annotation
DELETE /api/green-spaces/annotations/:aid  # Supprimer une annotation

# Groupes
POST   /api/green-spaces/:id/groups        # Ajouter un groupe
PUT    /api/green-spaces/groups/:gid       # Modifier un groupe
DELETE /api/green-spaces/groups/:gid       # Supprimer un groupe

# Documents
POST   /api/green-spaces/:id/documents     # Ajouter un document
DELETE /api/green-spaces/documents/:did    # Supprimer un document

# Entretiens
POST   /api/green-spaces/:id/maintenances  # Ajouter un entretien
PUT    /api/green-spaces/maintenances/:mid # Modifier un entretien
DELETE /api/green-spaces/maintenances/:mid # Supprimer un entretien

# Types personnalisés
GET    /api/green-spaces/doc-types         # Types de documents
POST   /api/green-spaces/doc-types         # Créer un type de document
PUT    /api/green-spaces/doc-types/:id     # Modifier un type
GET    /api/green-spaces/custom-maintenance-types  # Types d'entretien
POST   /api/green-spaces/custom-maintenance-types  # Créer un type d'entretien
PUT    /api/green-spaces/custom-maintenance-types/:id # Modifier un type

# Clonage & Archives
POST   /api/green-spaces/:id/clone         # Cloner un espace vert
POST   /api/green-spaces/:id/snapshots     # Créer un snapshot
GET    /api/green-spaces/:id/snapshots     # Liste des snapshots
GET    /api/green-spaces/snapshots/:sid    # Détail d'un snapshot
DELETE /api/green-spaces/snapshots/:sid    # Supprimer un snapshot
GET    /api/green-spaces/:id/archives      # Archives (snapshots + données source si cloné)
```

### Calendrier

```
GET    /api/calendar/events   # Liste des événements
POST   /api/calendar/events   # Créer un événement
PUT    /api/calendar/:id      # Modifier un événement
DELETE /api/calendar/:id      # Supprimer un événement
```

### QR Codes

```
GET  /api/qrcode/:id          # Générer le QR code d'un matériel (PNG)
```

### Import/Export

```
GET  /api/import-export/export # Exporter les matériels (CSV/XLSX)
POST /api/import-export/import # Importer des matériels (CSV/XLSX)
GET  /api/import-export/template # Télécharger le template d'import
```

### Réservations

```
GET    /api/reservations       # Liste des réservations
POST   /api/reservations       # Créer une réservation
PUT    /api/reservations/:id/status # Changer le statut
DELETE /api/reservations/:id   # Supprimer une réservation
```

### Amortissement

```
GET  /api/dashboard/depreciation # Données de dépréciation des matériels
```

### Administration

```
# Paramètres
GET  /api/settings            # Tous les paramètres
PUT  /api/settings            # Modifier les paramètres

# Utilisateurs
GET    /api/users             # Liste des utilisateurs
POST   /api/users             # Créer un utilisateur
PUT    /api/users/:id         # Modifier un utilisateur
DELETE /api/users/:id         # Supprimer un utilisateur

# Sauvegardes
GET    /api/backup            # Liste des sauvegardes
POST   /api/backup            # Créer une sauvegarde
GET    /api/backup/:id        # Télécharger
POST   /api/backup/:id/restore # Restaurer
DELETE /api/backup/:id        # Supprimer

# Migration
POST   /api/backup/migrate    # Migrer vers MySQL
```

## 🔒 Sécurité & Authentification

- Authentification JWT avec refresh tokens
- Mots de passe hashés avec bcrypt
- Protection CSRF
- Rate limiting sur les endpoints sensibles
- Validation des entrées
- Headers de sécurité HTTP
- Rotation automatique des secrets JWT
- **SSO SAML 2.0** : Azure AD, Google Workspace, Okta, Keycloak
- **SSO OpenID Connect** : Azure AD, Google, Auth0, Keycloak
- **LDAP / Active Directory** : Authentification annuaire avec mapping groupes/rôles
- **Passkey (WebAuthn / FIDO2)** : Empreinte digitale, reconnaissance faciale, clés USB
- **Politique de mot de passe** : Longueur, complexité, expiration configurables
- **Politique de connexion** : Blocage après N tentatives, 2FA obligatoire, timeout session

## 🛠️ Développement

### Scripts disponibles

```bash
# Backend
npm run dev       # Développement avec hot-reload
npm run build     # Compilation TypeScript
npm start         # Production

# Frontend (dans /client)
npm run dev       # Développement Vite
npm run build     # Build production
npm run preview   # Prévisualiser le build
```

### Tests

```bash
# Backend (Jest)
npm test              # Lancer les tests backend
npx jest --coverage   # Avec couverture

# Frontend (Vitest)
cd client
npm run test          # Mode watch
npm run test:run      # Exécution unique
```

> 36 tests au total : 15 backend (slugify, routes API, WebSocket) + 21 frontend (Badge, Button, Card)

## 📝 Licence

Licence d'utilisation personnelle © 2026 [DEBONNE Frédéric]

Ce logiciel est protégé par le droit d'auteur. L'utilisation est autorisée uniquement avec permission écrite de l'auteur. La distribution et la vente sont strictement réservées à l'auteur.

## 📞 Support

Pour toute question ou problème :
- Ouvrir une issue sur [GitHub](https://github.com/wdebonne/gestion-materiels/issues)
- Consulter la [documentation](docs/)

## 📚 Documentation

- [Roadmap fonctionnalités](docs/ROADMAP_FONCTIONNALITES.md) - Suivi des 12 fonctionnalités ajoutées
- [Structure des plugins](docs/PLUGIN_STRUCTURE.md) - Comment créer des plugins
- [Déploiement Portainer](docs/DEPLOIEMENT_PORTAINER.md) - Déployer avec Docker/Portainer
- [Audit sécurité API](docs/AUDIT_SECURITE_API.md) - Rapport d'audit de sécurité
- [JWT Rotation](docs/JWT_ROTATION.md) - Rotation automatique des tokens JWT
- [Exemples de plugins](examples/plugins/) - Plugins d'exemple

---

Développé avec ❤️ pour la gestion du matériel municipal
