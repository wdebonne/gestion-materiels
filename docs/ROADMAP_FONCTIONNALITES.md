# 🗺️ Roadmap des Fonctionnalités - Gestion Matériels

> Document de suivi des fonctionnalités du projet.
> Créé le 6 mars 2026 — état vérifié contre le code le 29 août 2026.

---

## 📊 Récapitulatif par priorité

Les statuts ci-dessous ont été vérifiés dans le code, pas déduits de l'interface. Une fonctionnalité dont l'écran existe mais que rien ne relit est marquée ⚠️, pas ✅.

| # | Priorité | Fonctionnalité | Statut | Réserve |
|---|----------|---------------|--------|---------|
| 1 | 🔴 Haute | QR Codes matériels | ✅ Fait | Génération, scan terrain et impression en lot |
| 2 | 🔴 Haute | Import/Export CSV & Excel | ✅ Fait | Colonnes reconnues par leur intitulé, export réimportable |
| 3 | 🔴 Haute | Tests automatisés | ✅ Fait | 131 tests (87 backend, 44 frontend) |
| 4 | 🟠 Moyenne | Réservation / Prêt de matériel | ✅ Fait | Disponibilité affichée avant l'envoi depuis août 2026 |
| 5 | 🟠 Moyenne | Amortissement / Dépréciation | ✅ Fait | |
| 6 | 🟠 Moyenne | PWA (Progressive Web App) | 🟡 Partiel | Installation et cache ✅ — les **notifications push** ne sont pas implémentées |
| 7 | 🟡 Basse | Cartographie GPS (Leaflet) | 🟡 Partiel | Carte et saisie GPS ✅ — le **géocodage d'adresses** n'existe pas |
| 8 | 🟡 Basse | Timeline historique matériel | ✅ Fait | |
| 9 | 🟡 Basse | Reporting périodique automatique | ✅ Fait | Rapport hebdomadaire réellement envoyé le lundi à 7h |
| 10 | 🟢 Optionnel | Dark Mode | ✅ Fait | Étendu à l'ensemble des pages |
| 11 | 🟢 Optionnel | Internationalisation (i18n) | ⚠️ Abandonné | `useTranslation` n'est utilisé que dans 1 fichier sur 60. La détection automatique a été **retirée** : elle basculait l'interface en anglais sur une tablette anglophone, sans retour possible. La langue est verrouillée en français |
| 12 | 🟢 Optionnel | WebSocket temps réel | ✅ Fait | |
| 13 | 🔴 Haute | Authentification SSO / LDAP / Passkey | ⚠️ Écrans seulement | La configuration SSO est enregistrée dans `auth_config` et **relue par personne** : la connexion reste en bcrypt local. En revanche la politique de mot de passe, le blocage après N tentatives et l'expiration sont désormais appliqués |
| 14 | 🔴 Haute | Manifestations | ✅ Fait | Historique, fiche PDF, réception signée, stock réel/prévisionnel, services et approbations, documents pré-remplis par service, export Nextcloud — août 2026 |
| 15 | 🔴 Haute | Espaces Verts | ✅ Fait | |
| 16 | 🔴 Haute | Ergonomie terrain (rôle agent, hors-ligne, scan, photo, GPS) | ✅ Fait | Voir la section dédiée plus bas |
| 17 | 🔴 Haute | Consolidation structurelle (index, migrations, types, tests) | 🟡 Partiel | Voir la section dédiée plus bas |

**Légende** — ✅ fonctionne · 🟡 fonctionne partiellement, écart documenté · ⚠️ visible dans l'interface mais sans effet

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

> ✅ **Complété en août 2026 :** depuis une catégorie ou une sous-catégorie, un bouton « Étiquettes QR » ouvre la sélection des matériels et imprime une planche A4 — deux colonnes de 95 × 52 mm, QR code, nom et référence. Les lots de plus de 100 matériels sont découpés automatiquement, la limite du serveur.
>
> La génération était par ailleurs accessible à tout compte authentifié, sans filtrage par catégorie : elle renvoyait nom, référence et numéro de série pour des identifiants arbitraires, ce qui permettait d'énumérer l'inventaire en incrémentant des nombres. Elle applique désormais le même filtre que la liste des matériels.

