# 🗺️ Roadmap des Fonctionnalités - Gestion Matériels

> Document de suivi des nouvelles fonctionnalités à intégrer au projet.
> Créé le 6 mars 2026.

---

## 📊 Récapitulatif par priorité

| # | Priorité | Fonctionnalité | Effort | Impact | Statut |
|---|----------|---------------|--------|--------|--------|
| 1 | 🔴 Haute | QR Codes matériels | Faible | Fort | ✅ Fait |
| 2 | 🔴 Haute | Import/Export CSV & Excel | Moyen | Fort | ✅ Plugin système |
| 3 | 🔴 Haute | Tests automatisés | Moyen | Fort | ✅ Fait |
| 4 | 🟠 Moyenne | Réservation / Prêt de matériel | Élevé | Fort | ✅ Plugin système |
| 5 | 🟠 Moyenne | Amortissement / Dépréciation | Moyen | Moyen | ✅ Plugin système |
| 6 | 🟠 Moyenne | PWA (Progressive Web App) | Faible | Moyen | ✅ Fait |
| 7 | 🟡 Basse | Cartographie GPS (Leaflet) | Moyen | Moyen | ✅ Plugin système |
| 8 | 🟡 Basse | Timeline historique matériel | Faible | Moyen | ✅ Fait |
| 9 | 🟡 Basse | Reporting périodique automatique | Moyen | Moyen | ✅ Fait |
| 10 | 🟢 Optionnel | Dark Mode | Faible | Faible | ✅ Fait |
| 11 | 🟢 Optionnel | Internationalisation (i18n) | Moyen | Faible | ✅ Fait |
| 12 | 🟢 Optionnel | WebSocket temps réel | Moyen | Moyen | ✅ Fait |
| 13 | 🔴 Haute | Authentification SSO / LDAP / Passkey | Moyen | Fort | ✅ Fait |

---

## 🔴 Priorité Haute

### 1. QR Codes matériels
- **Description :** Générer un QR code unique par fiche matériel, pointant vers l'URL de consultation de la fiche. Permet le scan terrain pour accès rapide.
- **Fonctionnalités :**
  - Génération automatique de QR codes par matériel
  - Affichage sur la fiche objet
  - Export PDF d'étiquettes en lot (impression)
  - Scan mobile pour accéder à la fiche
- **Librairies :** `qrcode` (backend), `react-qr-code` (frontend)
- **Impact :** Très utile pour l'inventaire terrain, les agents municipaux

### 2. Import/Export CSV & Excel
- **Description :** Importer massivement des matériels depuis un fichier CSV/Excel, et exporter la base avec filtres.
- **Fonctionnalités :**
  - Import CSV/Excel avec mapping de colonnes
  - Validation des données avant import
  - Export filtrable (par catégorie, statut, etc.)
  - Template de fichier d'import téléchargeable
- **Librairies :** `xlsx` ou `exceljs`
- **Impact :** Indispensable pour migration initiale et inventaires annuels

### 3. Tests automatisés
- **Description :** Couverture de tests pour les routes API critiques et les composants React.
- **Fonctionnalités :**
  - Tests unitaires des routes auth, CRUD objets, catégories
  - Tests des composants React clés
  - Configuration CI/CD prête pour GitHub Actions
- **Librairies :** `vitest`, `supertest`, `@testing-library/react`
- **Impact :** Fiabilité, détection de régressions, confiance dans les déploiements

---

## 🟠 Priorité Moyenne

### 4. Réservation / Prêt de matériel
- **Description :** Module complet de réservation et prêt d'équipements.
- **Fonctionnalités :**
  - Calendrier de disponibilité par matériel
  - Formulaire de réservation (dates, motif, emprunteur)
  - Statuts : réservé, en prêt, retourné, en retard
  - Historique des emprunts
  - Alertes automatiques (retours en retard)
  - Intégration FullCalendar
- **Tables BDD :** `reservations`
- **Impact :** Gestion partagée du matériel entre services

