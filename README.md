# 🚗 Gestion Matériels

Application web de gestion du matériel municipal (véhicules, tondeuses, équipements divers).

![Version](https://img.shields.io/badge/version-1.2.34-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)
![React](https://img.shields.io/badge/React-18-61dafb.svg)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-38bdf8.svg)

## ✨ Points forts

- 🎨 **Interface moderne** avec effets Glassmorphism et animations fluides
- 🔌 **Système de plugins** extensible avec import ZIP
- 📱 **Design responsive** adapté mobile et desktop
- 🔒 **Sécurisé** avec authentification JWT
- 🐳 **Docker ready** pour un déploiement facile

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

### Plugins intégrés
- ⛽ **Carburant** : Suivi des consommations et coûts, gestion des stations, filtrage avancé, pièces jointes (PDF/images)
- 🔧 **Maintenance** : Historique des interventions, gestion des types d'entretien et prestataires, synchronisation kilométrage, pièces jointes (PDF/images)
- 📋 **Contrôle technique** : Suivi des échéances, gestion des centres, calcul automatique expiration (+2 ans), pièces jointes (PDF/images)
- 📅 **Calendrier** : Planning et événements

### 🔌 Système de Plugins Avancé (Nouveau!)
- 📦 Import de plugins via fichiers ZIP
- 🗄️ Création dynamique de tables de base de données
- 📄 Pages personnalisées définies en JSON
- 🔗 API dynamiques configurables
- 🎨 Composants UI : Header, Filtres, DataGrid, Stats, Formulaires

### Calendrier & Alertes
- 📅 **Calendrier modernisé** avec interface intuitive
- 🗓️ Mini-calendrier avec navigation rapide
- 🔍 Recherche et filtres par type d'événement
- 📆 Vues : Mois, Semaine, Jour, Liste
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
│   │   │   └── DynamicPluginPage.tsx # Pages plugins dynamiques
│   │   ├── pages/         # Pages de l'application
│   │   │   └── settings/  # Pages d'administration
│   │   ├── stores/        # État global (Zustand)
│   │   └── lib/           # Utilitaires et API
│   └── ...
├── src/                    # Backend Node.js
│   ├── routes/            # Routes API
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
├── docs/                   # Documentation
│   ├── PLUGIN_STRUCTURE.md # Structure des plugins
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

### Calendrier

```
GET    /api/calendar/events   # Liste des événements
POST   /api/calendar/events   # Créer un événement
PUT    /api/calendar/:id      # Modifier un événement
DELETE /api/calendar/:id      # Supprimer un événement
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

## 🔒 Sécurité

- Authentification JWT avec refresh tokens
- Mots de passe hashés avec bcrypt
- Protection CSRF
- Rate limiting sur les endpoints sensibles
- Validation des entrées
- Headers de sécurité HTTP

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
npm test          # Lancer les tests
npm run test:cov  # Avec couverture
```

## 📝 Licence

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

## 🤝 Contribution

Les contributions sont les bienvenues ! N'hésitez pas à :

1. Fork le projet
2. Créer une branche (`git checkout -b feature/AmazingFeature`)
3. Commit vos changements (`git commit -m 'Add AmazingFeature'`)
4. Push la branche (`git push origin feature/AmazingFeature`)
5. Ouvrir une Pull Request

## 📞 Support

Pour toute question ou problème :
- Ouvrir une issue sur [GitHub](https://github.com/wdebonne/gestion-materiels/issues)
- Consulter la [documentation](docs/)

## 📚 Documentation

- [Structure des plugins](docs/PLUGIN_STRUCTURE.md) - Comment créer des plugins
- [Déploiement Portainer](docs/DEPLOIEMENT_PORTAINER.md) - Déployer avec Docker/Portainer
- [Exemples de plugins](examples/plugins/) - Plugins d'exemple

---

Développé avec ❤️ pour la gestion du matériel municipal