### 2. Import/Export CSV & Excel
- **Description :** Importer massivement des matériels depuis un fichier CSV/Excel, et exporter la base avec filtres.
- **Fonctionnalités :**
  - Import CSV/Excel avec mapping de colonnes
  - Validation des données avant import
  - Export filtrable (par catégorie, statut, etc.)
  - Template de fichier d'import téléchargeable
- **Librairies :** `xlsx` ou `exceljs`
- **Impact :** Indispensable pour migration initiale et inventaires annuels

> ✅ **Complété en août 2026 :** les colonnes sont reconnues par leur intitulé — accents, astérisques et parenthèses ignorés — quel que soit leur ordre, et une colonne inconnue est simplement écartée. La reconnaissance est affichée avant l'import, avec le nombre de lignes et la première ligne telle qu'elle sera lue, et chaque colonne reste corrigeable à la main. Un fichier sans ligne d'en-tête est toujours lu dans l'ordre du modèle.
>
> Le cas qui motivait ce chantier : l'export de l'application commence par une colonne `ID` que le modèle n'a pas. Elle décalait tout d'un cran, et chaque ligne échouait sur « Catégorie introuvable » — exporter, corriger dans un tableur, réimporter, le geste naturel d'un inventaire annuel, était donc impossible.
>
> ✅ **Complété en août 2026 :** les filtres catégorie, sous-catégorie et statut sont exposés dans l'écran, avec le nombre de matériels concernés annoncé avant le téléchargement — sans quoi on récupère un classeur vide sans comprendre pourquoi. L'export est par ailleurs cloisonné par les permissions de catégorie, comme la liste des matériels : il n'avait que `authenticateToken`, donc n'importe quel compte récupérait l'inventaire complet. Et chaque CSV commençait par deux lignes d'en-tête identiques.

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

> ✅ **Complété en août 2026 :** la disponibilité est vérifiée pendant la saisie. Les créneaux déjà pris sont affichés avec leur emprunteur, le bouton de création reste inactif tant que la période demandée est occupée, et les demandes en attente de validation sont signalées sans bloquer — sans quoi deux agents demandent le même créneau et l'un des deux attend indéfiniment.
>
> Le filtre de chevauchement est écrit à un seul endroit, partagé par la vérification et la création : s'ils divergeaient, l'écran annoncerait « disponible » puis le serveur répondrait 409, ce qui est pire que de ne rien annoncer.

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

> 🟡 **Reste :** les notifications push ne sont pas implémentées (aucun appel à `PushManager` ni à `Notification.requestPermission`). Installation, cache et service worker fonctionnent. La mise à jour ne se fait plus automatiquement : un bandeau la propose, parce que le rechargement survenait au milieu d'une saisie.

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

> ⚠️ **État réel des fournisseurs SSO :** seuls les écrans de configuration existent. Chacun affiche désormais un bandeau qui le dit — la décision de finir ou de retirer ces écrans reste ouverte, mais ils ne laissent plus croire que l'authentification est déléguée. La partie de `auth_config` qui les concerne est écrite par cette page et **relue par personne** — aucun fichier de `src/` ne l'interroge en dehors de sa propre route. La connexion reste en bcrypt local, et le bouton « Tester » ne fait que vérifier la forme de l'URL saisie.
>
> Un écran qui *simule* un SSO est plus dangereux qu'une absence de SSO : il fait croire à un administrateur que l'authentification est déléguée alors qu'elle ne l'est pas. À finir ou à retirer.
>
> ✅ **Appliqué depuis août 2026 :** longueur et complexité du mot de passe, vérifiées aux six endroits où un mot de passe est défini ; blocage du compte après N échecs pendant une durée configurable, avec déblocage par réattribution d'un mot de passe ; expiration signalée par un bandeau. Les trois réglages qui ne pouvaient pas l'être — connexion locale, 2FA, timeout de session — ont été retirés du formulaire et remplacés par un encart qui explique pourquoi.
>
> L'expiration signale au lieu de bloquer : refuser l'accès à un agent au fond d'un parc parce que son mot de passe a 91 jours l'empêcherait de travailler sans rien protéger de plus.

