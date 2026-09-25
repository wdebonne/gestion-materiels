# Fonctionnalités en détail

> Ce document détaille chaque module : ce qu'il fait, et pourquoi il le fait ainsi. Pour une vue d'ensemble avec captures d'écran, voir le [README](../README.md).

### Gestion des utilisateurs
- 🔐 Authentification sécurisée (JWT)
- 👥 **Quatre rôles** : Administrateur, Superviseur, **Agent de terrain**, Utilisateur
- 🔑 Réinitialisation de mot de passe par email
- 🔏 **Passkeys** : se connecter avec l'empreinte, le visage ou le code de son appareil, ou une clé USB. Chacun gère les siennes depuis *Mon profil > Passkeys* — plusieurs par personne, nommées et datées, pour savoir laquelle retirer le jour d'une perte
- 👤 Profil utilisateur personnalisable
- ✅ **Rester connecté** : coché, la session survit à la fermeture du navigateur ; décoché, elle disparaît avec l'onglet — à utiliser sur un poste partagé
- 🧑‍🤝‍🧑 **Des personnes sans compte** : le gardien de la salle des fêtes, l'élu, l'employé du CLSH figurent au même annuaire que les agents, sans adresse ni mot de passe

#### Un seul annuaire : les comptes et les personnes

*Paramètres > Utilisateurs* ne gérait que des comptes : une adresse et un mot de passe étaient obligatoires. Y inscrire quelqu'un qui n'ouvrira jamais l'application — le gardien à qui on remet un trousseau — obligeait à lui inventer les deux, donc à créer un accès que personne n'avait voulu. Faute de quoi cette personne n'existait nulle part, et « Remettre le matériel » la renvoyait vers **un externe**, c'est-à-dire vers du texte libre : « A. Marie », « Marie André » et « André MARIE » y devenaient trois détenteurs distincts, qu'aucun écran ne peut rapprocher.

Une case, **« Se connecte à l'application »**, sépare désormais les deux formes :

| | Personne sans compte | Compte |
|---|---|---|
| Ce qu'il faut saisir | un nom | un nom, une adresse, un mot de passe |
| Peut se connecter | non — mot de passe, passkey et lien de réinitialisation sont refusés | oui |
| Peut être désignée | oui : détentrice d'une clé, emprunteuse de matériel | oui |
| Reçoit les notifications | non | selon son rôle |
| Rôle | `Utilisateur`, sans effet | celui qu'on lui donne |

Les deux vivent dans la même table : **accorder un accès plus tard ne recopie personne**. La fiche garde son identifiant, donc les clés qu'elle détient, les réservations à son nom et son passage dans l'historique. Le geste inverse — retirer l'accès — ferme la porte sans effacer personne, et périme au passage les sessions en cours plutôt que d'attendre l'expiration du jeton.

> Supprimer quelqu'un qui détient une clé ne l'efface pas : le compte est désactivé, et l'écran annonce d'abord ce qu'il s'apprête à retirer — manifestations, décisions, messages, **clés remises à son nom**, réservations.

**Qui tient l'annuaire.** *Paramètres > Utilisateurs* s'ouvre au superviseur, dans une forme réduite : il n'y voit que les personnes sans compte, les inscrit et corrige leur nom. C'est lui qui remet les clés — le renvoyer vers l'administrateur pour un nom manquant le renverrait en pratique vers « un externe », et sans le droit de corriger, une faute de frappe produirait un doublon. La frontière n'est pas « quels champs », mais **« est-ce que cela ouvre une porte »** :

| | Superviseur | Administrateur |
|---|:---:|:---:|
| Inscrire une personne sans compte | ✓ | ✓ |
| Corriger son nom, son adresse, sa présence dans les listes | ✓ | ✓ |
| Voir les comptes de l'application | | ✓ |
| Créer un compte, accorder ou retirer un accès | | ✓ |
| Distribuer un rôle, poser un mot de passe, retirer les passkeys | | ✓ |
| Supprimer, anonymiser, couper les sessions | | ✓ |

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
| Inscrire et corriger une personne sans compte | | | ✓ | ✓ |
| Comptes, accès, sauvegardes, permissions | | | | ✓ |

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

### 📊 Module Suivi
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

### 📦 Gestion des Manifestations
- 🎪 **Page dédiée** : Gestion complète des manifestations (prêts de matériel pour événements)
- 🔍 **Recherche avancée** : Recherche en temps réel avec debounce sur les manifestations
- 📊 **Tableau de bord** : Statistiques avec compteurs par statut (brouillons, en cours, archivées)
- 🔄 **Workflow complet** : Circuit de validation en 6 étapes (À confirmer → Brouillon → Validée → Livrée → Récupérée → Archivée)
- 📥 **Réception de demandes** : une application de formulaires dépose ses demandes sur une adresse signée (HMAC-SHA256). Elles arrivent « À confirmer » et réservent le matériel au prévisionnel. La correspondance entre le JSON reçu et les champs d'une manifestation se règle dans l'interface, pas dans le code
- 🗂️ **La demande arrive entière** : une quarantaine de champs reconnus, groupés comme le formulaire les pose — qualité du demandeur, pôle et service, association et président, bâtiments et salles, voies fermées à la circulation, agents techniques, informatique, restauration, communication, débit de boissons. Les questions **par branches** (une par pôle, une par qualité) se règlent sur plusieurs chemins, et le premier qui porte une valeur l'emporte ; les **groupes** et les **répétitions** se lisent d'un seul chemin — « Mairie : Salle des mariages ; Complexe Sportif : Club House ». Ce qu'aucune colonne ne porte est conservé avec la demande et s'affiche sous « Demande d'origine »
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
- 📄 **Document pré-rempli par service** : un modèle `.docx` écrit dans Word est rattaché à un service, ses champs entre accolades sont détectés à l'import, et une liste déroulante relie chacun à une donnée de la demande. **Toutes** les réponses du formulaire y sont offertes — `{pole}`, `{lieux_exterieurs}`, `{debit_boissons}`… — et la liste des champs à écrire dans Word s'affiche, groupée par section, avant même d'avoir déposé un modèle. Chaque service reçoit **sa seule part** — celui qui instruit un débit de boissons n'a que faire du nombre de chaises — joint à la manifestation et à son courriel d'approbation. Le modèle peut être tenu dans **Nextcloud** et corrigé à un seul endroit : il est relu à chaque génération. Chaque modèle dit ce qu'il rend — **Word, PDF, ou les deux** : celui qui retouche son document avant de l'envoyer a besoin du `.docx`, celui qui le fait signer a besoin du PDF. Le PDF est converti par le serveur bureautique du Nextcloud — Euro-Office, ONLYOFFICE ou Nextcloud Office — sans machine supplémentaire à administrer, et s'il est injoignable le document part quand même, en Word
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

