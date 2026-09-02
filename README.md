# 🚗 Gestion Matériels

Application web de gestion du matériel municipal (véhicules, tondeuses, équipements divers).

![Version](https://img.shields.io/badge/version-1.3.1-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)
![React](https://img.shields.io/badge/React-18-61dafb.svg)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-38bdf8.svg)

## ✨ Points forts

- 🎨 **Interface moderne** avec effets Glassmorphism et animations fluides
- 🔌 **Système de plugins** extensible avec import ZIP
- 📱 **Design responsive** adapté mobile et desktop
- 🔒 **Sécurisé** avec authentification JWT
- 📖 **Documentation API Swagger** interactive intégrée
- 🌙 **Dark Mode** avec persistance des préférences
- 📝 **Interface en français**, verrouillée (la détection automatique a été retirée : elle basculait une application francophone en anglais sur une tablette configurée en anglais, sans moyen d'en sortir)
- 📲 **PWA installable** sur mobile avec cache hors-ligne
- ⚡ **Temps réel** via WebSocket (Socket.io)
- 📴 **Saisie hors réseau** conservée et rejouée au retour de la connexion
- 🐳 **Docker ready** pour un déploiement facile

## 📋 Fonctionnalités

### Gestion des utilisateurs
- 🔐 Authentification sécurisée (JWT)
- 👥 **Quatre rôles** : Administrateur, Superviseur, **Agent de terrain**, Utilisateur
- 🔑 Réinitialisation de mot de passe par email
- 👤 Profil utilisateur personnalisable
- ✅ **Rester connecté** : coché, la session survit à la fermeture du navigateur ; décoché, elle disparaît avec l'onglet — à utiliser sur un poste partagé

#### Le rôle « Agent de terrain »

Pour relever un plein, un jardinier devait auparavant être promu **superviseur**, ce qui lui donnait au passage la suppression des espaces verts, la gestion du stock des manifestations et les seuils d'alerte.

Un cinquième rôle, **service partenaire**, ouvre le seul module Manifestations : le service communication suit les manifestations, le service informatique approuve le prêt d'un vidéoprojecteur. Ni l'un ni l'autre n'a à voir le parc, les entretiens ou les pleins de carburant. Le cloisonnement est fermé par défaut — tout `/api/*` lui est refusé sauf une liste blanche explicite.

L'agent de terrain peut faire les gestes du quotidien — relevé de plein, entretien, contrôle technique, entretien d'espace vert, photo jointe, demande de réservation — et rien d'autre. Le référentiel (types, statuts, groupes, seuils) et toutes les suppressions restent au superviseur.

| Geste | Utilisateur | Agent | Superviseur | Admin |
|-------|:-----------:|:-----:|:-----------:|:-----:|
| Consulter | ✓ | ✓ | ✓ | ✓ |
| Relevé de plein, entretien, contrôle | | ✓ | ✓ | ✓ |
| Joindre une photo | | ✓ | ✓ | ✓ |
| Créer / modifier un matériel | | | ✓ | ✓ |
| Gérer le référentiel et supprimer | | | ✓ | ✓ |
| Utilisateurs, sauvegardes, permissions | | | | ✓ |

### Gestion du matériel
- 📁 Organisation par catégories et sous-catégories
- 🎴 Affichage en cartes avec images
- 📝 Fiches détaillées pour chaque objet
- 🔍 Recherche et filtres avancés
- 📊 Champs personnalisés et spécifications

### 📲 Usage terrain

L'application est utilisée par des agents de terrain — jardiniers, mécaniciens, chauffeurs — souvent sur téléphone, dehors, parfois avec des gants et sans réseau.

**Saisie**
- 📴 **Hors réseau** : un relevé de plein, d'entretien ou de contrôle saisi sans connexion est conservé et renvoyé automatiquement au retour du réseau. Un bandeau permanent annonce le nombre de saisies en attente. Liste blanche stricte d'URL, jamais de suppression différée
- 📷 **Photo** : bouton « Prendre une photo » ouvrant l'appareil, redimensionnement avant envoi (une photo de 12 Mo passe à ~400 Ko) et redressement EXIF côté serveur
- 📍 **Position GPS** : bouton « Utiliser ma position » avec précision affichée et aperçu OpenStreetMap, au lieu d'une latitude et d'une longitude à recopier
- 📷 **Scan de QR code** : page `/scan` utilisant le décodeur natif du navigateur, qui ouvre directement la fiche du matériel
- 📋 **Listes fermées** : station-service, prestataire et centre de contrôle sont choisis dans une liste et non tapés librement — « Total Pavilly », « TOTAL Pavilly » et « total pavilly » ne forment plus trois stations distinctes dans les rapports de coûts
- ✅ **Validation lisible** : le message apparaît sous le champ concerné, en français, avant l'envoi ; le serveur revalide et répond 400 avec le même message

**Lecture et navigation**
- 🔎 **Recherche globale** : une seule recherche sur tout le parc (nom, référence, numéro de série, champs personnalisés)
- ⚡ **Actions rapides** sur l'accueil : scanner, faire un plein, chercher, mes matériels
- ⭐ **Mes matériels** : épinglage personnel, propre à chaque utilisateur
- 📱 **Barre du bas sur mobile** : accueil, scan, recherche, alertes, profil
- ❓ **Aide contextuelle** : un bouton `?` par page principale, cinq puces « comment faire »

**Confort de lecture**
- 🔠 **Taille du texte** réglable (normal / grand / très grand) et **contraste renforcé** pour le plein soleil
- 👆 **Cibles tactiles d'au moins 44 px**, actions visibles sans survol — les boutons Modifier et Supprimer des cartes étaient invisibles sur écran tactile
- 🌙 **Mode sombre** sur l'ensemble des pages

**Retours et erreurs**
- 💬 Chaque enregistrement produit un message de succès ou d'échec explicite
- 🚫 Un refus de droits affiche « Vous n'avez pas les droits… » au lieu de ne rien faire
- 🔐 **Session expirée** : une fenêtre de reconnexion s'affiche par-dessus l'écran courant, sans détruire le formulaire en cours
- ♻️ **Écran d'erreur avec bouton Réessayer** au lieu d'une page blanche

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
- 🔢 **Compteurs** : un champ Nombre peut être déclaré compteur, avec son unité

#### Les compteurs

Un champ Nombre coché **« Suivre ce champ comme un compteur »** cesse d'être une
simple case à remplir : il est proposé en relevé à chaque plein, entretien et
contrôle technique, et sa valeur ne redescend jamais.

Chaque branche compte ce qui la concerne, et rien d'autre :

| Catégorie | Compteur | Unité |
|-----------|----------|-------|
| Véhicules | Kilométrage | km |
| Tondeuses, groupes électrogènes | Heures moteur | h |
| Mobilier, outillage | *(aucun)* | |

Une catégorie sans compteur ne voit **aucun** champ de relevé dans ses
formulaires de saisie. C'est ce qui débarrasse l'entretien d'une tondeuse ou
d'une table du « Kilométrage » qui s'y affichait auparavant.

Un tracteur qui compte à la fois des kilomètres et des heures de prise de force
en déclare deux : le premier dans l'ordre d'affichage sert de compteur principal
pour le module Suivi et les modèles d'e-mail.

**Un compteur ne recule pas.** Un relevé inférieur à la valeur en fiche reste
enregistré sur la saisie — une facture retrouvée, un rattrapage — mais ne
rabaisse pas la fiche, et l'agent en est prévenu. Le report est fait par le
serveur au moment de l'écriture : il vaut donc aussi pour une saisie faite hors
réseau et rejouée plus tard, pour un import de fichier et pour l'API.

Le relevé se fait aussi directement depuis la carte **Compteurs** de la fiche,
sans passer par « Modifier » — un agent de terrain y a droit, et n'obtient pas au
passage la permission de renommer le véhicule.

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
- 🔄 **Workflow complet** : Circuit de validation en 6 étapes (À confirmer → Brouillon → Validée → Livrée → Récupérée → Archivée)
- 📥 **Réception de demandes** : une application de formulaires dépose ses demandes sur une adresse signée (HMAC-SHA256). Elles arrivent « À confirmer » et réservent le matériel au prévisionnel. La correspondance entre le JSON reçu et les champs d'une manifestation se règle dans l'interface, pas dans le code
- 📈 **Stock prévisionnel et réel** : ce qui est promis sur une période et ce qui est physiquement sorti sont comptés séparément, jamais deux fois. Interrogeable à une date ou sur une période — « aurai-je 200 chaises le 14 juillet ? »
- 🪑 **Quantités réelles** : demandé, livré, récupéré et **perdu**. Une chaise cassée ou volée diminue le stock physique et laisse un mouvement tracé
- 🏛️ **Services concernés** : un service est un groupe de personnes et un périmètre de catégories. Il n'est sollicité, alerté et destinataire que si la manifestation demande du matériel de son périmètre — le service informatique ne reçoit rien d'une brocante sans matériel informatique
- ✅ **Approbations** : chaque service concerné approuve sa part, avec ses propres dates de livraison et de récupération. La validation reste bloquée tant qu'un service n'a pas répondu
- 👤 **Responsable et délégations** : seul le responsable d'un service approuve en son nom, et lui seul désigne qui décide à sa place pendant son absence
- 👑 **Service coordinateur** : le service qui pilote toutes les manifestations — sollicité sur chacune, destinataire de tout, et son approbation **prononce la validation**
- 💬 **Conversation** : les services échangent dans le fil de la manifestation ; tout est consigné dans l'historique et dans l'archive
- 👀 **Mise en copie** : une direction générale, un maire ou un élu suit l'intégralité des échanges sans rien approuver
- 💶 **Coût réel d'une manifestation** : un coût unitaire se saisit sur la fiche du matériel — le prix d'une chaise, la vacation d'un agent, la valeur de remplacement d'un véhicule — et la manifestation affiche son décompte en deux natures qu'elle ne confond jamais : **ce qu'on déploie** (trois agents à 120 €) et **ce qui ne revient pas** (dix chaises prêtées, neuf rendues, la dixième coûte 50 €). Ce qui est sorti n'est compté comme perdu qu'une fois la manifestation récupérée
- 🤝 **Disponibilité en prêt réglable sur la fiche** du matériel, de la sous-catégorie ou de la catégorie, avec le même héritage à trois niveaux — au lieu du seul écran d'arbre des réglages
- 📦 **Matériel en lot** : un matériel du parc est soit un **exemplaire unique** — un véhicule, qui ne peut pas être à deux endroits — soit un **lot** avec sa quantité : cinquante chaises, dix tables. Le stock réel et prévisionnel se lit alors directement sur la fiche de parc, sans le tenir ailleurs. Un lot n'a ni carburant ni contrôle technique, qui portent sur un exemplaire, mais garde ses **entretiens** — réparation, nettoyage. Ce qui manque sur un lot est un avertissement chiffré, pas un refus
- 🏛️ **Prestations rangées par service, dans le parc** : la catégorie est le service, et ses sous-catégories mêlent prestations et matériel — Technique porte *Prestation* et *Mobilier*, Urbanisme porte *Prestation*, *Armoires* et *Bureau*, Restauration porte *Prestation* et *Verrerie*. Le réglage se fait sur la branche, avec héritage à trois niveaux, et le service gère ses prestations là où il tient déjà son parc. Une prestation n'immobilise rien : elle ne bloque jamais une autre manifestation
- 🔌 **Prestations** : raccordement électrique, débit de boissons, personnel pour une cérémonie. Une case à cocher sur un article suffit ; sa catégorie décide du service qui l'approuve. Sans stock ni disponibilité — demandée, puis réalisée
- 📄 **Document pré-rempli par service** : un modèle `.docx` écrit dans Word est rattaché à un service, ses champs entre accolades sont détectés à l'import, et une liste déroulante relie chacun à une donnée de la demande. Chaque service reçoit **sa seule part** — celui qui instruit un débit de boissons n'a que faire du nombre de chaises — joint à la manifestation et à son courriel d'approbation. Le modèle peut être tenu dans **Nextcloud** et corrigé à un seul endroit : il est relu à chaque génération
- 🧪 **Essai de webhook à blanc** : collez ce que votre formulaire envoie, l'application dit si la demande passerait, quel matériel serait reconnu et quels services seraient alertés — sans rien créer ni prévenir personne
- 📎 **Pièces jointes** : arrêtés, plans, constats, photos. Glisser-déposer ou photo prise au téléphone, description facultative pour les retrouver, et lien vers le matériel concerné. Supprimer une pièce retire aussi le fichier
- 🎯 **Matériel prêtable au choix** : par catégorie, par sous-catégorie, ou matériel par matériel — le réglage le plus précis l'emporte. Le réfrigérateur part pour la brocante, le grill de la même catégorie reste à la cuisine
- 🚚 **Deux natures de matériel** : des **quantités** (50 tables d'un même modèle, sans les saisir une par une) et des **exemplaires uniques** choisis dans le parc (un véhicule, un vidéoprojecteur identifié). Deux manifestations peuvent se partager cent chaises ; elles ne peuvent pas se partager le camion, et le conflit est signalé avec qui le retient et quand
- 🔔 **Notifications réglables à trois niveaux** : défaut de la collectivité par événement et par rôle, réglage de chaque service, puis choix de chaque compte. Une approbation attendue de vous part toujours — sans quoi vous bloqueriez une manifestation sans le savoir
- 📊 **Export configurable** : choisissez vos colonnes, leur ordre et leurs intitulés, et déposez le suivi sur un **Nextcloud** automatiquement à chaque changement
- 🎨 **Indicateurs visuels** : Cartes colorées par statut (bordure, fond, badge) avec barre de progression du workflow
- ✅ **Modales de changement de statut** :
  - Refus/Validation avec commentaire optionnel
  - Livraison avec gestion des quantités livrées (individuel ou global)
  - Récupération avec gestion des quantités retournées
- 📝 **Historique horodaté** : timeline de chaque action — création, modification, validation, livraison, récupération, mise à jour des quantités — avec son auteur, sa date et son commentaire
- 📄 **Export PDF** : Génération de rapport PDF avec en-tête, articles (commandé/livré/récupéré), et historique
- 🗂️ **Onglets** : Vue par manifestations actives, stock, et archives
- 📚 **Stock matériel = le catalogue entier** : l'onglet montre le stock des manifestations **et** le parc prêtable dans une seule liste, chaque ligne disant d'où elle vient. Une collectivité qui tient tout son matériel dans le parc n'y voyait rien ; le matériel se déclare désormais depuis le parc uniquement, et l'onglet n'a plus de bouton « Ajouter au stock »
- 🔭 **Trois vues sur le même catalogue** : **Stock** (ce dont je dispose aujourd'hui), **Stock à date** (ce qu'il restera le 14 juillet, ou sur toute une période, engagements déduits) et **Sorties** (où est le matériel — chez qui, jusqu'à quand, et ce qui part)
- 🏛️ **Filtre par service qui ne ment pas** : la liste des services se déduit de ce qui est réellement prêtable. Un service Véhicules qui ne prête aucun véhicule n'y figure pas ; le service Technique y figure pour sa seule prestation de raccordement électrique. Une entrée « Sans service » rassemble ce qu'aucune catégorie ne rattache
- ↕️ **Tri sur chaque colonne** : nom, origine, catégorie, service, total, dehors, promis, disponible — et sur les sorties, la manifestation, la période et l'état. Les nombres se trient en nombres, les mots dans l'ordre alphabétique français

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
- 🏷️ **Types de groupes** : Gestion CRUD des types de groupes de composition (massif, haie, bosquet, rocaille, jardinière...) avec icône et couleur personnalisables
- ♻️ **Remplacement d'éléments** : Archivage automatique de l'état avant remplacement avec contexte saisonnier (printemps/été/automne/hiver) — timeline visuelle de l'historique pour traçabilité
- 📊 **Export PDF** : Plan annoté en paysage + légende + tableaux détaillés
- 🔗 **Intégrations** : Alertes automatiques (cron), événements calendrier, coûts dans le module Suivi

### Plugins intégrés
- ⛽ **Carburant / Recharges** : Suivi des consommations et coûts, gestion des stations et des bornes, filtrage avancé, pièces jointes (PDF/images). Le module **s'adapte à ce que consomme le matériel** (voir ci-dessous)
- 🔧 **Maintenance** : Historique des interventions, gestion des types d'entretien et prestataires, relevés de compteurs, pièces jointes (PDF/images)
- 📋 **Contrôle technique** : Suivi des échéances, gestion des centres, calcul automatique expiration (+2 ans), pièces jointes (PDF/images)

#### Carburant ou électrique : un seul module

Le module lit le **type d'énergie** du matériel — un champ personnalisé nommé
`typeEnergie`, `typeCarburant`, `energie`, « Type de carburant »… — et change de
vocabulaire en conséquence :

| | Thermique | Électrique |
|---|---|---|
| Onglet | Carburant | Recharges |
| Quantité | litres (L) | kilowattheures (kWh) |
| Prix unitaire | €/L | €/kWh |
| Point de ravitaillement | Station | Borne |

Un **hybride rechargeable** (valeur contenant « hybride ») voit un onglet
« Énergie » et choisit à chaque saisie entre un plein et une recharge.

Sans champ d'énergie renseigné, le matériel reste thermique : c'est le cas de la
quasi-totalité d'un parc existant, et présenter des kWh à un camion benne serait
un contresens plus visible que l'inverse.

L'historique reste **unique** : le module Suivi, les exports, les alertes et le
tableau de bord continuent de tout additionner sans qu'un second module ait à
être branché partout. Un véhicule reconverti garde l'historique juste de ce qu'il
a réellement consommé, chaque écriture portant sa propre nature.
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
- 🔄 **Synchronisation Outlook** via Azure AD *(voir la réserve dans « État réel »)*
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
- 🔗 **Webhooks** : notifications HTTP vers des services externes sur douze événements (matériel, catégorie, alerte, entretien, plein, sauvegarde, utilisateur, connexion), signées en HMAC-SHA256 quand un secret est configuré
- 📖 **API** : Documentation interactive Swagger UI, spécification OpenAPI, statistiques

### 📦 QR Codes
- 📱 **QR Codes** : génération par matériel, scan terrain pour accès rapide à la fiche
- 🖨️ **Impression en lot** : depuis une catégorie ou une sous-catégorie, sélection des matériels et impression d'une planche A4 d'étiquettes (2 colonnes, 95 × 52 mm) portant le QR code, le nom et la référence
- 🔐 **Génération cloisonnée** : un compte ne génère d'étiquettes que pour les catégories qu'il a le droit de consulter

### 🔌 Plugins système (activables/désactivables depuis Paramètres > Plugins)

#### 🔄 Réservation / Prêt de matériel
- 📅 Formulaire de réservation (dates, motif, emprunteur)
- ✅ **Disponibilité affichée avant l'envoi** : les créneaux déjà pris apparaissent avec leur emprunteur, et le bouton reste inactif tant que la période demandée est occupée. Les demandes en attente de validation sont signalées sans bloquer
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
- 📥 **Import CSV/Excel** : les colonnes sont reconnues par leur intitulé, quel que soit leur ordre, et une colonne inconnue est ignorée. La reconnaissance est affichée avant l'import et corrigeable colonne par colonne. Un fichier sans ligne d'en-tête reste lu dans l'ordre du modèle
- 🔁 **Export réimportable** : exporter, corriger dans un tableur, réimporter fonctionne — la colonne `ID` de l'export décalait auparavant toutes les autres et faisait échouer chaque ligne
- 📤 **Export** : filtrable par catégorie, sous-catégorie et statut, au format CSV ou XLSX. Le nombre de matériels concernés est annoncé avant le téléchargement
- 🔐 **Export cloisonné** : un compte n'exporte que les catégories qu'il a le droit de consulter
- 📋 Template d'import téléchargeable

### 📧 Reporting automatique
- 📊 Rapport hebdomadaire envoyé par email aux admins/superviseurs
- 📈 Stats : objets, alertes, réservations, retards

### 🌙 Dark Mode & i18n
- 🌙 Mode sombre togglable (clair/sombre/système) avec persistance
- 🇫🇷 Interface en français. Les fichiers de traduction FR/EN existent mais `useTranslation` n'est utilisé que dans un fichier sur soixante : la détection automatique de langue a été retirée, car elle basculait toute l'interface en anglais sur une tablette configurée en anglais

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

- Node.js >= 20.0.0
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
# Lance le serveur et le client ensemble
npm run dev
```

5. **Accéder à l'application**
- Frontend : http://localhost:5173
- Backend API : http://localhost:3001

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
# Sécurité - OBLIGATOIRE en production, minimum 32 caractères.
# L'application refuse de démarrer si ce secret est absent, trop court,
# ou laissé à sa valeur d'exemple.
JWT_SECRET=votre_secret_jwt_tres_long_minimum_32_caracteres

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

Deux piles au choix, indépendantes l'une de l'autre.

```bash
# SQLite — un fichier, rien à administrer
docker compose up -d

# MySQL — serveur dédié dans un conteneur
docker compose -f docker-compose.mysql.yml up -d
```

La pile MySQL exige trois secrets dans `.env`. Sans eux elle refuse de démarrer avec un message explicite, plutôt que de tourner avec un mot de passe lisible dans le dépôt :

```env
JWT_SECRET=…            # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
MYSQL_ROOT_PASSWORD=…
MYSQL_APP_PASSWORD=…
```

Le port du serveur MySQL n'est pas publié sur l'hôte : seul le conteneur applicatif y accède, par le réseau interne. Les deux piles ont leurs propres réseau, volumes et port, et peuvent donc tourner en même temps — mais elles ne partagent aucune donnée : passer de l'une à l'autre demande un export, pas un changement de fichier.

4. **Accéder à l'application**
```
http://localhost:3001   # pile SQLite
http://localhost:3002   # pile MySQL
```

> Le conteneur crée le schéma et applique les migrations au démarrage, sur les deux moteurs, avec une sauvegarde préalable de la base SQLite. Aucune commande manuelle n'est nécessaire.

### Derrière un reverse proxy (production)

En production, l'application redirige toute requête HTTP vers HTTPS — seuls les contrôles de santé internes en sont exemptés. Elle attend donc une terminaison TLS devant elle, qui lui transmet `X-Forwarded-Proto`.

Un exemple de configuration est fourni dans `nginx/nginx.conf`, à déposer sur le reverse proxy de la collectivité avec les certificats :

```bash
mkdir -p nginx/ssl
cp fullchain.pem nginx/ssl/
cp privkey.pem nginx/ssl/
```

> Aucun des deux fichiers `docker-compose` ne lance de service Nginx : la terminaison TLS est à monter séparément. Sans elle, un navigateur appelant `http://` reçoit une redirection 301 vers une adresse `https://` que personne n'écoute.

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
│   │   ├── migrations/    # Migrations versionnées
│   │   ├── migrationRunner.ts # Journal, sauvegarde, application
│   │   └── migrate.ts     # Commande `npm run db:migrate`
│   └── server.ts          # Point d'entrée
├── data/                   # Base de données SQLite
├── uploads/                # Fichiers uploadés
├── backups/                # Sauvegardes
├── plugins/                # Plugins installés
│   └── pages/             # Pages des plugins
├── examples/               # Exemples de plugins
│   └── plugins/           # Plugins d'exemple (ZIP)
├── tests/                  # Tests backend (Jest)
│   ├── roles.test.ts      # Matrice rôle × endpoint
│   ├── saisie-terrain.test.ts # Validation des relevés de terrain
│   ├── apiTokens.test.ts  # Portée des tokens API
│   ├── migrations.test.ts # Système de migration
│   ├── batchQuery.test.ts # Chargement groupé (N+1)
│   ├── settingsColumns.test.ts # Noms de colonnes de `settings`
│   ├── slugify.test.ts    # Utilitaire slugify
│   └── api.test.ts        # Routes API & WebSocket
├── docs/                   # Documentation
│   ├── ROADMAP_FONCTIONNALITES.md # Roadmap et état réel des fonctionnalités
│   ├── PLUGIN_STRUCTURE.md # Structure des plugins
│   ├── AUDIT_SECURITE_API.md # Audit sécurité
│   ├── JWT_ROTATION.md    # Rotation JWT
│   └── DEPLOIEMENT_PORTAINER.md # Déploiement Portainer
├── nginx/                  # Configuration Nginx
├── docker-compose.yml       # Pile de production, SQLite
├── docker-compose.mysql.yml # Pile de production, MySQL
├── Dockerfile
└── README.md
```

## 🔧 Configuration

### Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `PORT` | Port du serveur | 3001 |
| `NODE_ENV` | Environnement | development |
| `JWT_SECRET` | Secret JWT (**obligatoire**, ≥ 32 caractères) | - |
| `JWT_REFRESH_SECRET` | Déclaré dans `docker-compose.yml` mais **lu par personne** : le jeton de rafraîchissement est signé avec `JWT_SECRET` | - |
| `JWT_EXPIRES_IN` | Durée du jeton d'accès | 7d |
| `JWT_REFRESH_EXPIRES_IN` | Durée du jeton de rafraîchissement | 30d |
| `SITE_URL` | URL publique inscrite dans les liens des emails à la première installation, modifiable ensuite dans **Paramètres** | `http://localhost:$PORT` |
| `APP_URL` | URL encodée dans les QR codes ; à défaut, l'hôte de la requête est utilisé | - |
| `DB_TYPE` | Type de BDD (sqlite/mysql) | sqlite |
| `DB_PATH` | Chemin BDD SQLite | ./data/database.sqlite |
| `MYSQL_HOST` | Hôte MySQL | localhost |
| `MYSQL_PORT` | Port MySQL | 3306 |
| `MYSQL_USER` | Utilisateur MySQL | - |
| `MYSQL_PASSWORD` | Mot de passe MySQL | - |
| `MYSQL_DATABASE` | Nom BDD MySQL | gestion_materiels |
| `MYSQL_ROOT_PASSWORD` | Mot de passe root du conteneur MySQL (**obligatoire** pour `docker-compose.mysql.yml`) | - |
| `MYSQL_APP_USER` | Compte applicatif créé dans le conteneur MySQL (l'image refuse `root`) | gestion |
| `MYSQL_APP_PASSWORD` | Mot de passe de ce compte (**obligatoire** pour `docker-compose.mysql.yml`) | - |
| `MYSQL_APP_PORT` | Port publié sur l'hôte par la pile MySQL | 3002 |
| `SMTP_HOST` | Serveur SMTP | - |
| `SMTP_PORT` | Port SMTP | 587 |
| `SMTP_USER` | Utilisateur SMTP | - |
| `SMTP_PASS` | Mot de passe SMTP | - |
| `SMTP_FROM` | Email expéditeur | - |
| `VITE_GOOGLE_MAPS_KEY` | Clé Google Maps côté client, optionnelle (sans elle, l'aperçu utilise OpenStreetMap) | - |

> Au démarrage en production, l'application refuse de se lancer si `JWT_SECRET` est absent, trop court, ou reste sur une valeur d'exemple. Il n'y a plus de secret de repli. `JWT_REFRESH_SECRET` n'est pas vérifié, puisque personne ne le lit.

> `MYSQL_HOST` et `MYSQL_PORT` ne concernent qu'une connexion à un serveur MySQL existant. La pile `docker-compose.mysql.yml` vise son propre service `db` et ignore ces deux variables : le `.env` de développement les met à `localhost`, ce qui ferait chercher le serveur dans le conteneur applicatif lui-même.

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

# Compteurs
PATCH /api/objects/:id/compteurs      # Relever un ou plusieurs compteurs
                                      # { "readings": { "kilometrage": 84500 } }
                                      # La fiche ne retient que les valeurs plus élevées

# Carburant / Recharges
GET  /api/objects/:id/fuel            # Historique carburant et recharges
POST /api/objects/:id/fuel            # Ajouter un plein ou une recharge
                                      # energyKind: "fuel" | "electric" (déduit du matériel si absent)
                                      # readings: { "<champ compteur>": <valeur> }
GET  /api/objects/fuel-stations/list  # Stations et bornes (?kind=fuel|electric)

# Maintenance
GET  /api/objects/:id/maintenance     # Historique maintenance
POST /api/objects/:id/maintenance     # Ajouter une maintenance

# Contrôle technique
GET  /api/objects/:id/controls        # Historique contrôles
POST /api/objects/:id/controls        # Ajouter un contrôle
```

### Manifestations

```
GET    /api/manifestations             # Liste (filtres: search, status, date_from, date_to)
GET    /api/manifestations/stats/summary  # Compteurs par statut
POST   /api/manifestations             # Créer une manifestation
GET    /api/manifestations/:id         # Détail (avec articles et historique)
PUT    /api/manifestations/:id         # Modifier une manifestation
DELETE /api/manifestations/:id         # Supprimer une manifestation
PUT    /api/manifestations/:id/status  # Changer le statut (transitions validées, commentaire accepté)
PUT    /api/manifestations/:id/materials  # Quantités demandées, livrées, récupérées, perdues
GET    /api/manifestations/:id/history # Historique des changements
```

**Stock des manifestations**

```
GET    /api/manifestations/catalogue   # Ce qui peut être proposé : stock **et** parc prêtable réunis,
                                       # avec ce qu'il en reste (mêmes filtres service/kind/category_id).
                                       # Chaque ligne porte sa nature, sa catégorie, les services qui la
                                       # portent, ce qui est dehors et ce qui est promis sur la période.
                                       # Une prestation y vaut « sans limite », jamais zéro.
GET    /api/manifestations/sorties     # Où est le matériel : une ligne par article ET par manifestation
                                       # (date_from/date_to, à défaut le jour même ; service, kind, search).
                                       # État : dehors, rendu, à sortir.
GET    /api/manifestations/stock       # Liste (date_from/date_to → prévisionnel et réel à cette période)
GET    /api/manifestations/stock/availability  # Disponibilité à une date ou sur une période
                                               # (service, kind=prestation|materiel, category_id : périmètre proposé)
POST   /api/manifestations/stock       # Créer un article
PUT    /api/manifestations/stock/:id   # Modifier un article
DELETE /api/manifestations/stock/:id   # Supprimer un article
GET    /api/manifestations/stock/:id/aliases   # Autres noms reconnus à la réception
POST   /api/manifestations/stock/:id/aliases   # Ajouter un alias
DELETE /api/manifestations/stock/aliases/:id   # Retirer un alias
```

**Matériel unique du parc**

```
GET    /api/manifestations/objects/search   # Parc sur une période, avec ce qui retient chaque matériel
GET    /api/manifestations/:id/objects      # Matériels uniques demandés
PUT    /api/manifestations/:id/objects      # Remplace la liste (rend les conflits)
PUT    /api/manifestations/:id/objects/:itemId  # Sortie, retour, état constaté
```

**Délégations et fin de vie d'un compte**

```
GET    /api/services/:id/delegations       # Délégations accordées (responsable)
POST   /api/services/:id/delegations       # Déléguer ses approbations
DELETE /api/services/:id/delegations/:did  # Révoquer
PUT    /api/services/:id/members/:userId   # Désigner ou retirer le responsable

GET    /api/users/:id/traces      # Ce qu'un compte laisserait derrière lui
POST   /api/users/:id/anonymize   # Retire l'identité, conserve les liens (RGPD)
DELETE /api/users/:id             # Supprime, ou désactive si le compte a des traces
```

**Pièces jointes**

```
GET    /api/manifestations/:id/documents      # avec filtre ?q= sur libellé et description
POST   /api/manifestations/:id/documents      # après POST /api/upload/file
PUT    /api/manifestations/documents/:docId
DELETE /api/manifestations/documents/:docId   # retire la ligne ET le fichier
GET    /api/manifestations/doc-types          # référentiel (?tous=true inclut les désactivés)
POST|PUT|DELETE /api/manifestations/doc-types/...
```

Le lien facultatif vers le matériel porte sur `stock_id` ou `object_id` — l'article, pas la ligne
de matériel, qui est réécrite à chaque modification de la manifestation.

**Matériel prêtable**

```
GET /api/manifestations/availability/tree     # Catégories et sous-catégories, avec leur réglage
GET /api/manifestations/availability/objects  # Matériels d'une catégorie (?category_id=)
GET /api/manifestations/availability/search   # Matériels dont le nom, la référence ou le
                                              # numéro de série contient ?q=, avec leur branche
PUT /api/manifestations/availability/:niveau/:id  # niveau : category | subcategory | object
```

`available` vaut `true` (prêtable), `false` (exclu) ou `null` (hérite du niveau au-dessus).
Une catégorie n'accepte pas `null` : c'est elle qui donne le ton.

**Notifications**

```
GET    /api/notifications/events        # Catalogue des événements et des rôles
GET    /api/notifications/defaults      # Défauts de la collectivité (admin)
PUT    /api/notifications/defaults      # Qui reçoit quoi par défaut (admin)
GET    /api/notifications/preferences   # Mes choix, et ce que je peux couper
PUT    /api/notifications/preferences   # Couper ou rétablir un avis pour moi seul
```

**Services, approbations et suivi**

```
GET    /api/services                   # Liste des services
GET    /api/services/mine              # Services du compte courant
GET    /api/services/:id               # Détail : périmètre et membres (admin)
POST   /api/services                   # Créer un service
PUT    /api/services/:id               # Nom, boîte partagée, observateur, déclencheurs
DELETE /api/services/:id               # Supprime, ou désactive s'il a rendu des décisions
PUT    /api/services/:id/categories    # Périmètre de matériel
POST   /api/services/:id/members       # Ajouter un membre
DELETE /api/services/:id/members/:userId

GET    /api/manifestations/:id/approvals      # Approbations et sollicitations
POST   /api/manifestations/:id/approvals      # Solliciter un service ou une personne
PUT    /api/manifestations/:id/approvals/:approvalId  # Rendre sa décision
GET    /api/manifestations/:id/messages       # Fil d'échange
POST   /api/manifestations/:id/messages       # Écrire dans le fil
GET    /api/manifestations/:id/watchers       # Personnes et services en copie
POST   /api/manifestations/:id/watchers       # Mettre en copie
DELETE /api/manifestations/:id/watchers/:watcherId
```

**Export et dépôt Nextcloud**

```
GET    /api/manifestations/export           # Télécharge un .xlsx (profile, status, date_from/to)
GET    /api/manifestations/export/fields    # Colonnes disponibles
GET    /api/manifestations/export/profiles  # Profils enregistrés
POST   /api/manifestations/export/profiles  # Créer un profil
PUT    /api/manifestations/export/profiles/:id
DELETE /api/manifestations/export/profiles/:id
POST   /api/manifestations/export/profiles/:id/run   # Produit et dépose sur Nextcloud
GET    /api/manifestations/export/nextcloud       # Configuration (sans le mot de passe)
PUT    /api/manifestations/export/nextcloud       # Enregistrer la configuration
POST   /api/manifestations/export/nextcloud/test  # Dépose un fichier témoin, puis le retire
```

Le sens est unique : l'application reste la source de vérité, le fichier déposé sert à consulter
et à annoter à côté. Utilisez un **mot de passe d'application** Nextcloud, jamais celui du compte.

**Réception des demandes**

```
POST   /api/manifestations/intake/:slug        # Dépôt d'une demande (signé HMAC, sans compte)
GET    /api/manifestations/intake/sources/list # Sources déclarées
POST   /api/manifestations/intake/sources      # Créer une source (rend le secret, une seule fois)
PUT    /api/manifestations/intake/sources/:id  # Nom, correspondance des champs, activation
POST   /api/manifestations/intake/sources/:id/secret  # Régénérer le secret
DELETE /api/manifestations/intake/sources/:id  # Supprimer une source
GET    /api/manifestations/intake/sources/:id/champs  # Chemins reçus et correspondance déduite
GET    /api/manifestations/intake/requests     # Journal des demandes reçues
GET    /api/manifestations/intake/champs       # Champs qu'une demande peut porter
POST   /api/manifestations/intake/sources/test # Essai à blanc : ne crée rien, ne prévient personne
```

**Modèles de document par service**

```
GET    /api/services/template-values      # Valeurs qu'un modèle peut afficher
GET    /api/services/nextcloud-templates  # Modèles .docx d'un dossier Nextcloud (?path=)
GET    /api/services/:id/template         # Modèle du service, champs et correspondance
POST   /api/services/:id/template         # Rattacher un .docx (téléversé ou Nextcloud)
PUT    /api/services/:id/template         # Correspondance des champs, libellé, activation
POST   /api/services/:id/template/detect  # Relire les champs (après correction dans Nextcloud)
POST   /api/services/:id/template/preview # Télécharger un aperçu rempli
DELETE /api/services/:id/template

POST   /api/manifestations/:id/documents/generate  # Refaire les documents des services
```

Le modèle est un `.docx` ordinaire : `{manifestation}` pour une valeur, `{#materiels}…{/materiels}`
pour une liste répétée. La bibliothèque retenue, `easy-template-x` (MIT), **n'exécute aucun code venu
du modèle** — un fichier Word déposé dans un Nextcloud partagé ne doit rien pouvoir faire tourner
sur le serveur.

Le dépôt attend l'en-tête `X-Webhook-Signature: sha256=<HMAC-SHA256 du corps>`, calculé avec le secret
de la source sur les **octets exacts** envoyés. Une demande acceptée rend `202` et l'identifiant créé ;
une demande déjà reçue rend `200` et signale le doublon plutôt que de créer une seconde manifestation.

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

### En place

- Authentification JWT, jetons d'accès et de rafraîchissement (signés avec le même secret)
- Mots de passe hashés avec bcrypt (12 tours)
- `JWT_SECRET` obligatoire : plus de secret de repli, démarrage refusé en production s'il est absent, trop court ou laissé à sa valeur d'exemple
- Rate limiting : 10 tentatives / 15 min sur `/api/auth`, 1000 req / 15 min globalement, quotas dédiés pour les uploads et les exports
- **Portée des tokens API appliquée** : un token « lecture seule » ne peut plus écrire ni supprimer, quel que soit le rôle de son créateur
- **Portée par catégorie appliquée partout** : liste et fiche d'un matériel, recherche, réservations, événements de calendrier, export et étiquettes QR. Un compte ne voit jamais un matériel d'une catégorie qui ne lui est pas ouverte
- Un test de contrat échoue dès qu'un fichier lit la table des matériels sans appliquer cette portée
- Rôles vérifiés route par route, figés par une matrice de tests
- Fichiers du dossier `/uploads` protégés par JWT
- SQL des plugins verrouillé : tables système protégées, écritures interdites
- Rotation automatique des secrets JWT avec période de grâce
- Headers de sécurité HTTP (Helmet), CORS, HTTPS forcé en production
- Validation des entrées côté serveur sur les écritures de terrain
- **Politique de mot de passe appliquée** : longueur et complexité configurables, vérifiées aux six endroits où un mot de passe est défini (inscription, réinitialisation, changement, création et modification par un administrateur)
- **Blocage du compte** après N échecs pendant une durée configurable, indépendamment du rate limiting qui protège l'API dans son ensemble. Un administrateur débloque en réattribuant un mot de passe
- **Expiration du mot de passe** signalée par un bandeau, sans bloquer l'accès
- Journal d'audit : connexions, échecs, déconnexions, changements de configuration

### Écrans de configuration sans effet ⚠️

Ces écrans existent dans **Paramètres > Authentification**, enregistrent leur configuration dans la table `auth_config`, et **rien ne la relit** : la connexion reste en bcrypt local seul. Ne les présentez pas comme actifs à un administrateur.

| Fonction | État réel |
|----------|-----------|
| SSO SAML 2.0 | Écran de configuration uniquement — aucun flux d'authentification |
| SSO OpenID Connect | Écran de configuration uniquement |
| LDAP / Active Directory | Écran de configuration uniquement |
| Passkey (WebAuthn / FIDO2) | Écran de configuration uniquement |

Chacun de ces quatre écrans affiche désormais un bandeau qui l'indique : la configuration est conservée, mais la connexion continue de passer exclusivement par email et mot de passe. Le bouton « Tester » ne fait que vérifier la forme des valeurs saisies, pas une connexion réelle au fournisseur.

La politique de mot de passe et le blocage après N tentatives, qui étaient dans le même cas, sont désormais appliqués. Les trois réglages qui ne peuvent pas l'être — connexion locale, 2FA, timeout de session — ont été retirés du formulaire et remplacés par un encart qui dit pourquoi, plutôt que par des interrupteurs sans effet.

## 🚧 État réel

Cette section liste ce qui est visible dans l'interface sans fonctionner, pour qu'un administrateur ne le présente pas comme acquis. Tout ce qui n'y figure pas fonctionne.

| Fonction | Ce qui existe | Ce qui manque |
|----------|---------------|---------------|
| **SSO SAML / OIDC / LDAP / Passkey** | Écrans de configuration complets, table `auth_config` | Rien ne relit cette configuration : la connexion reste en bcrypt local |
| **2FA, timeout de session, connexion locale** | Réglages retirés du formulaire, remplacés par un encart expliquant pourquoi | Aucun second facteur n'est implémenté ; le timeout de session demanderait un suivi d'inactivité ; désactiver la connexion locale rendrait l'application inaccessible tant qu'aucun SSO ne fonctionne |
| **Synchronisation Outlook** | Configuration enregistrable, flux OAuth réel contre Microsoft Graph | La requête vise `/me/calendarview` avec un jeton applicatif, que Graph refuse. Il faut viser `/users/{identifiant}/calendarview`, donc choisir la boîte aux lettres à synchroniser. CalDAV n'a pas ce problème |
| **Description des sous-catégories** | — | Ni colonne en base, ni champ de route, ni champ de formulaire. L'affichage mort a été retiré |

### Limites connues

- Les requêtes du cron encadrent leurs colonnes de dates dans `date()`, ce qui empêche les index `idx_control_expiry` et `idx_maintenance_next` de servir. Sans effet visible au volume actuel
- `JWT_REFRESH_SECRET` est déclaré dans `docker-compose.yml` mais n'est lu par personne : les deux jetons sont signés avec `JWT_SECRET`
- `PUT /api/manifestations/:id` ne lit pas le champ `status` : le statut se change uniquement via `PUT /:id/status`
- La correspondance des champs à la réception ne couvre pas encore les lignes de matériel : le chemin et les clés se règlent en base (`material_mapping`), pas dans l'écran
- Un service ne peut être mis en copie que globalement ; il n'existe pas encore de mise en copie d'une personne depuis l'écran (l'API l'accepte : `POST /:id/watchers` avec `user_id`)
- Une image déposée est systématiquement ré-encodée en JPEG par `normalizeImage()`, mais conserve son extension et son `Content-Type` d'origine : un PNG à fond transparent ressort opaque, sous un nom en `.png` dont le contenu est du JPEG. Sans effet sur un cliché de terrain, visible sur un logo ou un favicon
- Le typage du client comporte encore 449 avertissements ESLint, presque tous des `any`

## 🛠️ Développement

### Scripts disponibles

```bash
# Racine — lance serveur et client ensemble
npm run dev             # Développement (serveur 3001 + client 5173)
npm run build           # Build complet, types vérifiés des deux côtés
npm run build:server    # Compilation TypeScript du serveur (tsc)
npm start               # Production
npm test                # Tests backend (Jest)
npm run db:migrate      # Applique les migrations en attente
npm run db:migrate -- --dry-run   # Liste ce qui reste à appliquer, sans rien modifier

# Frontend (dans /client)
npm run dev             # Développement Vite
npm run build           # Build sans vérification de types
npm run build:check     # Build avec vérification de types (utilisé par l'image Docker)
npm run lint            # ESLint
npm run test:run        # Tests (Vitest)
```

> L'image Docker compile le serveur avec `tsc` et le client avec `build:check` : une erreur de type arrête la construction de l'image au lieu de ressortir en panne en production.

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

> **131 tests** : 87 backend + 44 frontend.
>
> | Suite | Couvre |
> |-------|--------|
> | `roles.test.ts` | Matrice rôle × endpoint, contrat de chaque route protégée |
> | `saisie-terrain.test.ts` | Champs obligatoires des relevés, et surtout que les champs validés soient bien ceux que la route lit |
> | `apiTokens.test.ts` | Portée des tokens API, méthode HTTP → permission |
> | `migrations.test.ts` | Journal, ordre, non-rejeu, reprise après échec |
> | `batchQuery.test.ts` | Chargement groupé : regroupement, découpage en tranches |
> | `settingsColumns.test.ts` | Aucune requête n'interroge `settings` avec de mauvais noms de colonnes |
> | `api.test.ts`, `slugify.test.ts` | Routes API, WebSocket, génération de slugs |
> | `auth.store.test.ts` | Contrat du magasin d'authentification, « Rester connecté » |
> | `offlineQueue.test.ts` | File hors ligne : ce qui est différable, sort de file, abandonné |
> | `Badge`, `Button`, `Card` | Composants UI |

## 📝 Licence

Licence d'utilisation personnelle © 2026 [DEBONNE Frédéric]

Ce logiciel est protégé par le droit d'auteur. L'utilisation est autorisée uniquement avec permission écrite de l'auteur. La distribution et la vente sont strictement réservées à l'auteur.

## 📞 Support

Pour toute question ou problème :
- Ouvrir une issue sur [GitHub](https://github.com/wdebonne/gestion-materiels/issues)
- Consulter la [documentation](docs/)

## 📚 Documentation

- [Roadmap fonctionnalités](docs/ROADMAP_FONCTIONNALITES.md) - Suivi des 15 fonctionnalités et état réel de chacune
- [Structure des plugins](docs/PLUGIN_STRUCTURE.md) - Comment créer des plugins
- [Déploiement Portainer](docs/DEPLOIEMENT_PORTAINER.md) - Déployer avec Docker/Portainer
- [Audit sécurité API](docs/AUDIT_SECURITE_API.md) - Rapport d'audit de sécurité
- [JWT Rotation](docs/JWT_ROTATION.md) - Rotation automatique des tokens JWT
- [Exemples de plugins](examples/plugins/) - Plugins d'exemple

---

Développé avec ❤️ pour la gestion du matériel municipal