### 14. Manifestations (gestion matériel événementiel)
- **Description :** Plugin système pour gérer les manifestations/événements avec prêt, livraison et récupération de matériel.
- **Fonctionnalités :**
  - **Gestion de stock dédié** : Catalogue matériel avec quantités totales, disponibles (temps réel), prêtées et réservées (prévisionnel)
  - **Manifestations** : CRUD complet avec dates, horaires, nombre de personnes attendues, notes intérieures/extérieures
  - **Workflow de statut** : À confirmer → Brouillon → Validé → Livré → Récupéré → Archivé (+ Annulé), transitions contrôlées serveur
  - **Contact livraison** : Nom, téléphone, email, adresse de livraison, dates de livraison et de récupération
  - **Matériel par manifestation** : Quantités demandées, livrées, récupérées et perdues, avec suivi unitaire
  - **Impact stock automatique** : Validation réserve le stock, livraison l'engage, récupération le restitue, une perte le diminue
  - **Réception de demandes** : dépôt signé depuis une application de formulaires, correspondance des champs configurable
  - **Matériel unique** : un véhicule ou un matériel identifié du parc se rattache à une manifestation, sans passer par une quantité
  - **Archivage** : Manifestations terminées archivables et consultables en lecture seule
  - **Filtres** : Par statut, dates, recherche textuelle
  - **Stats dashboard** : Total, à venir, en livraison, archivées, articles en stock
- **Tables BDD :** `manifestation_stock`, `manifestations`, `manifestation_materials`, `manifestation_history`, `manifestation_intake_sources`, `manifestation_intake_requests`, `manifestation_stock_aliases`, `manifestation_stock_movements`, `services`, `service_categories`, `service_members`, `manifestation_approvals`, `manifestation_messages`, `manifestation_watchers`, `manifestation_export_profiles`, `manifestation_items`, `notification_preferences`, `service_delegations`, `manifestation_documents`, `manifestation_doc_types`, `service_templates`
- **Routes API :** `/api/manifestations` — CRUD stock, CRUD manifestations, transitions statut, matériel, stats, disponibilité
- **Frontend :** 3 onglets (Manifestations, Stock, Archives), modales détail et livraison, panneau de suivi (approbations, échanges, copies), écrans Réglages › Réception manifestations et Réglages › Services
- **Impact :** Suivi complet du matériel prêté pour événements, visibilité stock en temps réel