### ⏱️ Plannings et heures

Le parc dit ce que la commune possède ; ce module dit ce qu'il **coûte en heures**.

- 📝 **Saisie faite pour le terrain** : un agent déclare « aujourd'hui de 14 h à 16 h, Livraison Manifestation » en quelques secondes, depuis un téléphone. Date du jour pré-remplie, raccourci « Hier », puces de durée (30 min, 1 h, 2 h, demi-journée), et la durée calculée affichée en permanence — avant d'enregistrer, pas après
- 🏷️ **Catégorie créée à la volée** : le champ propose ce qui existe et enregistre ce qui manque. C'est **l'agent** qui découvre sur le terrain qu'il manque « Livraison Manifestation » ; l'envoyer demander à son responsable le ramènerait à cocher « Autre », et la statistique s'effondrerait dans cette case-là. Casse et accents sont neutralisés à l'écriture : « Tonte », « tonte » et « TONTE » restent une seule catégorie, sur SQLite comme sur MySQL
- 👥 **Le travail à plusieurs, compté juste** : deux agents une heure sur la même tâche font **deux heures de travail mobilisé** mais **une heure pour chacun**. Un renfort de 30 min sur une tâche de 2 h porte le total à 2 h 30. Un renfort est de préférence quelqu'un de l'annuaire — comptes et fiches sans compte confondus — ou, en dernier recours, un libellé libre (« un agent des espaces verts »)
- 🔀 **Deux mesures qu'on ne mélange jamais** : « temps total mobilisé » répond à *ce que cette tâche a coûté à la collectivité*, « temps d'une personne » à *ce que la journée de quelqu'un a contenu*. Le rapport bascule de l'une à l'autre, et dit en une phrase ce qu'il compte — un malentendu sur ce point suffirait à fausser une réunion
- 📊 **Rapports prêts à projeter** : semaine, mois, année ou période libre ; répartition par catégorie, par personne ou par manifestation ; camembert **et** tableau des durées et parts côte à côte ; comparaison avec la période précédente, avec la même période l'an dernier, ou avec une période choisie — en barres, parce qu'un camembert ne montre pas une variation
- 📤 **Exports qui disent la même chose que l'écran** : Excel (feuille *Synthèse* et feuille *Détail*, une ligne par contribution), CSV (point-virgule et BOM, pour Excel en français) et impression. Les mêmes filtres partent à l'export : le fichier ne peut pas contredire la page qui l'a demandé
- 🖨️ **Deux PDF, pour deux usages** : le **planning** en paysage — la grille de la semaine, puis le détail jour par jour avec les renforts et le temps mobilisé — et le **rapport d’activité** en portrait, camembert et écarts compris, prêt à distribuer en réunion. Les chiffres y sont **écrits en texte et non photographiés** : nets à l’impression, sélectionnables, et le document pèse quelques dizaines de kilo-octets au lieu de dix-huit mégaoctets. Un export lancé en thème sombre sort en clair — personne ne veut imprimer une page noire
- 🗓️ **Vue planning** : grille horaire semaine ou jour, colorée par catégorie, où un clic sur un créneau vide ouvre la saisie déjà remplie. Les tâches ne s'y déplacent pas à la souris — un glissement involontaire changerait des heures déjà déclarées sans rien signaler
- 👔 **Un agent, plusieurs encadrants** : Mme Martin *Responsable du service* et M. Jean *Référent de l'équipe* peuvent suivre le même agent, chacun à son titre. Un encadrant voit ses propres heures et celles de ses agents rattachés, rien de plus ; le rattachement est **réservé à l'administrateur**, car pouvoir s'attribuer des agents reviendrait à élargir seul son propre périmètre
- ⚠️ **L'oubli de rattachement ne passe pas inaperçu** : une personne rattachée à personne n'est visible que d'elle-même et de l'administrateur. Les paramètres l'affichent en tête, nommément, plutôt que de laisser croire en réunion qu'elle n'a rien saisi
- 🕛 **Ni fuseau ni changement d'heure** : le jour est une chaîne ISO, les horaires du texte, et la durée un entier de minutes calculé par le serveur. Aucune conversion UTC ne traverse un compteur d'heures, et la semaine ISO est calculée en JavaScript plutôt que confiée à `strftime` et `DATE_FORMAT`, qui ne s'accordent pas sur la première semaine de l'année

### 🎫 Tickets — les demandes internes

Les signalements passaient par **GestSup**, une application séparée : deuxième outil, deuxième annuaire, deuxième mot de passe, et aucun lien avec le parc. « Souci de bruit sur le Nemo » n'apparaissait nulle part dans la fiche du Nemo, et « le rideau est cassé à la salle des fêtes » se ressaisissait trois fois, faute de voir ce que les autres avaient déjà signalé.

