# Technologies et licences

Inventaire des technologies, bibliothèques et services utilisés par **Gestion Matériels** (v1.4.0), avec leur licence d'utilisation.

- Versions : celles **réellement installées** (`node_modules`), relevées le 27/09/2026 — pas seulement les plages de `package.json`.
- Licences : champ `license` de chaque paquet, vérifié dans le fichier `LICENSE` quand ce champ manque.
- Pour régénérer l'inventaire complet, lancez `npx license-checker --summary` à la racine, puis dans `client/`.

---

## 1. Synthèse

| | Serveur (`/`) | Client (`/client`) |
|---|---|---|
| Dépendances directes | 30 (+ 28 de développement) | 32 (+ 19 de développement) |
| Paquets installés au total (transitifs compris) | 768 | 811 |
| Licences permissives (MIT, ISC, BSD, Apache-2.0…) | ≈ 98 % | ≈ 99 % |

**Auteur et développeur :** DEBONNE Frédéric.

**Licence du projet :** licence d'utilisation personnelle, © 2026 DEBONNE Frédéric (voir le [README](../README.md#-licence)). Le logiciel est protégé par le droit d'auteur : toute utilisation demande une permission écrite de l'auteur, et la distribution comme la vente lui sont réservées.

Cette licence propriétaire est compatible avec toutes les bibliothèques listées ci-dessous, puisque aucune n'impose de copyleft fort (GPL / AGPL) au code de l'application. En revanche, chaque fois que le logiciel est distribué (image Docker, client construit), il faut joindre les mentions de copyright et les textes de licence des bibliothèques tierces : MIT, BSD et Apache-2.0 l'exigent.

### Points d'attention

| Élément | Licence | Ce qu'elle implique |
|---|---|---|
| `react-leaflet` 4.2.1 et `@react-leaflet/core` 2.1.0 | **Hippocratic License 2.1** | Licence « éthique », **non reconnue comme open source par l'OSI** : elle interdit les usages contraires aux droits humains. Aucun problème pour une collectivité, mais une politique qui exige du logiciel libre au sens strict peut la refuser. Pour l'éviter, il faudrait appeler `leaflet` (BSD-2-Clause) directement, sans `react-leaflet`. |
| `@img/sharp-libvips-*` (binaires de `sharp`) | **LGPL-3.0-or-later** | Utilisation libre par liaison dynamique, ce qui est le cas ici. Si vous redistribuez l'image Docker, vous devez permettre de remplacer libvips et fournir (ou indiquer) ses sources. |
| `jszip` 3.10.1 | MIT **ou** GPL-3.0 (au choix) | Retenir MIT : pas de contrainte. |
| `dompurify` 3.3.1 (client, optionnel) | MPL-2.0 **ou** Apache-2.0 (au choix) | Retenir Apache-2.0 : pas de contrainte. |
| Police **Inter** chargée depuis Google Fonts | SIL OFL 1.1 | La police est libre, mais la charger depuis les serveurs de Google transmet l'adresse IP des visiteurs à Google (point RGPD relevé par la CNIL). Il est préférable d'héberger la police localement. |
| Tuiles et géocodage **OpenStreetMap** | ODbL + politique d'usage | Attribution obligatoire (elle est bien affichée). Nominatim : 1 requête par seconde au maximum, User-Agent identifiable, pas d'usage massif. |

---

## 2. Socle technique