> ✅ **Complété en août 2026 :** chaque action est consignée dans `manifestation_history` — création, modification, validation, livraison, récupération, mise à jour des quantités — avec son auteur, sa date et un commentaire facultatif. La timeline s'affiche dans le détail, et `GET /:id/history` la sert seule.
>
> La fiche PDF est branchée. Le composant existait sans être importé nulle part, et il était écrit contre une forme de données qui n'a jamais existé : `name` au lieu de `title`, `items` au lieu de `materials`, `res.data` au lieu de `res.data.data`, des statuts en français là où le serveur en stocke d'autres. Chaque champ serait ressorti vide et la génération se serait arrêtée sur `detail.name.replace`.
>
> `PUT /:id/materials` refuse désormais une mise à jour qui ne touche aucune ligne, au lieu de répondre 200.
>
> ✅ **Réception et stock réel, août 2026 :** les demandes arrivent d'une application de formulaires par `POST /api/manifestations/intake/:slug`, signées HMAC sur les octets exacts du corps, idempotentes, journalisées. La correspondance entre le JSON reçu et les champs d'une manifestation est une donnée réglée dans l'interface, pas du code — chaque formulaire nomme ses champs à sa façon et changera.
>
> Le prévisionnel et le réel sont désormais deux comptes distincts, écrits une seule fois dans `manifestationStock.service.ts`. Ils étaient mélangés et réécrits à la main dans chaque route, et aucune ne savait répondre sur une période. Une manifestation ne compte que dans un seul des deux selon son statut : sans cette séparation, une manifestation livrée était comptée deux fois.
>
> La casse et le vol diminuent le stock physique et laissent un mouvement tracé. Seul l'écart est appliqué : réenregistrer la même perte ne retire pas une deuxième fois.
>
> ⚠️ **Fuite fermée :** `GET /manifestations`, `GET /:id`, `/stock` et `/stock/availability` étaient lisibles par tout compte authentifié — seules les écritures étaient gardées. `objectScope.ts` ne couvrait que la table `objects`, et son test de non-régression ne cherche que cette chaîne. Règle écrite dans `manifestationScope.ts`.
>
> ✅ **Services et suivi partagé, août 2026 :** un service est un groupe de personnes *et* un périmètre de catégories. C'est ce périmètre qui décide de tout — un service n'est sollicité, alerté et destinataire que si la manifestation demande du matériel de ses catégories. Avant, le choix se réduisait à « tout le monde reçoit tout » ou « personne ne reçoit rien » : `group_permissions.role` désigne un rôle, pas un groupe de personnes.
>
> Chaque service concerné approuve sa part, avec ses propres dates de livraison et de récupération, et la validation reste bloquée tant qu'il n'a pas répondu. Les services échangent dans un fil consigné à l'historique ; une direction générale ou des élus peuvent être mis en copie sans rien approuver.
>
> Le rôle `service` ouvre le seul module Manifestations. Le cloisonnement est **fermé par défaut** — tout `/api/*` est refusé sauf une liste blanche — et appliqué au point unique où le rôle devient connu, jetons API compris.
>
> ✅ **Export et dépôt Nextcloud, août 2026 :** 24 colonnes disponibles, dont l'état de chaque approbation et les services encore attendus. Les profils disent quelles colonnes, dans quel ordre et sous quel intitulé — une donnée, pas du code. Le dépôt WebDAV est à sens unique : l'application reste la source de vérité. La vérification de configuration dépose réellement un fichier témoin plutôt que de valider la forme des champs, et le redépôt automatique est regroupé sur une minute.
>
> ✅ **Matériel unique et notifications réglables, août 2026 :** une demande porte désormais deux natures de matériel — des quantités et des exemplaires identifiés choisis dans le parc. `manifestation_items`, créée à l'origine et jamais utilisée, est en service : un conflit y est toujours réel, et les réservations sont lues au passage puisque les deux circuits engagent le même parc.
>
> Les notifications se règlent à trois niveaux : défaut de la collectivité par événement et par rôle, réglage de chaque service, choix de chaque compte. Ce qui engage son destinataire — une approbation attendue — part toujours.
>
> ✅ **Responsables, délégations et coordination, août 2026 :** `is_manager` était enregistré sans entrer dans aucune décision ; seul le responsable d'un service approuve désormais en son nom, et lui seul délègue. Un **service coordinateur** pilote toutes les manifestations : sollicité sur chacune, destinataire de tout, son approbation prononce la validation — mais seulement une fois les services concernés ont répondu.
>
> ✅ **Matériel prêtable, août 2026 :** le sélecteur proposait tout le parc. Le réglage existe désormais à trois niveaux — catégorie, sous-catégorie, matériel — avec trois états, le plus précis l'emportant. Un compte à deux casquettes (service technique et service communication) voit enfin les manifestations dont son service est l'approbateur : les deux portées s'additionnent au lieu de s'ignorer.
>
> ✅ **Prestations et pièces jointes, août 2026 :** une case à cocher transforme un article en prestation — raccordement, débit de boissons, personnel. Le routage d'approbation partant déjà de la catégorie de l'article, une prestation classée « Urbanisme » sollicite l'urbanisme sans code supplémentaire. Les pièces jointes conservent arrêtés, plans, constats et photos, avec une description qui entre dans la recherche ; supprimer une pièce retire aussi le fichier, ce que l'application ne faisait nulle part ailleurs. La fiche est passée en cinq onglets.
>
> ⚠️ **Traçabilité préservée :** supprimer un compte effaçait la ligne, et chaque `ON DELETE SET NULL` vidait l'auteur des décisions, des messages et de l'historique. Un compte qui a laissé des traces est désormais désactivé, jamais effacé ; l'anonymisation retire l'identité en conservant les liens, ce que le RGPD demande sans détruire la traçabilité.
>
> ✅ **Document pré-rempli par service, août 2026 :** un modèle `.docx` écrit dans Word est rattaché à un service depuis l'écran des services ; ses champs entre accolades sont relevés à l'import et reliés en un clic à une donnée de la demande. Chaque service ne reçoit que **sa part** — celui qui instruit un débit de boissons n'a que faire du raccordement électrique ni du nombre de chaises — et seul le coordinateur reçoit l'ensemble. Le document est joint à la manifestation et part en pièce jointe de la demande d'approbation.
>
> `easy-template-x` (MIT) a été retenue plutôt que Carbone, cité en exemple : Carbone n'est pas distribuable sous la licence de cette application et demande LibreOffice à côté. Surtout, cette bibliothèque **n'exécute aucun code venu du modèle**, ce qui compte quand les modèles sont déposés dans un Nextcloud partagé. Les champs sont détectés en recollant les runs d'un paragraphe : Word coupe volontiers `{date_livraison}` sur plusieurs `<w:t>`, et sans ce recollage un modèle valide paraîtrait vide de champs.
>
> Le modèle peut être tenu dans Nextcloud et **relu à chaque génération** : on le corrige à un seul endroit. Un modèle défaillant ne bloque jamais une manifestation — l'erreur est notée et affichée, la demande suit son cours.
>
> ✅ **Essai de webhook à blanc, août 2026 :** régler une source demandait de deviner les chemins qu'un formulaire enverrait, et la seule vérification possible était une vraie demande — qui créait une manifestation, réservait du matériel et écrivait aux services. L'écran d'essai dit ce qui *serait* arrivé sans rien créer : recevabilité, matériel reconnu, services alertés, modèles en place. Les services sont par ailleurs sollicités **dès la réception**, et non plus au moment où quelqu'un ouvre la demande.
>
> ⚠️ **Fichiers orphelins :** supprimer une manifestation laissait ses pièces jointes sur le disque pour toujours, et supprimer un service laissait le fichier de son modèle. Les lignes partaient en cascade, pas les fichiers.
>
> ✅ **Prestations tenues dans le parc, août 2026 :** l'arbre des catégories était déjà partagé entre le parc et le stock des manifestations ; il ne manquait que de pouvoir dire « cette branche, ce sont des prestations ». Le réglage existe aux trois niveaux, le plus précis l'emportant, et se fait sur la fiche de la catégorie, de la sous-catégorie ou du matériel — là où le service travaille déjà. L'organisation visée est celle où la **catégorie est le service**, ce qui fait tomber le routage d'approbation sans une ligne de plus. Une prestation du parc n'immobilise rien, se demande en nombre, et entre dans le document envoyé à son service.
>
> ⚠️ **Le matériel du parc ne sollicitait aucun service :** `servicesConcernes` ne lisait que `manifestation_materials`. Une manifestation composée uniquement de matériel du parc ne sollicitait personne, et sa validation passait sans approbation — le tableau vide ressemblant à « rien à approuver ». `manifestation_items` était en service depuis le lot « matériel unique » sans que le routage ait jamais été réconcilié avec elle.
>
> ✅ **Matériel du parc en lot, août 2026 :** le parc ne comptait que des exemplaires, et les quantités vivaient dans un catalogue séparé — on tenait donc ses chaises à deux endroits. Un matériel se déclare désormais *exemplaire unique* ou *lot avec quantité*, et les manifestations s'imputent directement sur cette quantité : le stock réel et prévisionnel se lit sur la fiche de parc. L'arithmétique est celle du stock des manifestations, constantes importées et non recopiées.
>
> Un lot perd carburant et contrôle technique — ces suivis portent sur un exemplaire, pas sur un modèle — et garde ses entretiens. Le filtre est posé côté serveur, si bien que la donnée cesse d'être chargée en même temps que l'onglet disparaît. Un lot ne connaît pas le conflit mais le manque, chiffré et signalé comme un avertissement : deux manifestations se partagent cent chaises, elles ne se partagent pas le camion.
>
> 🟡 **Limite connue :** « dehors en ce moment » se calcule sur la journée courante. Une manifestation livrée dont la période est passée sans avoir été marquée récupérée n'apparaît pas comme sortie — comportement hérité du stock des manifestations, inchangé.
>
> ✅ **Coût réel d'une manifestation, août 2026 :** un coût unitaire sur la fiche du matériel — prix d'une unité pour un lot, vacation pour une prestation, valeur de remplacement pour un exemplaire — et un décompte sur la manifestation, en deux natures jamais confondues : ce qu'on déploie et ce qui ne revient pas. Chaque ligne dit sur quoi elle repose. Le calcul se fait à la lecture, jamais stocké : les prix bougent et les retours se saisissent après coup.
>
> Le point qui compte : une chaise sortie n'est pas une chaise perdue. Le manque n'entre au total qu'une fois la manifestation récupérée — sauf `quantity_lost`, saisie à la main, qui est déjà un constat. Trois colonnes d'export s'ajoutent, calculées seulement si le profil les retient.
>
> ✅ **Disponibilité en prêt sur la fiche, août 2026 :** le réglage ne vivait que dans l'écran d'arbre des réglages, alors que la question se pose au moment où l'on crée le matériel. Il est désormais sur la fiche du matériel, de la sous-catégorie et de la catégorie, avec le même héritage à trois niveaux ; l'écran d'arbre reste pour trancher en masse.
>
> ⚠️ **Réglage invisible à la relecture :** les lectures de catégorie et de sous-catégorie ne rendaient ni `is_prestation` ni `available_for_manifestations`. La valeur était enregistrée, mais le formulaire réaffichait « Hérité » à la réouverture — on ne pouvait pas vérifier ce qu'on avait coché.
>
> 🟡 **Reste :** `PUT /:id` ignore le champ `status` — le statut se change uniquement via `PUT /:id/status`.