- 🎯 **Une demande part toute seule au bon endroit** : la catégorie — Informatique, Bâtiment, Voirie — porte son **service destinataire** et son **technicien**. Le demandeur ne les choisit pas ; l'écran lui dit en clair où cela part (« cette demande partira au service Technique (Tom Tech) »), parce que personne n'aime envoyer dans le vide. Une sous-catégorie laissée sans réglage **hérite** de sa catégorie : l'acheminement s'écrit une fois, pas dix
- 🏢 **Le formulaire ne demande pas ce qu'il sait déjà** : rattaché à **un seul bâtiment**, le champ est masqué et rempli ; rattaché à **plusieurs**, il est proposé. Une catégorie peut forcer la question (la voirie, où le lieu *est* la demande) ou la supprimer (une création de compte n'a pas de lieu)
- 🔐 **Rien n'est attribué par défaut** : une personne demande dans les **catégories** qu'on lui donne, sur le **matériel qui lui est attribué**, et — si elle est **responsable** — pour son bâtiment. Proposer les douze bâtiments de la commune à un agent d'accueil garantit qu'il s'y trompe. L'écran d'attribution **nomme les comptes qui n'ont rien**, et le formulaire dit à qui n'a rien vers qui se tourner
- 🏫 **Une école a plusieurs responsables**, et trois cases indépendantes sur chaque lien personne↔bâtiment le disent : **signale pour le bâtiment**, **voit les demandes**, **reçoit les courriels**. La directrice coche les trois, l'élu regarde sans être dérangé à chaque ampoule grillée, le responsable des écoles est responsable de l'école et simple occupant de la mairie où est son bureau
- 🔖 **Numéro d'inventaire interne**, à côté de la référence : le service comptable numérote ce qu'il a **amorti**, les services numérotent ce qu'ils **manipulent**. Tenir les deux fait du rapprochement une jointure plutôt qu'un après-midi de recopie. Unique, cherché depuis la barre de recherche du parc, et affiché **hors de la configuration des champs** — il ne doit pas pouvoir disparaître d'un écran par un réglage
- 🧑‍🔧 **Attribuer depuis la fiche du matériel** autant que depuis celle de la personne : on affecte un poste en équipant quelqu'un, on corrige en ouvrant la fiche du poste le jour où il change de bureau. Un matériel attribué à personne n'apparaît dans le formulaire de personne, et le bloc le dit plutôt que de laisser chercher
- 💻 **« Mon matériel »** : son téléphone, son ordinateur. C'est ce que le formulaire propose quand il signale une panne, plutôt que tout le parc — où l'on finit par choisir le premier de la liste et envoyer la demande sur le matériel d'un collègue
- 🧰 **Attribuer en masse** : sélectionner douze personnes et leur donner une catégorie ou un bâtiment. Le geste **ajoute sans retirer** — il n'efface rien de ce qui était déjà donné, et ne défait aucun droit réglé finement
- 🔧 **Le matériel concerné, quand il a du sens** : proposé seulement si la catégorie l'autorise — et réglable **par personne** — puis limité au parc que cette catégorie associe. Le sélecteur de « souci de bruit sur le Nemo » ne déroule pas l'inventaire de la commune, et un ticket ainsi rattaché documente l'entretien du matériel
- 🚧 **Cloisonnement par équipe** : le service technique ne voit pas les demandes informatiques, et réciproquement. **Aucun rôle n'ouvre tout par lui-même**, pas même superviseur — qui doit tout voir le reçoit explicitement dans l'écran des droits. Un responsable voit en plus les demandes des agents qu'il encadre, par le lien qui sert déjà aux heures
- 👀 **Voir n'est pas lire** : les collègues d'un bâtiment voient les demandes qui le concernent — c'est ce qui évite trois signalements pour un même rideau — mais en **voisinage** : titre, état, date, demandeur. Ni le fil, ni les pièces, ni les notes internes. Et seulement sur les catégories déclarées partageables : l'informatique reste privée, parce qu'une demande de mot de passe n'a pas à circuler dans l'open space
- 🔁 **Le partage ne rétroagit pas** : basculer une catégorie en partagé n'expose pas ce qui a été écrit quand elle était privée. Un bouton le rattrape d'un geste, en le sachant
- 💬 **Un fil unique**, comme dans GestSup : ouverture, messages, changements d'état et pièces déposées dans une seule colonne. Deux tables pourtant — une trace d'audit ne se modifie pas — et un **compteur commun** les ordonne : un `DATETIME` ne porte pas les fractions de seconde, et une action en écrit plusieurs d'un coup. Sans lui, « Résolu » pouvait s'afficher avant « Ouverture »
- 🔒 **Note interne** : le technicien écrit « à commander chez X, délai trois semaines » sans l'adresser à celui qui attend. Le serveur ne l'envoie pas au demandeur, plutôt que de compter sur l'écran pour la cacher
- 📎 **Photos dans le message, documents en dessous** : une image déposée avec un message s'affiche **en vignette dans sa bulle**, une pièce déposée seule va dans les documents. Visuellement on a la photo dans le message ; techniquement aucun HTML n'est stocké — le dépôt n'a ni éditeur riche ni sanitiseur, et un module dont le principe est que des gens s'écrivent n'était pas l'endroit pour en introduire un
- 🚦 **Six états personnalisables** : à traiter, en cours, en attente de retour, en commande, résolu, refusé. Ils se renomment, se recolorent et se réordonnent — ce sont ceux de la collectivité, pas ceux du code, qui ne s'appuie que sur trois drapeaux (*ouvert*, *par défaut*, *final*). « En attente de retour » est ouvert sans être le défaut ; « refusé » est final sans être une résolution
- ⏱️ **Délais par catégorie** : prise en charge et résolution, en minutes. Les échéances sont posées à l'ouverture, la file signale d'un liseré rouge ce qui est en retard, et la prise en charge **ne rajeunit jamais** — un aller-retour par « en attente » ne remet pas le compteur à zéro
- 🗂️ **File façon GestSup** : les états en colonne de gauche avec leur compteur, l'arbre des catégories en dessous, la liste à droite. Les filtres vivent **dans l'URL** (`?statut=2&categorie=5`), donc se copient dans un message
- 🏛️ **Les bâtiments sont ceux du module Clés**, promus en référentiel partagé : une seule liste à tenir, et les lieux déjà saisis servent immédiatement. Ils se tiennent dans **Paramètres › Organisation** (voir plus bas). Un bâtiment cité par une demande ne se supprime plus — l'historique perdrait son lieu — mais se **désactive**
- 🤝 **Ouvert au rôle « Service partenaire »** : c'est lui qui traite les demandes qu'on lui adresse, et qui en ouvre au service voisin
- ⏱️ **Le temps passé vient des plannings**, pas d'une seconde comptabilité : une tâche se rattache à une demande comme elle se rattache déjà à une manifestation. L'agent saisit ses heures **une fois**, et le rapport sait ce qu'une demande a coûté — renforts compris
- 🔧 **La fiche d'un matériel montre ses demandes** : « souci de bruit sur le Nemo » entre dans l'historique du Nemo, aux côtés de ses entretiens. Le bouton « Signaler un problème » ouvre le formulaire avec le matériel **déjà rempli**
- 📊 **Médiane *et* moyenne** sur les délais : une demande qui traîne six mois tire la moyenne d'un service qui répond en deux heures, et le chiffre seul fait conclure l'inverse. L'écart entre les deux devient le renseignement. Les délais ne se mesurent que sur ce qui est **clos**, et le rapport est borné par la portée de son lecteur
- 📈 **Un onglet Rapport** : volumes, délais tenus, répartitions par catégorie, bâtiment et technicien, temps passé. Chaque graphique porte **son tableau à côté** — trois teintes de la palette passent sous 3:1 de contraste, et l'identité d'une barre ne repose jamais sur sa seule couleur. La période vit dans l'URL, donc le rapport se partage par un lien
- 📥 **Reprise de GestSup, rejouable** : l'identifiant d'origine est conservé, relancer un import interrompu ne double rien, et le numéro connu des agents (`G-2646`) reste la référence. L'**essai à blanc est le défaut** — il faut demander l'écriture. Ce qui ne se rapproche pas est **signalé, pas deviné** : une catégorie inconnue n'est jamais rangée dans la première venue. Les demandeurs absents sont inscrits à l'annuaire **sans accès**