| Technologie | Rôle | Version | Licence |
|---|---|---|---|
| [Node.js](https://nodejs.org) | Environnement d'exécution du serveur | ≥ 20 (image `node:20-alpine`) | MIT |
| [TypeScript](https://www.typescriptlang.org) | Langage (serveur et client) | 5.9.3 | Apache-2.0 |
| [React](https://react.dev) | Interface web | 18.3.1 | MIT |
| [Vite](https://vitejs.dev) | Outil de construction et serveur de dev du client | 5.4.21 | MIT |
| [Tailwind CSS](https://tailwindcss.com) | Styles | 3.4.19 | MIT |
| [Express](https://expressjs.com) | Serveur HTTP / API REST | 4.22.1 | MIT |
| [Socket.IO](https://socket.io) | Temps réel (serveur et client) | 4.8.3 | MIT |
| [SQLite](https://sqlite.org) via `better-sqlite3` | Base de données par défaut | 12.11.1 | SQLite : domaine public · pilote : MIT |
| [MySQL](https://www.mysql.com) via `mysql2` | Base de données alternative (`docker-compose.mysql.yml`) | serveur 8.4 · pilote 3.16.2 | Serveur : GPL-2.0 (Community Edition, service séparé : aucune obligation pour l'application) · pilote : MIT |
| [Docker](https://www.docker.com) / Docker Compose | Conteneurisation, déploiement (Portainer) | — | Apache-2.0 (Docker Engine) |
| [Alpine Linux](https://alpinelinux.org) | Système de base de l'image | image `node:20-alpine` | Licences variées (MIT, GPL-2.0 pour certains paquets système) |
| [nginx](https://nginx.org) | Proxy inverse / TLS (`nginx/nginx.conf`) | — | BSD-2-Clause |
| PWA (`vite-plugin-pwa`) | Application installable, fonctionnement hors ligne | 1.2.0 | MIT |

---

## 3. Bibliothèques du serveur (`package.json`)

### Dépendances de production

| Bibliothèque | Version | Licence | Usage |
|---|---|---|---|
| @simplewebauthn/server | 13.3.3 | MIT | Clés d'accès (passkeys / WebAuthn) |
| archiver | 6.0.2 | MIT | Création d'archives ZIP (exports, sauvegardes) |
| bcryptjs | 2.4.3 | MIT | Hachage des mots de passe |
| better-sqlite3 | 12.11.1 | MIT | Pilote SQLite |
| cookie-parser | 1.4.7 | MIT | Lecture des cookies |
| cors | 2.8.6 | MIT | En-têtes CORS |
| dotenv | 16.6.1 | BSD-2-Clause | Variables d'environnement (`.env`) |
| easy-template-x | 7.2.8 | MIT | Génération de documents Word depuis des modèles |
| exceljs | 4.4.0 | MIT | Lecture et écriture de fichiers Excel / CSV |
| express | 4.22.1 | MIT | Serveur HTTP |
| express-rate-limit | 8.2.1 | MIT | Limitation du débit des requêtes |
| express-validator | 7.3.1 | MIT | Validation des entrées |
| extract-zip | 2.0.1 | BSD-2-Clause | Décompression (plugins, restauration) |
| handlebars | 4.7.8 | MIT | Gabarits (courriels, documents) |
| helmet | 7.2.0 | MIT | En-têtes de sécurité HTTP |
| jsonwebtoken | 9.0.3 | MIT | Jetons d'authentification JWT |
| jszip | 3.10.1 | MIT ou GPL-3.0 | Manipulation de fichiers ZIP / DOCX |
| morgan | 1.10.1 | MIT | Journal des requêtes HTTP |
| multer | 1.4.5-lts.2 | MIT | Téléversement de fichiers |
| mysql2 | 3.16.2 | MIT | Pilote MySQL |
| node-cron | 3.0.3 | ISC | Tâches planifiées |
| nodemailer | 6.10.1 | MIT-0 | Envoi de courriels (SMTP) |
| qrcode | 1.5.4 | MIT | Génération de QR codes |
| sharp | 0.34.5 | Apache-2.0 (binaires libvips : LGPL-3.0) | Traitement d'images, captures de carte |
| socket.io | 4.8.3 | MIT | Temps réel |
| swagger-jsdoc | 6.2.8 | MIT | Documentation de l'API (OpenAPI) |
| swagger-ui-express | 5.0.1 | MIT (Swagger UI : Apache-2.0) | Interface de la documentation de l'API |
| uuid | 9.0.1 | MIT | Identifiants uniques |
| @types/express-rate-limit, @types/qrcode, @types/socket.io | — | MIT | Définitions de types TypeScript |

### Dépendances de développement

| Bibliothèque | Version | Licence | Usage |
|---|---|---|---|
| typescript | 5.9.3 | Apache-2.0 | Compilation |
| esbuild | 0.19.12 | MIT | Construction rapide (`build-server.js`) |
| ts-node | 10.9.2 | MIT | Exécution TypeScript (migrations, seed) |
| ts-node-dev | 2.0.0 | MIT | Rechargement à chaud en développement |
| concurrently | 8.2.2 | MIT | Lancement parallèle serveur + client |
| jest | 29.7.0 | MIT | Tests |
| ts-jest | 29.4.6 | MIT | Tests en TypeScript |
| supertest | 7.2.2 | MIT | Tests de l'API HTTP |
| @types/* (18 paquets) | — | MIT | Définitions de types (DefinitelyTyped) |

---

## 4. Bibliothèques du client (`client/package.json`)

### Dépendances de production

| Bibliothèque | Version | Licence | Usage |
|---|---|---|---|
| react / react-dom | 18.3.1 | MIT | Interface |
| react-router-dom | 6.30.3 | MIT | Navigation |
| @tanstack/react-query | 5.90.20 | MIT | Chargement et cache des données |
| zustand | 4.5.7 | MIT | État global |
| axios | 1.13.4 | MIT | Appels HTTP |
| socket.io-client | 4.8.3 | MIT | Temps réel |
| react-hook-form | 7.71.1 | MIT | Formulaires |
| @hookform/resolvers | 3.10.0 | MIT | Liaison formulaires ↔ validation |
| zod | 3.25.76 | MIT | Schémas de validation |
| @fullcalendar/core, daygrid, timegrid, list, interaction, react | 6.1.20 | MIT | Calendriers et plannings (édition standard, gratuite) |
| recharts | 2.15.4 | MIT | Graphiques |
| leaflet | 1.9.4 | BSD-2-Clause | Cartes |
| react-leaflet | 4.2.1 | **Hippocratic-2.1** | Composants React pour Leaflet (voir points d'attention) |
| @types/leaflet | 1.9.21 | MIT | Types |
| jspdf | 4.1.0 | MIT | Génération de PDF |
| html2canvas | 1.4.1 | MIT | Capture d'écran d'éléments (PDF) |
| pdfjs-dist | 4.10.38 | Apache-2.0 | Affichage de PDF (Mozilla PDF.js) |
| react-qr-code | 2.0.18 | MIT | Affichage de QR codes |
| @simplewebauthn/browser | 13.3.0 | MIT | Clés d'accès (passkeys) |
| i18next | 25.8.14 | MIT | Traductions |
| i18next-browser-languagedetector | 8.2.1 | MIT | Détection de la langue |
| react-i18next | 16.5.5 | MIT | Traductions dans React |
| date-fns | 3.6.0 | MIT | Dates |
| lucide-react | 0.303.0 | ISC | Icônes |
| react-hot-toast | 2.6.0 | MIT | Notifications à l'écran |
| clsx | 2.1.1 | MIT | Classes CSS conditionnelles |
| tailwind-merge | 2.6.1 | MIT | Fusion de classes Tailwind |
| vite-plugin-pwa | 1.2.0 | MIT | Application installable (PWA) |

### Dépendances de développement

| Bibliothèque | Version | Licence | Usage |
|---|---|---|---|
| vite | 5.4.21 | MIT | Construction |
| @vitejs/plugin-react | 4.7.0 | MIT | Support React dans Vite |
| typescript | 5.9.3 | Apache-2.0 | Vérification des types |
| tailwindcss | 3.4.19 | MIT | Styles |
| postcss | 8.5.6 | MIT | Traitement CSS |
| autoprefixer | 10.4.24 | MIT | Préfixes navigateurs |
| eslint | 8.57.1 | MIT | Analyse du code |
| @typescript-eslint/eslint-plugin | 6.21.0 | MIT | Règles ESLint TypeScript |
| @typescript-eslint/parser | 6.21.0 | BSD-2-Clause | Analyseur TypeScript pour ESLint |
| eslint-plugin-react-hooks | 4.6.2 | MIT | Règles des hooks React |
| eslint-plugin-react-refresh | 0.4.26 | MIT | Règles du rechargement à chaud |
| vitest | 4.0.18 | MIT | Tests |
| jsdom | 28.1.0 | MIT | DOM simulé pour les tests |
| @testing-library/react, dom, jest-dom | 16.3.2 · 10.4.1 · 6.9.1 | MIT | Tests des composants |
| @types/react, @types/react-dom | 18.3.x | MIT | Types |

---

## 5. Dépendances transitives aux licences particulières

La grande majorité des dépendances indirectes est sous MIT, ISC, BSD ou Apache-2.0. Liste des exceptions :

| Paquet | Côté | Licence | Remarque |
|---|---|---|---|
| @img/sharp-libvips-* (selon la plateforme) | serveur | LGPL-3.0-or-later | Binaires de libvips pour `sharp` (voir points d'attention) |
| @react-leaflet/core 2.1.0 | client | Hippocratic-2.1 | Voir points d'attention |
| argparse 2.0.1 | les deux | Python-2.0 | Permissive |
| big-integer 1.6.52 | serveur | Unlicense | Domaine public |
| caniuse-lite | les deux | CC-BY-4.0 | Données des navigateurs, utilisées à la construction |
| mdn-data | client (dev) | CC0-1.0 | Domaine public |
| pako | les deux | MIT et Zlib | Permissive |
| expand-template 2.0.3 | serveur | MIT ou WTFPL | Permissive |
| rc 1.2.8 | serveur | BSD-2 / MIT / Apache-2.0 au choix | Permissive |
| json-schema 0.4.0 | client | AFL-2.1 ou BSD-3-Clause | Retenir BSD-3-Clause |
| rgbcolor 1.0.1 | client (optionnel) | MIT | Permissive |
| chainsaw, traverse, buffers | serveur | MIT/X11 | Permissive |
| busboy, streamsearch, seq-queue, exit, spawn-command, xmlhttprequest-ssl | les deux | MIT (d'après leur fichier `LICENSE` ; le champ manque dans `package.json`) | Permissive |

Aucune dépendance n'impose de licence copyleft forte (GPL / AGPL) au code de l'application.

---

## 6. Services et ressources externes

| Service | Usage dans l'application | Conditions d'utilisation |
|---|---|---|
| **OpenStreetMap** — tuiles `tile.openstreetmap.org` | Fonds de carte, captures de plan (`src/services/captureCarte.service.ts`) | Données sous **ODbL 1.0**. Attribution « © les contributeurs OpenStreetMap » obligatoire. [Politique d'usage des tuiles](https://operations.osmfoundation.org/policies/tiles/) : pas de téléchargement massif, cache recommandé. |
| **Nominatim** (OpenStreetMap) | Géocodage d'adresses et géocodage inverse (`client/src/lib/geocodage.ts`, `CaptureCarte.tsx`) | [Politique d'usage](https://operations.osmfoundation.org/policies/nominatim/) : 1 requête par seconde au maximum, pas de saisie semi-automatique à chaque frappe. |
| **IGN — Géoplateforme** (`data.geopf.fr`) | Photographies aériennes et Plan IGN v2 | **Licence Ouverte Etalab 2.0** : réutilisation libre avec mention « © IGN — Géoplateforme » (elle est incrustée dans les captures). |
| **Google Fonts** — police Inter | Typographie de l'interface | Police sous **SIL OFL 1.1**. Point RGPD : voir points d'attention. |
| **Nextcloud** (WebDAV / OCS) | Dépôt et partage de documents (`src/routes/nextcloud.routes.ts`, `src/services/webdav.service.ts`) | Logiciel sous **AGPL-3.0**, utilisé comme service distinct par ses API : aucune obligation pour l'application. |
| **Euro-Office** (fork d'ONLYOFFICE), via Nextcloud | Conversion de documents Word en PDF (`src/services/conversionPdf.service.ts`) | ONLYOFFICE / Euro-Office sous **AGPL-3.0**, utilisés comme service distinct : aucune obligation pour l'application. |
| Serveur **SMTP** | Envoi des courriels | Selon le fournisseur retenu par la collectivité. |

---

## 7. Récapitulatif des licences rencontrées

| Licence | Type | Obligation principale |
|---|---|---|
| MIT, MIT-0, ISC, BSD-2/3-Clause, 0BSD, Zlib, Python-2.0, BlueOak-1.0.0 | Permissives | Conserver la mention de copyright et le texte de la licence (sauf MIT-0 et 0BSD) |
| Apache-2.0 | Permissive | Idem, plus conserver les fichiers `NOTICE` et signaler les modifications |
| Unlicense, CC0-1.0, domaine public (SQLite) | Domaine public | Aucune |
| CC-BY-4.0 | Contenu (données) | Attribution |
| LGPL-3.0 | Copyleft faible | Permettre le remplacement de la bibliothèque ; fournir ses sources en cas de redistribution |
| GPL-2.0 (serveur MySQL), AGPL-3.0 (Nextcloud, Euro-Office) | Copyleft fort | Aucune ici : ce sont des services séparés, jamais intégrés au code |
| Hippocratic-2.1 | Éthique, non OSI | Respect de principes de droits humains ; incompatible avec une définition stricte du logiciel libre |
| ODbL 1.0 (données OSM), Licence Ouverte 2.0 (IGN) | Données | Attribution ; l'ODbL impose aussi le partage à l'identique des bases de données dérivées |
| SIL OFL 1.1 (police Inter) | Police | Pas de revente isolée de la police |
