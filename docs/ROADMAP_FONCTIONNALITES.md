# 🗺️ Roadmap des Fonctionnalités - Gestion Matériels

> Document de suivi des fonctionnalités du projet.
> Créé le 6 mars 2026 — état vérifié contre le code le 29 août 2026.

---

## 📊 Récapitulatif par priorité

Les statuts ci-dessous ont été vérifiés dans le code, pas déduits de l'interface. Une fonctionnalité dont l'écran existe mais que rien ne relit est marquée ⚠️, pas ✅.

| # | Priorité | Fonctionnalité | Statut | Réserve |
|---|----------|---------------|--------|---------|
| 1 | 🔴 Haute | QR Codes matériels | 🟡 Partiel | Génération et scan terrain ✅ — l'**impression en lot** n'a pas d'écran, alors que `POST /api/qrcode/batch` existe |
| 2 | 🔴 Haute | Import/Export CSV & Excel | 🟡 Partiel | Export filtrable et cloisonné ✅ — l'import reste en mapping **positionnel strict** sur 11 colonnes |
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
| 14 | 🔴 Haute | Manifestations | 🟡 Partiel | Stock, workflow et export ✅ — la table `manifestation_history` n'est **ni écrite ni lue**, et `ManifestationPDFExport.tsx` n'est importé nulle part |
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

> 🟡 **Reste :** l'impression d'étiquettes en lot n'a pas d'écran. `POST /api/qrcode/batch` renvoie jusqu'à 100 étiquettes en data-URL et n'est appelé par personne : les QR codes s'impriment un par un.

### 2. Import/Export CSV & Excel
- **Description :** Importer massivement des matériels depuis un fichier CSV/Excel, et exporter la base avec filtres.
- **Fonctionnalités :**
  - Import CSV/Excel avec mapping de colonnes
  - Validation des données avant import
  - Export filtrable (par catégorie, statut, etc.)
  - Template de fichier d'import téléchargeable
- **Librairies :** `xlsx` ou `exceljs`
- **Impact :** Indispensable pour migration initiale et inventaires annuels

> 🟡 **Reste :** le mapping de colonnes annoncé n'existe pas — l'import est **positionnel strict** sur 11 colonnes, le fichier doit suivre exactement le modèle téléchargeable.
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

> ⚠️ **État réel des fournisseurs SSO :** seuls les écrans de configuration existent. La partie de `auth_config` qui les concerne est écrite par cette page et **relue par personne** — aucun fichier de `src/` ne l'interroge en dehors de sa propre route. La connexion reste en bcrypt local, et le bouton « Tester » ne fait que vérifier la forme de l'URL saisie.
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
  - **Workflow de statut** : Brouillon → Validé → Livré → Récupéré → Archivé (+ Annulé), transitions contrôlées serveur
  - **Contact livraison** : Nom, téléphone, email, adresse de livraison, date de livraison
  - **Matériel par manifestation** : Quantités demandées, livrées, récupérées avec suivi unitaire
  - **Impact stock automatique** : Validation réserve le stock, livraison l'engage, récupération le restitue
  - **Archivage** : Manifestations terminées archivables et consultables en lecture seule
  - **Filtres** : Par statut, dates, recherche textuelle
  - **Stats dashboard** : Total, à venir, en livraison, archivées, articles en stock
- **Tables BDD :** `manifestation_stock`, `manifestations`, `manifestation_materials`
- **Routes API :** `/api/manifestations` — CRUD stock, CRUD manifestations, transitions statut, matériel, stats, disponibilité
- **Frontend :** 3 onglets (Manifestations, Stock, Archives), modales détail et livraison
- **Impact :** Suivi complet du matériel prêté pour événements, visibilité stock en temps réel

> 🟡 **Reste :** la table `manifestation_history` est créée mais **ni écrite ni lue**, et `ManifestationPDFExport.tsx` n'est importé nulle part — la timeline horodatée et l'export PDF annoncés n'existent donc pas à l'écran. Par ailleurs `PUT /:id` ignore le champ `status` (il faut passer par `PUT /:id/status`), et `PUT /:id/materials` répond 200 même quand aucune ligne n'est modifiée.

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