> **Pièces jointes et rôles.** `POST /api/upload/file` est réservé aux agents de terrain : c'est le bon réglage pour le parc, et le mauvais ici, puisque le demandeur d'un ticket est justement un compte en consultation. Les pièces passent donc par une route du module, gardée par la **portée de la demande** et non par le rôle. Le glisser-déposer, la prise de photo et la réduction côté client restent les mêmes.

> **GestSup reste en place.** Rien n'oblige à basculer ; l'historique se reprendra dans un second temps.

- 📧 **Les courriels se règlent en phrases, pas en cases** : « Quand *n'importe quel événement* se produit, pour une demande de *Bâtiment*, sur *Mairie* → prévenir *l'élu aux travaux* ». Chaque condition laissée sur « peu importe » **élargit** la règle : une règle qui ne porte que sur un bâtiment vaut pour toutes ses demandes, sans qu'on ait à en écrire une par catégorie
- ➕ **Les règles ajoutent, elles ne remplacent jamais** : prévenir le responsable de la maintenance parce qu'on est à la mairie ne retire pas le technicien attitré. Faire gagner la règle la plus précise aurait produit exactement ce défaut, et personne n'en aurait compris la cause
- 🧪 **Un bouton « Tester »** : composez « une fuite à la mairie », et lisez qui serait prévenu **et à quel titre** — « technicien affecté », « service Technique », « Élu aux travaux ». Sans lui, on découvre l'effet d'une règle sur une vraie demande, un mois plus tard
- 🙋 **Une personne sans compte reste joignable** : l'élu chargé des travaux figure à l'annuaire sans identifiants. La grille par rôle l'écarte à dessein — les liens mèneraient à un écran de connexion — mais une règle qui le **nomme** l'atteint : on lui écrit qu'il y a une fuite, pas qu'il doit se connecter
- 🔕 **Chacun règle ce qu'il reçoit**, sauf une demande qu'on lui confie : la couper laisserait le travail attendre sans que personne le sache. Une **note interne** ne part jamais par courriel — c'est tout son objet
- ⏰ **Le délai dépassé se signale une fois**, pas toutes les quinze minutes : une trace au fil de la demande sert de témoin. Sans elle, un retard de trois semaines aurait produit deux mille courriels. Une alerte est posée au passage, donc la pastille du menu la compte sans qu'on ait rien branché

### 🏢 Organisation — bâtiments, salles, services, et qui les gère

Bâtiments et services servent à tous les modules — demandes, clés, manifestations, prêt de salles — mais se réglaient chacun dans le module qui les avait vus naître : les bâtiments dans Tickets, leur arbre dans Clés, les services dans Manifestations. Ils se tiennent désormais au même endroit, **Paramètres › Organisation**, et les anciens onglets y renvoient.

- 🏛️ **Bâtiments** : l'arbre bâtiment › salles et pièces › portes, et sous chaque bâtiment les **personnes rattachées** avec leurs quatre droits indépendants — *Responsable*, *Voit*, *Reçoit*, et **Gère**
- 🚪 **Salles** : la salle du conseil, des mariages, du CCAS… dans un seul tableau, tous bâtiments confondus — places, prêt, activité — modifiable sur place. Une salle est une pièce de nature « Salle », c'est la nature proposée par défaut, et les variantes de casse déjà saisies sont ramenées à « Salle »
- 👥 **Services** : membres, périmètre, responsable et délégations, comme avant
- 🛡️ **Gestionnaires** : qui gère quoi, et surtout ce que personne ne tient — un service sans responsable ne peut rien approuver