### 5. Amortissement / Dépréciation
- **Description :** Calcul automatique de la valeur résiduelle des équipements.
- **Fonctionnalités :**
  - Durée d'amortissement configurable par catégorie
  - Calcul linéaire de la valeur résiduelle
  - Graphiques de dépréciation sur le dashboard
  - Alertes fin d'amortissement
- **Impact :** Vision financière du patrimoine matériel

### 6. PWA (Progressive Web App)
- **Description :** Transformer l'app en PWA installable sur mobile.
- **Fonctionnalités :**
  - Installation sur l'écran d'accueil
  - Cache intelligent pour consultation hors-ligne
  - Notifications push pour les alertes
  - Manifest et service worker
- **Librairies :** `vite-plugin-pwa`
- **Impact :** Accès terrain facilité, expérience native

---

## 🟡 Priorité Basse

### 7. Cartographie GPS (Leaflet)
- **Description :** Vue carte pour localiser les équipements géographiquement.
- **Fonctionnalités :**
  - Carte interactive OpenStreetMap
  - Marqueurs par matériel avec popup fiche
  - Filtres par catégorie/statut
  - Géocodage d'adresses
- **Librairies :** `react-leaflet`, `leaflet`
- **Impact :** Utile pour communes multi-sites

### 8. Timeline historique matériel
- **Description :** Frise chronologique visuelle sur la fiche d'un matériel.
- **Fonctionnalités :**
  - Vue consolidée : créations, maintenances, carburant, contrôles, alertes
  - Filtre par type d'événement
  - Navigation temporelle
- **Impact :** Vision complète du cycle de vie d'un équipement

### 9. Reporting périodique automatique
- **Description :** Rapports automatiques envoyés par email.
- **Fonctionnalités :**
  - Rapports mensuels/trimestriels configurables
  - Coûts par catégorie, matériels les plus coûteux
  - Alertes en attente, taux d'utilisation
  - Tâche CRON planifiée
- **Impact :** Suivi proactif sans connexion

---

## 🟢 Optionnel

### 10. Dark Mode
- **Description :** Mode sombre togglable par utilisateur.
- **Fonctionnalités :**
  - Switch clair/sombre dans le profil
  - Persistance de la préférence
  - Classes Tailwind `dark:`
- **Impact :** Confort visuel

### 11. Internationalisation (i18n)
- **Description :** Support multi-langues.
- **Fonctionnalités :**
  - Fichiers de traduction FR/EN
  - Détection automatique de la langue navigateur
  - Switch de langue dans les paramètres
- **Librairies :** `react-i18next`, `i18next`
- **Impact :** Adoption par d'autres collectivités

### 12. WebSocket temps réel
- **Description :** Notifications et mises à jour en temps réel.
- **Fonctionnalités :**
  - Alertes instantanées (badge temps réel)
  - Notifications de modifications collaboratives
  - Statuts de connexion utilisateurs
- **Librairies :** `socket.io`, `socket.io-client`
- **Impact :** Expérience collaborative améliorée

### 13. Authentification SSO / LDAP / Passkey
- **Description :** Page de configuration complète des méthodes d'authentification dans Paramètres > Authentification.
- **Fonctionnalités :**
  - **Général** : Politique de connexion (connexion locale, inscription, 2FA, timeout session, blocage tentatives) et politique de mot de passe (longueur, complexité, expiration)
  - **LDAP / Active Directory** : Connexion annuaire, mapping attributs et groupes, création auto d'utilisateurs, STARTTLS
  - **SAML 2.0 SSO** : Compatible Azure AD, Google Workspace, Okta, OneLogin, Keycloak — certificat X.509, mapping attributs, algorithme signature
  - **OpenID Connect** : URL de découverte, scopes, Authorization Code / Implicit, mapping claims
  - **Passkey (WebAuthn / FIDO2)** : Empreinte digitale, reconnaissance faciale, clés USB — mode principal ou 2FA
  - Bouton de test de connexion pour chaque fournisseur
  - Préservation des secrets lors de la mise à jour
- **Tables BDD :** `auth_config` (provider, is_active, config JSON)
- **Routes API :** `/api/settings/auth` — GET, GET/:provider, PUT/:provider, POST/:provider/test
- **Impact :** Intégration entreprise, SSO centralisé, sécurité renforcée