### 15. Espaces Verts (gestion espaces verts municipaux)
- **Description :** Plugin système complet pour la gestion des espaces verts avec plan interactif annoté, composition botanique, entretiens et intégrations transversales.
- **Fonctionnalités :**
  - **Plan interactif** : Upload d'image du plan, placement de repères par clic avec drag & drop, popup persistant au clic, labels visibles sous les repères
  - **Éléments du plan** : 8 types (arbre, arbuste, massif floral, haie, pelouse, bassin, mobilier, autre) avec état de santé, dimensions, espèce, photo
  - **Modale visualisation élément** : Clic sur un élément ouvre une fiche détaillée (image, type, état, espèce, quantité, superficie, prix, dates, position, description, historique d'entretiens liés) avec boutons édition/suppression
  - **Groupes de composition** : Regroupement logique d'éléments (massif, zone, alignement, haie, autre) avec couleur
  - **Zones polygonales** : Dessin de zones par clics successifs sur le plan
  - **Légende interactive** : Filtrage par type et groupe, codes couleur des états
  - **Entretiens** : Historique avec type, date, intervenant, durée, coût, éléments concernés, documents joints (upload direct), recherche/filtre textuel
  - **Gestion des types d'entretien** : Types par défaut en BDD (modifiables, désactivables), ajout de types personnalisés, modale de gestion complète
  - **Gestion des types de documents** : Types par défaut en BDD (modifiables, désactivables), ajout de types personnalisés, modale de gestion complète
  - **Documents** : Upload, catégorisation par type, recherche/filtre textuel
  - **Liaison documents-éléments** : Association de documents à des éléments spécifiques via table de jonction, affichage croisé
  - **Mise à jour automatique des dates** : La création ou modification d'un entretien met à jour automatiquement `last_maintenance_date` et `next_maintenance_date` sur les éléments concernés
  - **Options d'espace** : Modale de gestion des types et statuts d'espaces verts (ajout, modification, activation/désactivation)
  - **Clonage d'espace** : Copie vierge ou avec éléments sélectionnés, statut initial configurable (projet → travaux → actif), snapshot automatique avant clonage, copie des annotations et groupes liés
  - **Archives & Snapshots** : Capture de l'état complet (plan, éléments, annotations, groupes) à un instant T, liste chronologique, vue détaillée du plan archivé avec annotations
  - **Comparaison de versions** : Mode côte-à-côte entre snapshot archivé et état actuel avec résumé des différences (éléments, annotations, groupes)
  - **Historique de l'espace source** : Accès aux documents et entretiens de l'espace original si l'espace est un clone
  - **Gestion des types de groupes** : Modale CRUD (ajout/modification/activation/suppression) pour les types de groupes de composition — 8 types par défaut (massif, haie, bosquet, rocaille, jardinière, plate-bande, mixed border, autre) avec icône et couleur personnalisables
  - **Remplacement d'éléments avec historique** : Archivage automatique de l'état complet avant remplacement — contexte saisonnier (printemps/été/automne/hiver/annuel), année, raison — timeline visuelle des versions précédentes pour traçabilité (ex: compositions été vs hiver)
  - **Export PDF du plan** : Plan annoté en paysage + légende + tableaux détaillés via jsPDF + html2canvas
  - **Intégration Alertes** : Les entretiens avec date d'échéance prochaine génèrent automatiquement des alertes via cron
  - **Intégration Calendrier** : Les entretiens programmés créent automatiquement un événement calendrier
  - **Intégration Suivi** : Les coûts d'entretien apparaissent dans le module Suivi avec filtre et tableau dédiés
- **Tables BDD :** `green_spaces`, `green_space_elements`, `green_space_annotations`, `green_space_seasons`, `green_space_documents`, `green_space_element_groups`, `green_space_maintenances`, `green_space_maintenance_elements`, `green_space_maintenance_documents`, `green_space_doc_types`, `green_space_maintenance_types`, `green_space_document_elements`, `green_space_snapshots`, `green_space_group_types`, `green_space_element_replacements`
- **Routes API :** `/api/green-spaces` — CRUD espaces, éléments, annotations, saisons, documents, groupes, entretiens, types de documents, types d'entretien, types de groupes, remplacement d'éléments, historique remplacements, clonage, snapshots, archives, stats
- **Frontend :** 7 onglets (Éléments, Plan annoté, Carte, Saisons, Documents, Entretien, Archives), modale clonage, export PDF
- **Impact :** Gestion complète des espaces verts communaux avec vision cartographique et suivi des interventions

---

## 🔴 Priorité Haute

### 16. Ergonomie terrain

- **Contexte :** l'application avait été construite pour un utilisateur qui ressemblait à son développeur. Les utilisateurs réels sont des agents de métier manuel — jardiniers, mécaniciens, chauffeurs — sur téléphone, dehors, parfois avec des gants et sans réseau.
- **Trois problèmes de fond corrigés :**
  1. **L'application mentait.** Un compte « utilisateur » ne pouvait écrire nulle part, mais l'interface lui affichait quand même « Ajouter un plein ». Il remplissait le formulaire, appuyait sur Ajouter, et il ne se passait rien : le 403 n'était pas intercepté.
  2. **La sauvegarde était silencieuse.** La page Espaces Verts comptait 45 `useMutation`, aucun `onError`, aucun message. Enregistrer, supprimer, cloner ou archiver ne produisait aucun retour, ni en succès ni en échec.
  3. **L'ergonomie n'était pas tactile.** Aucun attribut `aria-*` dans tout le client, des boutons-icônes de 18 à 28 px identifiés par une infobulle au survol, les actions Modifier/Supprimer des cartes en `opacity-0 group-hover:opacity-100` — donc inexistantes au doigt — et `text-gray-400` (2,8:1, échec WCAG AA) utilisé 339 fois.

- **Livré :**
  - **Rôle « agent de terrain »** : relevés de plein, entretien, contrôle technique, entretien d'espace vert, photo jointe, demande de réservation. Le référentiel et les suppressions restent au superviseur. Déployé en deux temps — d'abord les boutons honnêtes sans changement de droits, puis l'ouverture des droits une fois la matrice de tests en place
  - **Saisie hors réseau** : file d'attente persistante, liste blanche stricte d'URL, jamais de suppression différée, bandeau permanent tant que la file n'est pas vide, renvoi automatique au retour du réseau
  - **Photo** : capture directe par l'appareil, redimensionnement avant envoi (12 Mo → ~400 Ko), redressement EXIF côté serveur
  - **GPS** : bouton « Utiliser ma position » avec précision affichée et aperçu OpenStreetMap ; la clé Google Maps codée en dur dans le source a été retirée
  - **Scan de QR code** : page `/scan` avec le décodeur natif du navigateur
  - **Listes fermées** pour station-service, prestataire et centre de contrôle — le texte libre fragmentait les rapports de coûts
  - **Validation lisible** sous le champ, côté client puis revalidée côté serveur
  - **Retour systématique** sur chaque enregistrement, message explicite sur 403 et sur perte de réseau
  - **Session expirée** : fenêtre de reconnexion par-dessus l'écran, sans détruire le formulaire en cours
  - **Cibles tactiles ≥ 44 px**, actions visibles sans survol, taille de texte réglable, contraste renforcé, mode sombre complété
  - **Recherche globale**, actions rapides, favoris personnels, barre de navigation basse sur mobile, aide contextuelle par page
  - **Alertes** : état de lecture par utilisateur — « tout marquer comme lu » vidait la pastille de toute la collectivité — et emails envoyés aussi à la personne qui entretient le matériel
- **Impact :** un agent peut enregistrer son propre travail, sans passer par son chef, y compris sans réseau.

### 17. Consolidation structurelle

- **Fait :**
  - **Index de base de données** : 25 index sur 54 tables qui n'en comptaient aucun
  - **Découpage du bundle** : 33 des 37 pages en chargement différé, l'écran de connexion ne télécharge plus leaflet, fullcalendar, recharts et jspdf
  - **Pagination réelle** : au-delà du vingtième matériel, les suivants étaient invisibles
  - **Validation serveur des écritures de terrain** : une charge incomplète produisait un 500 « Erreur serveur » au lieu d'un message utile
  - **Requêtes N+1 supprimées** sur les espaces verts et les manifestations : 120 requêtes → 2 sur une fiche de 60 entretiens
  - **Portée des tokens API appliquée** : elle était analysée puis ignorée
  - **Système de migration versionné** : `npm run db:migrate` pointait vers un fichier inexistant
  - **Types vérifiés à la construction de l'image** : la production était le seul endroit où le code n'était jamais type-checké. Client passé de 76 à 0 erreur de type
  - **Lint client réparé** : le script existait, les plugins étaient installés, aucun fichier de configuration n'existait
  - **131 tests** contre 36
- **Reste à faire :**
  - Découpage des fichiers-monstres (`EspacesVertsPage.tsx` ~5 700 lignes, `ObjectDetailPage.tsx` ~2 800 lignes, `espaceVert.routes.ts` ~1 500 lignes) — à faire au fil de l'eau, pas en sprint dédié
  - Types partagés entre client et serveur (449 avertissements ESLint restants, presque tous des `any`)
  - Les requêtes du cron encadrent leurs colonnes de dates dans `date()`, ce qui empêche les index correspondants de servir