**La gestion se confie sans changer le rôle.** Faire du régisseur des salles un superviseur lui donnait au passage la suppression du matériel et les seuils d'alerte ; on lui confie désormais la seule chose qu'il doit faire :

| Qui | Ce qu'il gère |
|---|---|
| **Gestionnaire de toute l'organisation** (désigné par l'administrateur) | tous les bâtiments, salles et services, et désigne les gestionnaires locaux |
| **Gestionnaire d'un bâtiment** (case « Gère ») | ce bâtiment, ses salles, ses portes et les personnes qui y sont rattachées |
| **Responsable d'un service** (l'étoile) | la liste des membres de son service, en plus d'approuver et de déléguer |

Un gestionnaire local **ne s'étend pas lui-même** : il ne fait pas d'autres gestionnaires, ne touche ni à un bâtiment ni à un service voisin, et n'accroche pas ses portes aux salles d'un autre bâtiment. Le superviseur garde la gestion des bâtiments, qu'il avait déjà. Le serveur tranche, l'interface ne montre que ce qu'il accepterait.

**Les salles pour le formulaire de réservation** — sans compte, derrière le limiteur de la réception :

```http
GET /api/lieux/public/salles?debut=2026-10-03T14:00&fin=2026-10-03T18:00&capacite=30
```

```json
{ "success": true, "lieux": [
  { "siteId": 1, "pieceId": 4, "nom": "Salle du conseil", "siteNom": "Mairie",
    "libelle": "Salle du conseil — Mairie", "typeLieu": "Salle", "capacite": 40,
    "libre": true, "occupe": [] } ] }
```

Seules les salles **ouvertes au prêt** y figurent, jamais un bâtiment entier ; un visiteur anonyme ne voit que les bornes des créneaux pris, pas l'intitulé ni le demandeur. `GET /api/lieux/public/disponibilite?type=Salle` rend la même chose, et `type` accepte toute autre nature de pièce.

### 🏛️ Bâtiments — contrôles obligatoires, rapports et échéances

Électricité tous les ans, extincteurs, alarme incendie, amiante tous les trois ans, ascenseur tous les cinq : le module **Bâtiments** suit, bâtiment par bâtiment, les contrôles qu'une collectivité doit faire, les rapports qui les prouvent, et prévient avant l'échéance.

- 📋 **Un catalogue livré** de 27 contrôles et objets (électricité, extincteurs, SSI, désenfumage, éclairage de sécurité, RIA, gaz, chaudière, ramonage, portes automatiques, ascenseur, amiante DTA, légionellose, radon, aires de jeux, équipements sportifs, commission de sécurité, exercice d'évacuation, PPMS, hottes, paratonnerre, DPE, OPERAT, factures, contrats…), avec la référence réglementaire quand elle est sûre
- ⏰ **Périodicité et rappel réglés en un clic** dans *Paramètres › Bâtiments* — « tous les ans », « prévenir 2 mois avant » —, appliqués à tous les bâtiments d'un bouton, surchargeables bâtiment par bâtiment
- 📄 **L'échéance se lit sur le dernier rapport validé** : sa date plus la périodicité, ou la prochaine échéance qu'il indique. Un rapport en attente ou refusé ne compte pas
- ✅ **Dépôt et validation** : le gestionnaire du bâtiment dépose et valide d'un geste ; le **responsable** (la directrice d'école pour le PPMS) dépose, et le document attend dans la file *À valider*, relu à côté de l'aperçu, reclassé puis validé ou refusé avec motif
- 🔔 **Alertes « Bâtiment »** dans le délai de rappel, critiques une fois l'échéance passée, envoyées aux gestionnaires du bâtiment ; elles disparaissent quand un rapport validé repousse l'échéance, et ne se montrent qu'à qui suit le bâtiment
- 🔒 **Fichiers privés** : rangés sous `uploads/prive/`, jamais servis en statique, lus par une route qui vérifie les droits et ne met rien en cache ; pas de SVG
- 🗺️ **Étages et plans** : un plan par étage (PDF converti dans le navigateur, ou image ; DWG à exporter en PDF), pièces dessinées au clic, étalonnage pour les surfaces ; un clic sur une pièce montre son **matériel** (posé depuis le parc), les **clés qui l'ouvrent** et leurs détenteurs, ses portes et ses documents ; la recherche retrouve un matériel et surligne sa pièce
- ⚡ **Énergie** : compteurs et relevés, factures d'électricité, de gaz, d'eau, de fioul ou de chaleur avec la période couverte (répartie au jour), coût et consommation de l'année comparés à la précédente, ratios au m², jours couverts par des factures
- 📑 **Contrats de maintenance** : sur un ou plusieurs bâtiments, avec la **date clé** — veille du préavis d'un contrat tacite, ou fin — rappelée un mois avant par une alerte et un courriel
- 🔧 **Interventions** : dépannages, entretiens, travaux, par pièce, entreprise, contrat et demande ; un contrôle validé avec son coût s'y inscrit de lui-même
- 📊 **Coûts et statistiques** : énergie, contrats, interventions, contrôles et achats en camemberts, barres par semaine, mois ou année et par bâtiment (au m² si l'on veut), comparés à la période précédente ou à l'an passé ; tout est réparti au jour, la couverture des factures est signalée, et l'**export PDF** reprend les filtres avec les sections choisies

| Qui | Ce qu'il peut faire |
|---|---|
| **Administrateur, superviseur, gestionnaire de toute l'organisation** | tous les bâtiments, et le catalogue des contrôles |
| **Gestionnaire d'un bâtiment** (case « Gère ») | suivre et régler les contrôles de son bâtiment, déposer, valider, reclasser, refuser |
| **Responsable d'un bâtiment** (case « Responsable ») | voir les contrôles et documents de son bâtiment, y déposer — un gestionnaire valide |

Le rôle « Service partenaire » n'y a pas accès.

**Les entreprises extérieures** — électricien, société d'ascenseur, bureau de contrôle — ont un **portail sans compte**, `/prestataires/<lien>`, ouvert par un lien et un code :

- 🏢 **Fiche** dans *Bâtiments › Entreprises* : nom et courriel obligatoires, téléphone, adresse, SIRET, et des **contacts** (nom, fonction, téléphone, courriel) dont on coche ceux qui reçoivent l'accès
- ✅ **Droits en deux listes** : les bâtiments ouverts, puis les objets, chacun en **Lecture** (documents validés) et/ou en **Dépôt**
- 🔑 **Code `ABCD-EFGH` permanent**, montré une seule fois à la génération et envoyé avec le lien ; date de fin facultative, suspension, régénération (l'ancien code et ses sessions tombent)
- 📤 **Dépôt simplifié** : titre, date, objet — le champ objet (et bâtiment) ne s'affiche pas quand un seul est ouvert ; le document attend la validation, au nom de l'entreprise
- 🛡️ Même réponse pour un lien inconnu et un code faux ; dix essais par quart d'heure et par poste, verrou d'une demi-heure après vingt échecs d'affilée ; session de huit heures, jamais mise en cache

### 🌳 Espaces Verts
- 📦 **Implantation depuis le parc** : le matériel se déclare **une fois**, dans le parc — des lots (rosiers, bulbes, graminées) et du mobilier tenu à l'exemplaire ou en lot — puis se **pose** dans un espace vert, en quantité, éventuellement dans une jardinière qui mêle plusieurs variétés. Le type d'élément est deviné de la branche du parc, la jardinière se crée au moment où l'on plante
- 💶 **Prix figé à la pose** : repris du parc ou corrigé selon la facture. Mettre à jour un tarif ne réévalue **jamais** ce qui a déjà été planté — c'est ce qui permet de dire ce qu'un massif a réellement coûté, des années après
- 📊 **Coûts par groupe, variété, type et année** : ce qu'a coûté *cette* jardinière, ce que pèsent les rosiers tous massifs confondus, ce qu'a coûté le fleurissement d'une saison. Et sur l'ensemble des espaces, un total **par nature de lieu** — ronds-points, allées, parcs. Les lignes sans prix sont comptées à part, jamais chiffrées à zéro
- 🪄 **La fiche se remplit depuis la carte** : à la création d'un espace vert, « Créer depuis la carte » cadre le lieu et renseigne le **plan et son échelle**, la **position**, l'**adresse**, et — quand OpenStreetMap connaît le lieu — le **nom du parc**, sa **superficie** et son **contour**, tracé d'emblée sur le plan. Rien n'est tapé à la main, et tout reste modifiable
- 🛰️ **Le plan se fabrique depuis la carte** : plus besoin de trouver une image ailleurs, ni de la calibrer. On cadre le parc sur une **photo aérienne** — ou sur le plan IGN, ou sur OpenStreetMap —, on clique « Utiliser cette vue », et le plan arrive **déjà à l'échelle**. Aucune clé ni compte tiers : tuiles IGN sous licence ouverte et OpenStreetMap, source gravée sur l'image. Une recherche d'adresse dépanne quand l'espace vert n'a pas encore de position
- 🔍 **La vue s'ouvre sur ce qui compte** : une capture prend le format de la carte affichée, très allongé sur un écran large, et un massif de six cents mètres carrés s'y perd au milieu de six cents mètres de ville. Le plan se cadre désormais **tout seul sur ce qui est posé** à l'ouverture de la fiche — plus besoin de zoomer à 300 % à chaque fois —, et un bouton y revient d'un clic après avoir exploré ailleurs
- 🖼️ **Changer de fond sans rien déplacer** : trois boutons dans la barre du plan — Photo, Plan, OSM — rejouent la **même vue** avec une autre imagerie. Repères, zones, surfaces et échelle sont conservés au millimètre : c'est le même terrain, vu autrement
- ✂️ **Recadrer un plan trop large** : la fenêtre de capture se rouvre sur le cadrage actuel, avec un bouton « Cadrer sur le posé » qui vise directement ce qui est sur le plan. Tout ce qui y est posé est **replacé automatiquement au même endroit sur le terrain**, et les surfaces ne changent pas. Un cadrage qui amputerait un contour est refusé en nommant ce qui dépasse : une zone rognée garderait une forme plausible avec une surface fausse, donc un coût faux
- 🧭 **Contour du parc récupéré d'OpenStreetMap** : le contour d'un parc communal y est souvent déjà relevé, au mètre près et par quelqu'un qui était sur place. Il est **proposé** après la capture, forme affichée sur le plan et surface calculée, jamais posé d'office — on le retient, on le retouche sommet par sommet, ou on le refuse. Un contour qui dépasse du cadre est signalé comme tel : sa surface serait tronquée, donc fausse
- 🗺️ **Plan qui se manipule à la main** : on attrape un repère et on le pose, la molette zoome là où l'on pointe, le glisser déplace la vue. Quatre outils nommés — déplacer, poser, dessiner, mesurer — et une ligne d'aide qui dit ce que le prochain clic va faire. `Ctrl+Z`, `Échap`, `Suppr` et les flèches font ce qu'on attend
- 📐 **Zones que l'on retouche** : un sommet se déplace, un point clair au milieu d'un côté en insère un, `Alt`+clic en retire un, le glisser de l'intérieur pousse la zone entière. On referme en revenant sur le premier point, par un double-clic ou par `Entrée`
- 📏 **Plan calibré, surfaces calculées** : un plan **capturé depuis la carte** est calibré d'office — la taille d'un pixel se déduit du zoom et de la latitude, il n'y a rien à mesurer. Sur une image chargée à la main, tracez une longueur que vous connaissez — une façade, un terrain — et donnez-la en mètres. Dans les deux cas, **chaque zone affiche ensuite sa surface toute seule**, réglette d'échelle à l'appui. Facultatif : une surface se saisit toujours à la main, et une valeur corrigée ainsi n'est jamais réécrite par un sommet déplacé ensuite
- 🧱 **Matériau et coût d'une zone** : gazon, enrobé, écorce se choisissent dans le parc ; la surface devient la quantité, le prix au m² est figé à la pose, et le coût se lit par type, par variété et par année comme le reste. Une case « ne pas compter dans les coûts » permet de tracer ce qui était déjà là sans lui inventer un prix — ces lignes sont comptées à part, jamais fondues dans un total
- ➕ **On crée depuis le plan** : implanter depuis le parc, ajouter un élément libre, poser un élément déjà saisi ou un simple repère, tous à l'endroit désigné. « Ajouter un banc là où je pointe » demandait deux onglets et trois écrans
- 🎛️ **Panneau, calques et légende** : la liste de ce qui est sur le plan et de ce qui ne l'est pas encore, avec recherche et œil pour masquer ; éléments, groupes, repères, zones et étiquettes s'affichent ou se cachent
- 🔒 **Quel parc est proposé aux espaces verts** : réglable par l'administrateur, par catégorie, sous-catégorie ou matériel — un jardinier n'a pas à chercher « gazon » au milieu des barrières Vauban et des radars pédagogiques
- 📐 **Superficie reprise du plan** : la fiche propose la surface du plus grand tracé (« Reprendre celle du plan »), plutôt que de la faire retaper de mémoire — deux chiffres qui se contredisent, c'est le dessin qui a raison
- 🧭 **Ce que la fiche ne demande plus** : le « type de sol », réponse unique pour tout un parc, ne s'affiche plus que là où il avait déjà été rempli. Chaque zone porte désormais son matériau du parc — gazon, enrobé, écorce — avec son prix, ce qu'une pelouse, une allée gravillonnée et un massif ne pouvaient pas dire d'une seule voix
- 🌿 **Éléments du plan** : 8 types (arbre, arbuste, massif floral, haie, pelouse, bassin, mobilier, autre) avec état de santé et fiche détaillée
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

### 🗺️ Cartographie — où est implanté le matériel
- 🪑 **Un modèle au parc, des exemplaires sur le terrain** : « Banc modèle Ville » reste **une** fiche dans les catégories ; ses exemplaires se posent depuis la cartographie, **numérotés d'office** — Banc 1, Banc 2, … Banc 23 —, chacun avec sa position, sa rue, son état et son historique. Plus besoin de créer vingt-trois fiches identiques, ni de se contenter d'un champ « quantité : 23 » qui ne dit ni où ils sont ni lequel a été repeint
- 🌳 **Voirie et espaces verts sur la même carte** : un banc est un banc, qu'il soit scellé rue de la Gare ou posé dans le square. Les éléments des espaces verts apparaissent à côté du mobilier de voirie, avec les mêmes pictogrammes, la même recherche, les mêmes filtres et le même export. Un sélecteur **« Partout / Voie publique / Espaces verts »** restreint quand on prépare une tournée — le défaut montre tout, parce que c'est la question qu'on se pose
- 🛰️ **Les éléments posés sur un plan capturé sont situés sur le globe** : le cadrage mémorisé à la capture dit à quel morceau de terrain les pourcentages du plan correspondent. Un arbre pointé sur le plan d'un parc tombe au bon endroit sur la carte de la commune, au mètre près
- ⚠️ **La carte dit ce qu'elle ne sait pas** : un élément sans plan capturé ni relevé de terrain retombe sur le marqueur de son parc — « quelque part dans ce parc » —, son marqueur est tracé en **pointillés** et sa fiche annonce « position approchée ». Le nombre d'implantations que la carte ne peut pas montrer est affiché en haut de l'écran
- 📍 **Poser en trois questions** — quoi, où, le reste. Le catalogue annonce pour chaque modèle **combien sont déjà posés**, voirie et espaces verts comptés séparément, ce qui répond au passage à « l'ai-je déjà créé ? ». « Poser et continuer » enchaîne sur l'exemplaire suivant du même modèle sans repasser par le catalogue
- 📲 **Trois façons de dire « où »** : le doigt sur la carte au bureau, **« Utiliser ma position »** sur le trottoir, et **« Dans une jardinière déjà posée »**. L'application retient laquelle a parlé et la précision du relevé. Sur la fiche d'un exemplaire, **« Je suis devant »** reprend la position d'un seul geste
- 🌷 **Une jardinière hors espace vert porte ses plantations** : un bac sur un îlot de parking n'est pas un parc, et lui créer une fiche d'espace vert de 0,4 m² avec plan et contour serait absurde. Il est un mobilier comme un autre, et ce qu'il contient aussi — avec une **quantité**, parce que douze géraniums sont une ligne et non douze. Le contenu prend la position et l'adresse du contenant, le suit quand on le déplace, et part avec lui
- 🏠 **Adresse, rue et quartier lus du point** par géocodage inverse, et modifiables : c'est ce que personne ne tape sur un téléphone, et ce dont l'export « par rue » a besoin
- 🎨 **Des marqueurs qu'on distingue sans cliquer** : la famille — éclairage, banc, corbeille, abribus, potelet, passage piéton, jardinière, arbre, massif, pelouse… — est **devinée du catalogue** et donne sa couleur et son pictogramme au point. Aucun référentiel à garnir avant de poser le premier banc ; une pastille signale ce qui est hors service, en mauvais état ou en retard d'entretien
- 🔧 **Un historique par exemplaire** : « le banc 23 a été repeint le 14 mars, en vert RAL 6005, par la régie, pour 85 € » se range sur ce banc-là et sur aucun autre. Onze natures d'intervention (pose, contrôle, nettoyage, entretien, peinture, réparation, remplacement de pièce, déplacement, dépose, dégradation, autre). L'état après intervention et la prochaine échéance se saisissent dans le même formulaire. Côté espaces verts, les entretiens rattachés à un élément se lisent au même endroit
- 🗺️ **Trois fonds de carte** — photo aérienne IGN, plan IGN, OpenStreetMap —, les mêmes que le plan d'un espace vert. Aucune clé ni compte tiers ; le choix est mémorisé
- 🔍 **Recherche à deux étages** : le simple tient sur une ligne (un mot, une catégorie, un modèle, un gisement, un statut) ; l'avancé, replié, ouvre l'état, l'espace vert, la rue, la zone, les dates de pose, l'échéance, « en retard », « jamais entretenu », « inclure le déposé » et **« autour de moi »** à 100 m, 300 m ou 1 km. Les rues et zones proposent ce qui a **déjà été saisi**, pour que « rue de la Gare » tapée trois fois ne fasse pas trois rues
- 📄 **Export PDF paramétrable** : regroupement **par matériel, par lieu, par rue, par zone, par catégorie, par statut ou par état** ; seize colonnes à cocher ; la carte telle qu'elle est affichée ; une synthèse par groupe ; l'historique des interventions sous chaque ligne ; titre, mention de service et orientation libres
- 🔗 **Onglet « Implantations » sur la fiche d'un matériel** : « 5 implantations — 3 sur la voie publique, 2 dans les espaces verts », avec l'état et le dernier entretien de chacune. Chaque ligne renvoie là où elle vit — la carte pour la voirie, la fiche du parc pour un espace vert, ouverte directement sur le bon parc
- 🔒 **Quel parc se pose sur la voie publique** : réglable par l'administrateur depuis **Paramètres → Cartographie**, par catégorie, sous-catégorie ou matériel — même mécanique que le prêt en manifestation et l'implantation en espace vert, **le réglage le plus précis l'emporte**. Les prestations sont exclues d'office : elles ne se scellent pas dans un trottoir
- 🗃️ **« Déposé » plutôt que supprimé** : un candélabre retiré sort de la carte et garde son historique — « qu'y avait-il à cet angle avant ? » ne doit pas rester sans réponse
- ✍️ **On lit partout, on écrit là où ça vit** — à une exception près, et elle se justifie seule : **consigner un entretien** sur un élément de parc se fait depuis la carte, parce que c'est le geste de terrain. Il est rangé là où le module des espaces verts le range — un chantier du parc rattaché à ce seul élément —, apparaît donc aussi dans son onglet Entretien et pose son rendez-vous au calendrier. Le reste — libellé, position, surfaces, coûts figés, saisons — ne se modifie que dans la fiche du parc, qui seule les connaît

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
- ⏱️ **Plannings et heures** *(plugin système)* : Temps passé par tâche et par catégorie, travail à plusieurs, statistiques, camemberts, comparaison entre périodes et exports

### 🔌 Système de Plugins Avancé
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
- 🔗 **Autant d'agendas externes que nécessaire**, chacun avec ses identifiants : le carnet du service technique, celui des espaces verts, celui du régisseur des salles. CalDAV (Nextcloud, Synology, iCloud, Google) et Outlook via Azure AD
- 🚦 **Chaque carnet ne reçoit que ce qu'on lui désigne** : par **nature** d'échéance — entretien du parc, contrôle technique, espaces verts, mobilier de voie publique, manifestations, rendez-vous saisis à la main — et par **catégorie** de matériel. Ne rien cocher veut dire « tout ». Sans cet aiguillage, brancher un CalDAV y déversait les tontes de pelouse à côté des contrôles techniques des camions, et la seule réaction possible était de couper
- ↔️ **Envoi, réception, ou les deux** : les échéances de l'application partent en iCalendar vers le carnet du service concerné, et celui-ci peut en retour faire apparaître ses propres rendez-vous dans le calendrier. Ce qui cesse de correspondre aux règles est **retiré** du carnet distant
- 👁️ **Un aperçu avant d'envoyer** : combien d'événements partiraient, de quelles natures, et les premiers titres — un aiguillage se règle autrement à l'aveugle
- 🔒 **La vue du calendrier ne change pas** : elle affiche toutes les échéances que vos droits vous permettent de voir. L'aiguillage décide de ce qui *sort*, jamais de ce qui s'affiche
- ⚠️ Système d'alertes automatiques
- 📧 Notifications par email
- 🔔 Compteur d'alertes en temps réel

### Administration
- ⚙️ Paramètres généraux (nom du site, logo, favicon)
- 📧 Configuration SMTP avec test d'envoi
- 📝 Templates d'emails personnalisables
- 💾 **Sauvegarde et restauration** complètes, SQLite comme MySQL : toutes les tables, identifiants compris, fichiers téléversés et plugins. Une sauvegarde de sécurité précède chaque restauration ; la sauvegarde nocturne s'active depuis la page des sauvegardes
- 🔄 Migration SQLite vers MySQL/MariaDB — depuis l'écran Base de données, ou en restaurant une sauvegarde SQLite sur un serveur MySQL
- 🧪 **Données de test** : un gros jeu cohérent dans tous les modules pour éprouver l'application, une purge qui ne retire que lui, et une réinitialisation vers une base vierge avant la mise en production (voir ci-dessous)
- ✉️ **Suspension des envois automatiques** : échéances, rappels et alertes retenus d'un interrupteur ; posée d'elle-même pendant les essais
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
