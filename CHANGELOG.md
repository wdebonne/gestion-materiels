# Changelog

Toutes les modifications notables de ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/lang/fr/).

## [Non publié]

### Ergonomie terrain

> L'application est utilisée par des agents de métier manuel — jardiniers, mécaniciens, chauffeurs — sur téléphone, dehors, parfois avec des gants et sans réseau. Cet ensemble de changements part de cet usage.

#### Ajouté

- **Rôle « agent de terrain »** : quatrième rôle, entre utilisateur et superviseur. Il peut relever un plein, un entretien, un contrôle technique, un entretien d'espace vert, joindre une photo et demander une réservation. Le référentiel (types, statuts, groupes, seuils) et toutes les suppressions restent au superviseur. Auparavant, pour saisir un plein, un jardinier devait être promu superviseur — ce qui lui donnait au passage la suppression des espaces verts et la gestion du stock des manifestations
  - Garde serveur unique `requireFieldWrite`, pour que le retour arrière tienne en une ligne
  - Hook `usePermissions()` et composant `<Can>` côté client, au lieu de recopier `user?.role === 'admin' || …` page par page
  - Déploiement en deux temps : d'abord les boutons honnêtes sans changement de droits, puis l'ouverture des droits une fois la matrice de tests écrite
- **Saisie hors réseau** (`lib/offlineQueue.ts`) : un relevé saisi sans connexion est conservé et renvoyé automatiquement au retour du réseau
  - Liste blanche stricte d'URL, jamais de `DELETE` mis en file
  - Bandeau permanent tant que la file n'est pas vide, avec le nombre de saisies en attente et un bouton d'envoi manuel
  - Une erreur 4xx abandonne la saisie et le signale ; une erreur réseau arrête le traitement pour préserver l'ordre
  - Persistance IndexedDB avec repli en mémoire
- **Scan de QR code** : page `/scan` utilisant le décodeur natif du navigateur (`BarcodeDetector`). Le QR code était généré depuis toujours et n'était scannable depuis nulle part
- **Position GPS** (`useGeolocation`, `LocationPicker`) : bouton « Utiliser ma position » avec précision affichée et aperçu OpenStreetMap, au lieu d'une latitude et d'une longitude à recopier. `navigator.geolocation` n'était jamais appelé
- **Photo** : bouton « Prendre une photo » ouvrant l'appareil, redimensionnement avant envoi (12 Mo → ~400 Ko), redressement EXIF côté serveur via `sharp` — installé et inutilisé jusqu'ici
- **Listes fermées** (`ReferenceSelect`) pour station-service, prestataire et centre de contrôle. « Total Pavilly », « TOTAL Pavilly » et « total pavilly » formaient trois stations distinctes et fragmentaient les rapports de coûts
- **Recherche globale** : une seule recherche sur tout le parc. Il n'en existait aucune, seulement 19 champs de recherche locaux indépendants
- **Actions rapides** sur l'accueil, **favoris personnels**, **barre de navigation basse sur mobile**, **aide contextuelle** par page
- **Préférences d'affichage** : taille du texte (normal / grand / très grand) et contraste renforcé, pour le travail en plein soleil
- **Rester connecté** : coché, la session survit à la fermeture du navigateur ; décoché, elle passe en `sessionStorage` et disparaît avec l'onglet. La case existait sans état ni gestionnaire, et la session était de toute façon écrite en `localStorage` : sur le PC partagé de l'atelier, l'agent suivant héritait de la session du précédent
- **Fenêtre de session expirée** : reconnexion par-dessus l'écran courant, sans détruire le formulaire en cours de saisie
- **Écran d'erreur avec bouton Réessayer** (`ErrorBoundary`) : une erreur de rendu donnait une page blanche
- **Page 404** : une URL inconnue redirigeait silencieusement vers l'accueil
- **Bandeau de mise à jour** : la PWA se rechargeait au milieu d'une saisie

#### Corrigé

- **45 mutations muettes** : la page Espaces Verts comptait 45 `useMutation`, aucun `onError`, aucun message. Enregistrer, supprimer, cloner ou archiver un espace vert ne produisait aucun retour, ni en succès ni en échec. Corrigé par un `MutationCache` global, en une dizaine de lignes
- **Boutons qui mentaient** : un compte sans droits d'écriture voyait quand même « Ajouter un plein ». Il remplissait le formulaire, appuyait sur Ajouter, et rien ne se passait — le 403 n'était pas intercepté. Les boutons sont désormais masqués, et un refus affiche « Vous n'avez pas les droits… »
- **Perte de réseau silencieuse** : l'absence de réponse n'était signalée nulle part
- **Messages d'erreur techniques** : `getErrorMessage()` filtre les messages SQLite, MySQL et les traces avant affichage, et traduit chaque code HTTP en français
- **`confirm()` natif** remplacé sur 12 sites par une boîte de dialogue expliquant ce qui va être perdu
- **Cibles tactiles** portées à 44 px minimum ; les actions Modifier et Supprimer des cartes étaient en `opacity-0 group-hover:opacity-100`, donc invisibles et inaccessibles sur écran tactile
- **Contraste et typographie** : `text-gray-400` (2,8:1, échec WCAG AA) était utilisé 339 fois ; l'échelle typographique a été remontée d'un cran dans `tailwind.config.js`, ce qui corrige 716 `text-sm` et 424 `text-xs` en une fois
- **Mode sombre** complété sur 8 pages et 6 primitives qui n'avaient aucune classe `dark:`
- **Langue verrouillée en français** : la détection automatique basculait toute l'interface en anglais sur une tablette configurée en anglais, alors que `useTranslation` n'est utilisé que dans 1 fichier sur 60
- **Alertes marquées comme lues pour tout le monde** : `PUT /alerts/read-all` faisait `UPDATE alerts SET is_read = 1` sans filtre utilisateur — un agent qui vidait sa pastille vidait celle de toute la collectivité. Table `alert_reads` par utilisateur
- **Emails d'alerte** envoyés aussi à la personne qui entretient le matériel, et plus seulement aux administrateurs et superviseurs
- **`emitAlert()` jamais appelé** dans le cron : il était importé et inutilisé, donc aucune alerte n'arrivait en temps réel
- **Pagination invisible** : au-delà du vingtième matériel, les suivants n'étaient pas affichés
- **Réponses API mal déballées** : `res.data.data || res.data` renvoyait l'objet de réponse entier, et les pages Cartographie et Suivi plantaient sur `categories.map is not a function`

### Sécurité — portée des matériels

- **Revue systématique de la portée par catégorie.** Trois défauts identiques trouvés séparément — tokens API, export, génération de QR codes — n'étant pas une coïncidence, les treize fichiers touchant la table `objects` ont été revus, puis sondés avec un compte sans aucune permission. Quatre endpoints rendaient des matériels hors périmètre :
  - `GET /objects/:id` — la liste filtrait, le détail non : la fiche complète était lisible en connaissant l'identifiant
  - `GET /green-spaces/search/objects` — recherche libre sur tout le parc, prix d'achat compris
  - `GET /reservations` — nom et référence via les réservations
  - `GET /calendar/events` — nom via les événements, sur quatre requêtes
  - La règle est désormais écrite une seule fois, dans `middleware/objectScope.ts`. Une variante distincte traite les tables qui *référencent* un matériel : un événement de calendrier sans matériel reste visible de tous, sinon la protection deviendrait une régression
  - Un test de contrat énumère les fichiers lisant `objects` et échoue dès que l'un d'eux n'applique ni la portée ni une exemption motivée. Cinq fichiers sont exemptés, chacun avec sa raison
  - La première sonde avait sous-estimé le problème : deux endpoints ne laissaient rien fuir **faute de données**. Il a fallu créer une réservation et un événement pour que la fuite apparaisse

### Étiquettes QR

- **Impression en lot.** `POST /api/qrcode/batch` renvoyait jusqu'à 100 étiquettes depuis toujours et n'était appelé par aucun écran : les QR codes s'imprimaient un par un depuis la fiche de chaque matériel. Étiqueter un parc de cinquante machines demandait cinquante allers-retours
  - Bouton « Étiquettes QR » sur une catégorie ou une sous-catégorie, sélection des matériels, planche A4 de deux colonnes en 95 × 52 mm avec QR code, nom et référence
  - Les lots de plus de 100 matériels sont découpés automatiquement — la limite du serveur ne doit pas se traduire par un découpage à la main
  - Une étiquette n'est jamais coupée entre deux pages, et un nom trop long ne pousse pas le QR code hors du cadre
- **Génération cloisonnée par les permissions de catégorie.** Les deux routes QR n'avaient que `authenticateToken`, et la génération en lot renvoyait nom, référence et numéro de série pour des identifiants arbitraires : un compte sans aucune permission pouvait énumérer l'inventaire complet en incrémentant des nombres, sans voir un seul matériel à l'écran

### Webhooks

- **Les webhooks partent enfin.** Le CRUD, le bouton de test et la journalisation existaient depuis toujours, mais `POST /webhooks/trigger` n'était appelé par aucune route ni tâche planifiée : un administrateur configurait une URL, la testait avec succès, et plus jamais rien ne partait. L'écran proposait pourtant douze événements
  - Les douze sont branchés : création, modification et suppression de matériel et de catégorie, alerte, entretien, plein de carburant, sauvegarde, création d'utilisateur et connexion
  - Les alertes passent par `emitAlert`, déjà le signal commun : elles naissent à cinq endroits, et brancher chaque `INSERT` aurait été le meilleur moyen d'en oublier un
  - La livraison, jusqu'ici écrite dans le corps de la route, vit dans `webhook.service.ts` — c'est précisément ce qui la rendait inaccessible au reste du code
- **Délai maximal réel.** `fetch(url, { timeout: 10000 })` n'existe pas : l'option était ignorée, et une URL qui accepte la connexion sans jamais répondre bloquait indéfiniment. Un `AbortSignal.timeout` abandonne au bout de dix secondes et enregistre l'échec
- **Envoi sans attente.** Un agent qui enregistre un plein n'attend pas qu'un service externe réponde, et une URL cassée ne fait pas échouer sa saisie. Vérifié : avec un destinataire muet, la création rend la main en 8 ms et l'échec est noté dix secondes plus tard
- **Un destinataire injoignable n'empêche pas les autres de recevoir** : le try/catch est à l'intérieur de la boucle

### Authentification

- **Les quatre écrans SSO disent ce qu'ils font.** SAML, OIDC, LDAP et Passkey enregistrent leur configuration dans `auth_config`, qu'aucun fichier de `src/` n'interroge en dehors de sa propre route : la connexion reste en bcrypt local. Un bandeau l'indique désormais sur chacun. Un écran qui *simule* un SSO est plus dangereux qu'une absence de SSO — il fait croire à un administrateur que l'authentification est déléguée à son annuaire, et le dissuade de chercher une autre protection. La décision de finir ou de retirer ces écrans reste ouverte

### Manifestations

- **Historique horodaté.** La table `manifestation_history` était créée depuis le début et n'était ni écrite ni lue, alors que le README et la feuille de route annonçaient une « timeline complète de toutes les actions ». Un prêt de matériel pour un événement municipal engage la collectivité : savoir qui a validé, qui a livré et à quelle date n'est pas un confort
  - Création, modification, validation, livraison, récupération, annulation, archivage et mise à jour des quantités sont consignés, avec l'auteur, la date et un commentaire facultatif
  - Le changement de statut accepte un commentaire — « validée en commission du 12 septembre » vaut mieux qu'une date seule
  - La timeline s'affiche dans le détail d'une manifestation, et `GET /:id/history` la sert seule
  - L'écriture de l'historique ne peut pas faire échouer l'action qu'elle décrit : perdre une ligne d'historique est moins grave que perdre une livraison
- **Fiche PDF branchée.** `ManifestationPDFExport.tsx` existait sans être importé nulle part, et il lisait des champs qui n'existent pas : `name` au lieu de `title`, `items` au lieu de `materials`, `object_name` au lieu de `stock_name`, `res.data` au lieu de `res.data.data`, et des statuts en français là où le serveur stocke `draft`, `validated`, `delivered`… Chaque champ serait ressorti vide, et la génération se serait arrêtée sur `detail.name.replace`. La fiche contient désormais les informations générales, le matériel avec ses totaux et l'historique
- **`PUT /:id/materials` refuse une mise à jour qui ne touche aucune ligne** au lieu de répondre 200 : c'était le cas quand un identifiant de stock était envoyé à la place de l'identifiant de ligne

### Manifestations — réception des demandes et stock réel

> Les demandes de manifestation arrivaient par une application de formulaires externe et étaient **ressaisies à la main**. Une chaise cassée pendant un prêt ne diminuait rien : le stock affiché restait celui de l'achat et s'éloignait un peu plus du réel à chaque manifestation.

#### Ajouté

- **Réception signée des demandes** (`POST /api/manifestations/intake/:slug`). Une application tierce dépose sa demande ; elle arrive au statut « À confirmer » et réserve le matériel au prévisionnel sans rien engager de réel
  - Signature HMAC-SHA256 sur les **octets exacts** du corps, même convention que les webhooks émis. `express.json()` ne conservait aucun corps brut : un `verify` le retient, uniquement pour ce chemin, pour ne pas garder 10 Mo en mémoire à chaque requête de l'application
  - Comparaison par `timingSafeEqual` : comparer deux signatures avec `===` laisse fuir, par le temps de réponse, le nombre de caractères devinés
  - **Idempotence** sur l'identifiant d'origine : un formulaire qui réessaie après un délai réseau ne crée pas deux manifestations et ne réserve pas deux fois le matériel
  - **Journal de toutes les réceptions**, refus compris. Sans journal, une demande perdue est indiscernable d'une demande jamais envoyée — et le problème se découvre le jour de la manifestation
- **Correspondance configurable, pas codée en dur.** Chaque formulaire nomme ses champs à sa façon et changera sans prévenir : l'écran Réglages › Réception manifestations dit quel chemin JSON alimente quel champ. Les chemins proposés sont ceux **réellement présents dans la dernière demande reçue**, et non un champ de saisie libre où une faute de frappe reste invisible jusqu'à la prochaine demande perdue
  - Reconnaissance automatique par le nom des clés, accents, casse et ponctuation ignorés — la règle de `importMapping.service.ts`, désormais partagée dans `utils/normaliserLibelle`
  - Dates acceptées en `14/07/2026` comme en `2026-07-14T09:00:00Z`. Une date non reconnue est laissée vide plutôt que devinée : une manifestation placée au mauvais jour bloquerait le mauvais matériel
  - Matériel lu sous quatre formes : liste d'objets, objet clé/valeur, cases cochées sans quantité, ou saisie libre « 10 tables »
- **Alias d'articles.** Le formulaire dit « tables », le stock dit « Table 180 cm ». Sans alias, chaque demande laisserait la ligne à rattacher à la main, demande après demande. Un alias déjà porté par un autre article est refusé : l'appariement resterait arbitraire
- **Matériel non rattaché conservé et signalé** sur la manifestation. Le jeter reviendrait à recevoir une demande amputée sans que personne le sache
- **Statut « À confirmer »** (`pending`), avec ses transitions : confirmer, reprendre en brouillon, refuser
- **Date de récupération.** Sans elle, la fenêtre d'immobilisation n'avait pas de fin exploitable : une manifestation d'un jour libérait son matériel le matin même. Le matériel est désormais bloqué de la livraison à la reprise
- **Quantités réellement perdues**, avec motif. Une casse ou un vol diminue le stock physique et laisse un **mouvement de stock** tracé, pour qu'un total puisse toujours s'expliquer — et se corriger si la saisie était fausse. L'écart seul est appliqué : réenregistrer la même casse ne retire pas une deuxième chaise
- **La quantité demandée est modifiable à la livraison** : « ils n'avaient besoin que de 8 tables sur 10 » se saisit tel quel
- **Cinq événements de webhook** : `manifestation.received`, `.created`, `.updated`, `.status_changed`, `.materials_updated`

#### Modifié

- **Prévisionnel et réel séparés une fois pour toutes** (`manifestationStock.service.ts`). Les deux notions étaient mélangées et réécrites à la main dans chaque route : `GET /stock` soustrayait le matériel dehors mais pas les réservations à venir, `/stock/availability` faisait l'inverse, et aucune des deux ne savait répondre sur une période — alors que c'est exactement la question qu'on se pose en recevant une demande pour le mois prochain
  - Une manifestation ne compte que dans un seul des deux comptes selon son statut. Sans cette séparation, une manifestation livrée serait comptée deux fois : une fois pour ce qu'elle avait demandé, une fois pour ce qu'elle a emporté
  - `date_from` / `date_to` sur `/stock` et `/stock/availability`
  - Le manque est rendu comme un **avertissement, jamais comme un refus** : une commune substitue du matériel, décale une livraison ou emprunte ailleurs. Bloquer la saisie l'obligerait à mentir sur ce qu'elle a demandé pour pouvoir enregistrer
  - `date('now')`, propre à SQLite, remplacé par une date passée en paramètre

#### Corrigé

- **Le module Manifestations était lisible par tout compte authentifié.** `GET /manifestations`, `GET /:id`, `/stock` et `/stock/availability` n'appliquaient aucun filtre : seules les écritures étaient gardées. `objectScope.ts` avait fermé la même fuite sur la table `objects`, mais sa règle ne dit rien de `manifestation_stock`, qui porte pourtant ses propres catégories — et le test de non-régression ne pouvait pas le voir, il ne cherche que la chaîne `objects`. Règle écrite une seule fois dans `manifestationScope.ts`
  - Un article rattaché **uniquement par sa sous-catégorie** — un vidéoprojecteur du service informatique — restait visible de tous : la condition « article sans catégorie » avalait ce cas
  - Une manifestation sans matériel reste visible : ce sont justement celles qu'on vient de recevoir et qu'il faut traiter
- **`POST /intake/sources` était capté par la route de dépôt** `POST /:slug`, qui accepte n'importe quel segment : créer une source échouait en « source de réception inconnue ». Le dépôt est déclaré en dernier, après toutes les routes nommées, et les identifiants réservés sont refusés à la création
- **La modification d'une manifestation effaçait les pertes déjà constatées** : les lignes de matériel sont supprimées puis réinsérées, et le formulaire ne renvoie pas les pertes. Le stock, lui, en gardait la marque
- **Le commentaire de transition était jeté par le client** : le serveur l'accepte et le consigne depuis toujours, `updateStatus` ne le transmettait pas — aucune validation ni annulation ne pouvait être motivée
- **Les regex de `tests/webhooks.test.ts` ignoraient tout événement comportant un tiret bas.** La parité entre l'écran et le service qu'elles vérifient serait devenue muette précisément sur les événements qu'on venait d'ajouter

### Manifestations — services concernés, approbations et suivi partagé

> Une manifestation municipale engage plusieurs services : le festif prête les tables, l'informatique le vidéoprojecteur, la restauration les boissons. Aucun modèle ne permettait de dire « ce service est concerné » — `group_permissions.role` désigne un rôle, pas un groupe de personnes, et il n'existait ni entité de service, ni destinataire collectif, ni approbation. Le choix se réduisait donc à « tout le monde reçoit tout » ou « personne ne reçoit rien ».

#### Ajouté

- **Services.** Un service est un groupe de personnes **et** un périmètre de catégories de matériel. C'est ce périmètre qui décide de tout : un service n'est sollicité, alerté et destinataire que si la manifestation demande du matériel de ses catégories. Le service informatique ne reçoit rien d'une brocante sans matériel informatique, la restauration rien d'une réunion sans repas — c'est exactement ce qui fait qu'on cesse de lire ses alertes et qu'on rate celle qui comptait
  - Boîte partagée facultative : elle survit aux départs, contrairement à l'adresse d'un agent. Les membres reçoivent dans tous les cas
  - Services **observateurs** — direction générale, maire, élus — sans périmètre : ils suivent tout, sans rien approuver
  - Un service qui a rendu des décisions est **désactivé, jamais supprimé** : l'effacer réécrirait la traçabilité d'une manifestation
- **Approbations par service concerné.** Créées automatiquement à la création d'une manifestation et à chaque modification du matériel. Chaque service porte ses propres dates de livraison et de récupération : l'informatique installe le vidéoprojecteur le matin, le festif livre les tables la veille
  - Une manifestation ne peut pas être validée tant qu'un service concerné n'a pas répondu — réglable par `manifestation_require_all_approvals`. La valider avant reviendrait à promettre à sa place, et c'est le jour de la livraison qu'on découvrirait que le vidéoprojecteur n'était pas disponible
  - Un service ne peut décider **que pour lui-même** ; l'administrateur peut toujours trancher, c'est lui qui débloque quand un service ne répond pas
  - Sollicitation manuelle possible vers un service ou une personne, en **approbation** (bloquante) ou en **information** (non bloquante) : un avis laissé sans réponse ne doit pas retenir une manifestation
- **Conversation par manifestation.** Les services s'y répondent — changement de date, matériel à ajouter ou à retirer. Chaque message est aussi consigné dans l'historique, pour que la chronologie reste l'unique source du suivi, et se retrouve dans l'archive
- **Mise en copie.** Un DGS, un maire, un élu suivent l'intégralité des échanges sans rien avoir à approuver
- **Rôle « service partenaire ».** Ce n'est pas un cran de plus sur l'échelle des pouvoirs mais un accès *latéral* : il écrit dans les manifestations qui le concernent et ne voit rien du parc, des entretiens ni de la configuration
  - Cloisonnement **fermé par défaut** : tout `/api/*` lui est refusé sauf une liste blanche explicite. Une route ajoutée demain sera inaccessible tant que quelqu'un n'en aura pas décidé autrement — l'inverse d'une liste noire, qu'on oublie de compléter
  - Appliqué au point unique où le rôle devient connu, la fin de `authenticateToken` — y compris pour les jetons API, sans quoi un token créé par un compte cloisonné contournerait tout
  - La navigation se réduit à Manifestations : afficher les autres entrées promettrait des pages qui répondent 403
- **Déclencheurs réglables par service** : sollicitation, statut et dates, matériel, messages. Un service coupe ce qui ne l'intéresse pas sans perdre les demandes qui le concernent
- **Deux rappels planifiés** (7h30) : livraison à J-3 (réglable) et récupération en retard. Aucun des deux n'existait — une manifestation validée n'avertissait personne avant le jour J, et un matériel jamais récupéré restait compté comme sorti indéfiniment, donc indisponible pour les autres, sans que quiconque sache pourquoi
- **Huit gabarits de courriel** semés : demande d'approbation, demande d'information, décision, message, changement de dates, changement de matériel, rappel de livraison, récupération en retard
- **Trois événements de webhook** : `manifestation.approval_requested`, `.approval_decided`, `.dates_changed`

#### Corrigé

- **La validation n'était pas réellement bloquée.** Les approbations étaient créées *après* la transition, si bien que le contrôle ne trouvait rien à attendre et laissait passer — puis les créait, trop tard. Trouvé à l'essai sur l'application, pas au typecheck. Elles sont désormais créées à la création de la manifestation, et rafraîchies avant le contrôle
- **Un compte « service » ne doit pas être filtré par catégorie de matériel** : il suit les manifestations où il est sollicité, observateur ou en copie. Lui appliquer la portée par catégorie lui aurait montré des manifestations qui ne le concernent pas tout en lui cachant les siennes

### Manifestations — export configurable et dépôt sur Nextcloud

> Le suivi des manifestations se partage par fichier : une feuille de calcul déposée sur un Nextcloud, que plusieurs services consultent et annotent. Elle était tenue à la main, donc périmée dès qu'un statut changeait — et c'est ce fichier périmé que tout le monde continuait de lire. Rien dans l'application n'écrivait vers un stockage distant : `upload.service` range sur le disque local, les sauvegardes restent dans `./backups`.

#### Ajouté

- **Export des manifestations en feuille de calcul**, 24 colonnes disponibles : identité et dates, contact et lieu, quantités demandées / livrées / récupérées / perdues, détail du matériel, état de chaque approbation et services encore attendus
  - **Profils de colonnes** : quelles colonnes, dans quel ordre, sous quel intitulé. C'est une donnée, pas du code — chaque collectivité range son tableau à sa façon, et redemander un développeur à chaque changement de colonne serait absurde. Même choix que pour l'import
  - Un profil qui référence un champ disparu perd cette colonne au lieu de faire échouer l'export entier
  - Ligne d'entête figée et filtre automatique : un tableau de suivi se lit en faisant défiler, et sans le gel on perd les intitulés dès la vingtième ligne
  - Le détail du matériel et les approbations tiennent dans une cellule à retours à la ligne plutôt qu'en lignes multiples : le fichier sert à filtrer et à trier, ce qu'un tableau à lignes fusionnées rend impraticable
  - Les archivées sont exclues par défaut ; l'archive se demande explicitement
- **Dépôt WebDAV sur Nextcloud** (`webdav.service.ts`), sens unique : l'application reste la source de vérité, le fichier déposé sert à consulter et à annoter à côté. Une synchronisation bidirectionnelle demanderait des verrous et une détection de conflits, et permettrait surtout à deux personnes de contredire la base
  - Les dossiers manquants sont créés un niveau à la fois — WebDAV ne crée pas les parents
  - Mot de passe d'application, jamais le mot de passe du compte : il se révoque sans changer les identifiants de la personne. Il n'est jamais renvoyé par l'API une fois enregistré
  - **La vérification dépose réellement un fichier témoin** puis le retire. Se contenter de valider la forme des champs laisserait un administrateur croire que tout est branché — c'est précisément le défaut des écrans SSO de ce projet, qui « testent » sans rien prouver
  - Délai maximal réel (`AbortSignal.timeout`) et échec isolé, comme pour les webhooks : un Nextcloud injoignable ne doit pas empêcher de valider une manifestation
  - `last_status` et `last_error` sur chaque profil : sans eux, un dépôt qui échoue est invisible, et c'est le fichier périmé que tout le monde continue de lire
- **Redépôt automatique** après chaque changement de statut ou de quantités, **regroupé sur une minute** — saisir les quantités livrées article par article produirait sinon dix envois pour un seul résultat — plus un passage nocturne à 3h qui rattrape ce qu'un serveur injoignable aurait fait manquer
- **Écran Réglages › Export manifestations** : configuration Nextcloud, profils, réordonnancement et renommage des colonnes, téléchargement direct et dépôt manuel

#### Corrigé

- **`fetch` échoue avec un laconique « fetch failed »** et range la vraie cause dans `error.cause` : un administrateur qui lit cela ne sait pas s'il s'est trompé d'adresse, si le serveur est éteint ou si le certificat est refusé, et n'a aucune piste pour corriger. Les erreurs réseau sont désormais traduites — connexion refusée, domaine introuvable, certificat expiré ou auto-signé
- **Un mot de passe erroné se manifestait en « Création du dossier refusée (HTTP 401) »**, puisque le premier appel au serveur est un `MKCOL`. Le refus dit maintenant ce qu'il faut vérifier

### Manifestations — matériel unique, et notifications réglables par chacun

> Une manifestation ne savait demander que des **quantités** : « 50 tables ». Un véhicule n'est pas une quantité — c'est un exemplaire identifié, qui ne peut pas être à deux endroits le même jour, et dont l'histoire (entretiens, pleins, contrôles) est déjà tenue dans le parc. Par ailleurs, les réglages de notification n'existaient qu'au niveau du service : un agent noyé sous les messages ne pouvait rien y faire sans couper aussi ses collègues.

#### Ajouté

- **Matériel unique du parc rattaché aux manifestations.** Une demande porte désormais deux natures de matériel : des quantités — 50 tables d'un même modèle, qu'il serait absurde de saisir une par une — et des exemplaires identifiés, choisis dans le parc où ils vivent déjà. Le véhicule garde son numéro de série, ses entretiens et ses pleins au même endroit ; le recopier dans le stock des manifestations aurait créé deux vérités
  - La table `manifestation_items`, créée à l'origine du projet et **jamais ni lue ni écrite**, est enfin en service. Le README annonçait une « recherche d'objets du parc pour ajout aux manifestations » et l'API une route `GET /api/manifestations/search/objects` : ni l'une ni l'autre n'existaient
  - **Un conflit est ici toujours réel** : deux manifestations peuvent se partager cent chaises sur cinquante chacune, elles ne peuvent pas se partager le camion. Le conflit est signalé avec *qui* retient le matériel et *sur quelles dates*
  - Les **réservations** sont lues au passage : les deux circuits engagent le même parc sans se connaître, et se seraient promis le même véhicule chacun de son côté
  - Le sélecteur montre les matériels déjà pris **sans les masquer** : savoir que le camion est sur la brocante permet de demander un décalage, ce qu'une liste amputée ne permettrait pas
  - Suivi propre à l'unique : sorti / revenu / état constaté au retour — intact, abîmé, perdu — plutôt que des quantités, puisque « 0,5 camion livré » n'a aucun sens
  - La portée par catégorie est appliquée **dans le service**, pas laissée à l'appelant : une recherche libre sur tout le parc est exactement la fuite fermée sur `GET /green-spaces/search/objects`
- **Réglages de notification à trois niveaux**, du plus général au plus précis :
  1. **le défaut de la collectivité** (Réglages › Notifications) — pour chacun des huit événements, quels rôles sont destinataires et si les services concernés le reçoivent ;
  2. **le réglage de chaque service**, déjà en place ;
  3. **le choix de chaque compte** (Mon profil), qui l'emporte sur tout
  - Une seule exception, et elle est nécessaire : **ce qui engage son destinataire part toujours**. Une approbation qu'on attend de vous bloque la manifestation tant que vous n'avez pas répondu ; vous laisser la couper, c'est vous laisser bloquer une manifestation sans jamais le savoir. L'écran le dit et la case est verrouillée, plutôt que d'afficher un réglage qui ne ferait rien
  - Le catalogue des événements est **servi par l'API** au lieu d'être recopié dans l'interface : une liste tenue des deux côtés finirait par diverger, et un événement à moitié déclaré serait proposé sans jamais partir
  - Un événement absent du réglage enregistré prend ses valeurs du catalogue : ajouter un événement au code ne doit ni obliger à rouvrir l'écran, ni le laisser muet sans que personne le remarque
  - Une boîte partagée de service n'a pas de compte, donc pas de préférence : elle suit le seul réglage du service, ce qui la rend insensible aux départs

#### Corrigé

- **`objectScope.test.ts` a rattrapé une fuite pendant l'écriture** : le nouveau service lisait `objects` sans porter la règle de portée. Plutôt que de l'exempter, la règle a été déplacée à l'intérieur — un appelant ne peut plus l'oublier

### Import / Export

- **Filtres d'export exposés** : catégorie, sous-catégorie et statut. Le serveur les acceptait depuis toujours, aucun écran ne les proposait, donc l'export sortait forcément le parc entier
- **Nombre de matériels annoncé** avant le téléchargement, et bouton inactif quand aucun ne correspond : sans ce décompte, on récupère un classeur vide sans comprendre pourquoi
- **Export cloisonné par les permissions de catégorie**, comme la liste des matériels. La route n'avait que `authenticateToken` et construisait sa requête sur `WHERE 1=1` : un compte dont l'écran ne montre aucune catégorie récupérait l'inventaire complet — nom, référence, numéro de série, localisation et prix d'achat de chaque matériel
- **Correspondance des colonnes à l'import.** L'import était positionnel strict sur onze colonnes : le fichier devait suivre le modèle au caractère près
  - Les colonnes sont reconnues par leur intitulé — accents, astérisques et parenthèses ignorés — quel que soit leur ordre. « Désignation », « Libellé » ou « Matériel » valent « Nom » ; « Famille » vaut « Catégorie »
  - Une colonne inconnue est écartée au lieu de tout décaler
  - **L'export de l'application est enfin réimportable.** Il commence par une colonne `ID` absente du modèle : elle décalait tout d'un cran et chaque ligne échouait sur « Catégorie introuvable ». Exporter, corriger dans un tableur, réimporter — le geste d'un inventaire annuel — était impossible
  - La reconnaissance est affichée avant l'import, avec le nombre de lignes et la première ligne telle qu'elle sera lue ; chaque colonne reste corrigeable
  - Un fichier sans ligne d'en-tête est toujours lu dans l'ordre du modèle
  - Une colonne obligatoire non reconnue est refusée avec la liste des intitulés trouvés, au lieu d'un échec ligne par ligne
- **Insertions réellement attendues.** `db.execute` était lancé dans `eachRow`, qui est synchrone : les promesses n'étaient pas attendues, le `try/catch` ne rattrapait aucune erreur d'insertion, le compteur annonçait des lignes qui n'existaient pas et la réponse partait avant la fin du travail

- **Double en-tête CSV corrigé** : le second classeur recevait `columns`, qui pose déjà une ligne d'en-tête, puis recopiait aussi la ligne 1 de la source. Chaque CSV exporté commençait par deux en-têtes identiques, ce qui décale toute relecture et fait échouer un réimport

### Réservations

- **Disponibilité affichée pendant la saisie.** `GET /reservations/availability/:objectId` existait depuis toujours et n'était appelé par aucun écran : un créneau déjà pris n'apparaissait qu'en erreur 409, après avoir rempli et envoyé le formulaire. L'agent découvrait le conflit une fois son travail perdu, sans savoir quand le matériel serait libre
  - Les créneaux occupés sont listés avec leur période et leur emprunteur
  - Le bouton de création reste inactif tant que la période demandée est prise
  - Les demandes en attente de validation sont signalées sans bloquer : elles n'empêchent pas la création, mais deux agents qui demandent le même créneau sans le savoir aboutissent à une demande validée et une autre qui reste en attente
- **Filtre de chevauchement partagé** entre la vérification et la création. Ils étaient écrits séparément ; s'ils avaient divergé, l'écran aurait annoncé « disponible » puis le serveur aurait refusé — pire que de ne rien annoncer. Un test vérifie que le filtre n'est écrit qu'à un seul endroit
- **Nom de l'emprunteur chargé en une requête** pour l'ensemble des créneaux, et non une par ligne

### Sécurité

- **Politique de mot de passe appliquée.** L'écran Paramètres > Authentification permettait de régler la longueur minimale, la complexité, l'expiration et le blocage après N tentatives. Rien n'était appliqué : la configuration était écrite dans `auth_config` et relue par personne, et un administrateur qui réglait « blocage après 5 tentatives » croyait disposer d'un contrôle qui n'existait pas
  - Longueur et complexité vérifiées aux **six** endroits où un mot de passe est défini : inscription, réinitialisation, changement, création par un administrateur, changement de son propre mot de passe, réattribution par un administrateur
  - Les quatre contrôles de longueur codés en dur ont été retirés — un minimum réglé à 10 aurait laissé passer 8, et un minimum réglé à 6 aurait été refusé avec un message contredisant l'écran
  - Tous les manquements sont rendus d'un coup plutôt qu'un par un : redemander trois fois de suite pousse à écrire le mot de passe sur un papier
  - Une configuration illisible retombe sur les valeurs par défaut, jamais sur « aucune exigence »
- **Blocage du compte après N échecs**, pendant la durée configurée, réponse `423`. Ce contrôle protège un compte précis, là où le rate limiting protège l'API dans son ensemble. Le nombre d'essais restants n'est pas révélé, car il indiquerait qu'un email existe. Un administrateur débloque en réattribuant un mot de passe, et une réinitialisation réussie débloque aussi
- **Expiration du mot de passe signalée**, par un bandeau invitant à le changer. Elle ne bloque pas : refuser l'accès à un agent au fond d'un parc parce que son mot de passe a 91 jours l'empêcherait de travailler sans rien protéger de plus. Un compte sans date de changement connue — tous ceux créés avant la migration — n'est jamais déclaré expiré
- **Trois réglages retirés du formulaire**, remplacés par un encart qui explique pourquoi plutôt que par des interrupteurs sans effet : la 2FA (aucun second facteur n'existe), le timeout de session (demanderait un suivi d'inactivité), et la connexion locale (la désactiver rendrait l'application inaccessible tant qu'aucun SSO ne fonctionne)

### Ajouté

- **Migration `002_politique_connexion`** : colonnes `failed_login_attempts`, `locked_until` et `password_changed_at` sur `users`. Première utilisation réelle du système de migration
- **`passwordPolicy.service.ts`** : lecture de la politique avec cache court, invalidé dès qu'un administrateur enregistre — sans quoi il verrait son nouveau seuil ignoré pendant trente secondes
- **21 tests** figeant les exigences, la lecture d'une configuration corrompue et l'expiration

### Corrigé

- **Réponses de validation sans message** : six routes renvoyaient `{ success: false, errors: [...] }` sans champ `message`, et le client affichait une erreur vide

### Structure et fiabilité

#### Ajouté

- **Système de migration versionné** : `npm run db:migrate` pointait vers `src/database/migrate.ts`, un fichier qui n'existait pas — la commande échouait depuis toujours. Journal `schema_migrations`, sauvegarde SQLite préalable par `VACUUM INTO`, application au démarrage du serveur (le conteneur ne lance que `node dist/server.js`), et `--dry-run` qui n'écrit rien
- **25 index de base de données** sur 54 tables qui n'en comptaient aucun
- **Découpage du bundle** : 33 des 37 pages en chargement différé. L'écran de connexion téléchargeait leaflet, fullcalendar, recharts, jspdf et html2canvas
- **Validation serveur des écritures de terrain** : une charge incomplète produisait un 500 « Erreur serveur », la contrainte `NOT NULL` de SQLite remontant jusqu'au gestionnaire générique. Réponses 400 avec un message en français
- **Chargement groupé** (`utils/batchQuery.ts`) remplaçant les requêtes N+1
- **131 tests** contre 36 : matrice rôle × endpoint, validation des saisies, portée des tokens API, migrations, chargement groupé, noms de colonnes, magasin d'authentification, file hors ligne

#### Modifié

- **L'image Docker vérifie les types** : le serveur était compilé par esbuild, qui retire les types sans les vérifier — la production était le seul endroit où le code n'était jamais type-checké. Serveur compilé par `tsc`, client par `build:check`
- **Erreurs de type du client : 76 → 0**
- **Configuration ESLint ajoutée** : le script `lint` existait et les plugins étaient installés, mais aucun fichier de configuration — la commande échouait immédiatement, donc personne ne lintait
- **better-sqlite3** monté en v12, `engines.node` porté à `>= 20`
- **Cache API de la PWA** porté de 5 minutes à 24 heures, pour qu'une fiche consultée le matin s'ouvre l'après-midi en zone blanche
- **`.env.example`** : port corrigé de 3000 à 3001, qui est le port réellement utilisé partout ailleurs

#### Performance

- **Requêtes N+1 supprimées** sur la fiche d'espace vert et les manifestations. Sur un espace de 60 entretiens, la seule partie « entretiens » émettait 120 requêtes ; mesuré à 120 requêtes / 1,25 ms contre 2 requêtes / 0,16 ms après regroupement, avec vérification que les deux motifs rendent les mêmes lignes

### Sécurité

- **Portée des tokens API appliquée** : les permissions d'un token étaient analysées puis rangées dans la requête, et plus aucune ligne ne les lisait — 0 référence dans les 25 fichiers de routes. Un token créé « lecture seule » par un administrateur pouvait supprimer tout ce que son créateur pouvait supprimer, puisqu'il hérite de son rôle
- **`JWT_SECRET` obligatoire** : le repli vers un secret codé en dur a été supprimé. Le serveur refuse de démarrer en production si le secret est absent, trop court ou laissé à sa valeur d'exemple
- **SQL des plugins verrouillé** : `pluginAdvanced.service.ts` exécutait du SQL stocké en base, atteignable avec un simple `authenticateToken`
- **`/plugins` placé derrière authentification**
- **Cascade de déconnexion** : `logout()` envoyait la requête puis effaçait l'état, donc elle partait sans en-tête d'autorisation et prenait un 401 ; ce 401 relançait `logout()`, qui rappelait `/auth/logout` — une dizaine de requêtes jusqu'au 429. Comme le limiteur couvre tout `/api/auth` à 10 requêtes par quart d'heure, se déconnecter — ou simplement se tromper de mot de passe — interdisait de se reconnecter pendant 15 minutes
- **Déconnexion enfin journalisée** : elle prenait un 401 systématique, donc rien n'était enregistré et le cookie d'authentification n'était jamais effacé. Le journal d'audit ne contenait que des connexions

### Corrigé (divers)

- **Changer sa photo de profil déconnectait l'utilisateur** : la page profil lisait `useAuthStore.getState().accessToken`, un champ qui n'existe pas — le vrai s'appelle `token` — et le passait à `setAuth` avec un `!` pour forcer le type. Le magasin se retrouvait avec `token: undefined` et la requête suivante partait sans autorisation
- **Synchronisation Outlook et CalDAV inutilisable** : les 18 requêtes de configuration interrogeaient `key` et `value` alors que la table `settings` a pour colonnes `setting_key` et `setting_value`. SQLite répondait « no such column », la route renvoyait un 500 générique, et aucune configuration ne pouvait être enregistrée
- **Journal muet sur 13 actions** : la catégorie `'other'` est déclarée dans le type et proposée dans l'écran des journaux sous le nom « Autre », mais manquait dans les catégories activées par défaut. Création et suppression d'espace vert, cycle de vie des manifestations, import/export et réservations n'écrivaient rien, et le filtre « Autre » ne montrait jamais rien
- **Changement de configuration d'authentification non tracé** : l'appel au journal passait `action` et omettait `level` ; `log()` filtre sur les niveaux activés, `includes(undefined)` est faux, et l'entrée était jetée
- **Liens des emails vers un port fermé** : le réglage `site_url` était semé sur `http://localhost:3000` alors que le serveur écoute sur 3001. La valeur initiale suit désormais `SITE_URL` puis `PORT`
- **`Badge`** ne transmettait pas la prop `title` que ses appelants lui passaient : l'infobulle explicative des champs personnalisés n'existait pas
- **Onglet « Espaces verts » du module Suivi** absent du type de `activeTab`
- **Code mort livré en production** : `ObjectDetailPage-FREDERICDEBONNE.tsx` (1 435 lignes), `object.routes-FREDERICDEBONNE.ts` (811 lignes) et `index-FREDERICDEBONNE.ts` (552 lignes), non référencés mais compilés
- **Artefacts Playwright** sortis du suivi Git

### Supprimé

- Affichage de la description des sous-catégories, lu à deux endroits alors qu'il n'existe ni colonne en base, ni champ de route, ni champ de formulaire : il ne pouvait jamais rien rendre
- `DOC_TYPES`, `updateDocMutation` et `getRoleIcon` : intentions jamais branchées à aucun contrôle

---

### Ajouté
- **Module Espaces Verts — Plugin système complet** : Gestion des espaces verts municipaux avec plan interactif annoté, composition botanique, entretiens et documents :
  - **Tables base de données** : `green_spaces` (informations générales, type, superficie, localisation, plan), `green_space_elements` (éléments du plan : arbres, massifs, mobilier...), `green_space_annotations` (annotations textuelles sur le plan), `green_space_seasons` (gestion saisonnière), `green_space_documents` (documents et fichiers), `green_space_element_groups` (groupes d'éléments), `green_space_maintenances` (entretiens programmés), `green_space_maintenance_elements` (éléments concernés), `green_space_maintenance_documents` (documents liés aux entretiens)
  - **Routes API complètes** (`/api/green-spaces`) : CRUD espaces, éléments, annotations, saisons, documents, groupes, entretiens, types personnalisés, statistiques
  - **Plan interactif** : Upload d'image du plan, placement de repères par clic avec drag & drop, popup persistant au clic affichant le détail de chaque élément (espèce, état, dimensions, photo)
  - **Éléments du plan** : 8 types (arbre, arbuste, massif floral, haie, pelouse, bassin, mobilier, autre) avec icônes dédiées, état de santé (excellent/bon/moyen/mauvais/critique/mort), gestion d'images par élément
  - **Groupes de composition** : Regroupement logique d'éléments (massif, zone, alignement, haie, autre) avec couleur et description
  - **Zones polygonales** : Dessin de zones par clics successifs sur le plan avec couleur, opacité et légende
  - **Légende interactive** : Légende du plan avec filtrage par type d'élément et groupe, codes couleur des états
  - **Entretiens** : Historique des interventions avec type, date, intervenant, durée, coût, éléments concernés, documents joints (upload direct)
  - **Export PDF du plan** (`PlanPDFExport.tsx`) : Export via jsPDF + html2canvas avec le plan annoté en paysage, légende, tableaux détaillés des éléments/groupes/annotations, options de sélection des sections
  - **Upload de documents** : Possibilité de joindre directement des fichiers (PDF, images, docs) lors de la création d'un entretien
  - **Intégration Alertes** : Les entretiens avec date d'échéance prochaine génèrent automatiquement des alertes dans le module Alertes (via `cron.service.ts` + `plugin_reference: 'green-space-maintenance'`)
  - **Intégration Calendrier** : Les entretiens avec `next_maintenance_date` créent automatiquement un événement dans le calendrier (🌿 icône verte, type maintenance)
  - **Intégration Suivi (Tracking)** : Les coûts et données d'entretien des espaces verts apparaissent dans le module Suivi avec filtre dédié "Espaces verts" (icône TreePine), carte statistique et tableau détaillé
  - **Suppression avec nettoyage** : La suppression d'un entretien nettoie aussi les événements calendrier et alertes associés
  - **Clonage d'espace** (`CloneSpaceModal`) : Copie vierge ou avec éléments sélectionnés, statut initial configurable (projet → travaux → actif), snapshot automatique de l'espace source créé avant le clonage, copie des annotations et groupes liés aux éléments copiés
  - **Archives & Snapshots** (`ArchivesTab`) : Nouvel onglet "Archives" avec capture de l'état complet (plan, éléments, annotations, groupes) à un instant T sous forme de snapshot JSON, liste chronologique des snapshots avec label/date/notes, vue détaillée du plan archivé avec superposition des annotations
  - **Comparaison de versions** : Mode côte-à-côte entre un snapshot archivé et l'état actuel — affichage simultané des plans annotés avec résumé des différences (nombre d'éléments, annotations, groupes ajoutés/supprimés)
  - **Historique de l'espace source** : Si l'espace est un clone, accès aux documents et entretiens de l'espace vert original (via `cloned_from_id` FK)
  - **Table `green_space_snapshots`** : id, green_space_id (FK), label, snapshot_date, plan_image, elements_data (JSON), annotations_data (JSON), groups_data (JSON), notes, created_at
  - **Colonne `cloned_from_id`** : Ajout d'une FK auto-référentielle sur `green_spaces` pour tracer la filiation des clones
  - **7 nouvelles routes API** : POST/GET `/:id/snapshots`, GET/DELETE `/snapshots/:snapshotId`, POST `/:id/clone`, GET `/:id/archives`
  - **Liaison documents-éléments** : Table de jonction `green_space_document_elements`, association de documents à des éléments spécifiques, affichage croisé dans DocumentsTab et ElementFormModal
  - **Options d'espace** (`SpaceSettingsModal`) : Modale de gestion des types et statuts d'espaces verts (ajout, modification, activation/désactivation) depuis la barre d'outils
  - **Gestion des types de groupes** (`GroupTypesSettingsModal`) : Modale CRUD pour les types de groupes de composition (massif, haie, bosquet, rocaille, jardinière, plate-bande, mixed border, autre) — ajout, modification (icône/label/couleur), activation/désactivation, suppression — bouton ⚙️ à côté de « Nouveau groupe »
  - **Table `green_space_group_types`** : Nouvelle table pour stocker les types de groupes avec icône, couleur, label, état d'activation et 8 types par défaut
  - **Remplacement d'éléments avec historique** (`ReplaceElementModal`) : Archivage automatique de l'état complet de l'élément (label, espèce, type, état, quantité, prix, date plantation, image, champs personnalisés) avant remplacement — contexte saisonnier (printemps/été/automne/hiver/annuel), année, raison et notes
  - **Historique des remplacements** (`ElementHistoryModal`) : Timeline visuelle avec état actuel (encart vert) et chronologie des versions précédentes — saison/année, données archivées, raison du remplacement
  - **Table `green_space_element_replacements`** : Nouvelle table d'archivage avec toutes les données précédentes de l'élément, saison, année, raison et notes
  - **Routes API remplacement** : POST `/elements/:id/replace` (archive + mise à jour), GET `/elements/:id/history` (historique par élément), GET `/:id/replacement-history` (historique global par espace)
  - **Routes API types de groupes** : GET/POST/PUT/DELETE `/group-types` avec CRUD complet
- **Module Manifestations — Page dédiée complète** : Gestion des manifestations (prêts de matériel pour événements) avec page dédiée accessible depuis la navigation principale :
  - **3 tables base de données** : `manifestations` (informations générales, statut, contact, lieu), `manifestation_items` (articles liés avec quantités commandées/livrées/retournées), `manifestation_history` (historique horodaté de chaque action)
  - **Routes API complètes** (`/api/manifestations`) : CRUD, stats par statut, changement de statut avec validation des transitions, historique, recherche d'objets du parc
  - **Workflow en 5 étapes** : Brouillon → Validée → Livrée → Récupérée → Archivée (+ Refusée → retour Brouillon) avec transitions contrôlées côté serveur
  - **ManifestationsPage.tsx** (~700 lignes) : Cartes statistiques, onglets (Manifestations/Stock/Archives), recherche debounce, filtre par statut
  - **Cartes colorées par statut** : Bordure gauche colorée, fond teinté, badge, barre de progression du workflow
  - **Modales de changement de statut** : Validation/Refus avec commentaire, Livraison/Récupération avec gestion des quantités (individuel ou global)
  - **Modale de création/édition** : Formulaire avec recherche d'objets par autocomplete, ajout/suppression d'articles
  - **Modale de détail** : Tableau des articles (commandé/livré/récupéré), timeline historique horodatée
  - **Export PDF** (`ManifestationPDFExport.tsx`) : Rapport via jsPDF avec en-tête, articles, et historique
- **Page Authentification** : Nouveau menu « Authentification » dans Paramètres avec 5 onglets de configuration :
  - **Général** : Politique de connexion (connexion locale, inscription publique, 2FA obligatoire, timeout session, blocage après tentatives échouées) et politique de mot de passe (longueur min, complexité, expiration)
  - **LDAP / Active Directory** : Connexion à un annuaire LDAP avec mapping d'attributs (uid, mail, givenName, sn), mapping de groupes vers rôles (admin, superviseur), création automatique d'utilisateurs, STARTTLS
  - **SAML 2.0 SSO** : Authentification via fournisseur SAML (Azure AD, Google Workspace, Okta, Keycloak) avec certificat X.509, mapping d'attributs, algorithme de signature configurable
  - **OpenID Connect** : Authentification OIDC avec URL de découverte, scopes configurables, type de réponse (Authorization Code / Implicit), mapping des claims
  - **Passkey (WebAuthn / FIDO2)** : Authentification sans mot de passe via empreinte digitale, reconnaissance faciale ou clé USB — utilisable comme méthode principale ou second facteur (2FA)
- **Table `auth_config`** : Nouvelle table base de données pour stocker la configuration par fournisseur d'authentification (provider, is_active, config JSON)
- **Routes API `/api/settings/auth`** : GET (liste), GET/:provider, PUT/:provider (mise à jour avec préservation des secrets), POST/:provider/test (test de connexion)
- **Plugin Import/Export** : Import/Export converti en plugin système de type `menu` (`is_system: 1`, `is_active: 1`) — activable/désactivable depuis Paramètres > Plugins
- **Fichiers plugin JSON** : Ajout de `plugin.json` et `index.json` pour les 4 plugins système : Réservations (`plugins/pages/reservations/`), Amortissement (`plugins/pages/depreciation/`), Cartographie (`plugins/pages/map/`), Import/Export (`plugins/pages/import-export/`)
- **Documentation plugins système** : Section dédiée dans `docs/PLUGIN_STRUCTURE.md` décrivant l'architecture built-in vs personnalisé, la navigation dynamique et l'activation/désactivation

### Modifié
- **cron.service.ts** : Ajout de la vérification des entretiens espaces verts (`green_space_maintenances.next_maintenance_date`) — création d'alertes automatiques avec `plugin_reference: 'green-space-maintenance'`
- **espaceVert.routes.ts** : Création/mise à jour/suppression d'événements calendrier et d'alertes lors des opérations sur les entretiens
- **AlertsPage.tsx** : Ajout du champ `pluginReference` dans l'interface Alert, lien "Voir l'espace vert" pour les alertes d'espaces verts
- **TrackingPage.tsx** : Ajout du type de données "Espaces verts" (`green_space`) avec carte statistique, onglet dédié et tableau détaillé
- **tracking.routes.ts** : Ajout du type `green_space` dans les filtres de suivi, requête des `green_space_maintenances` avec coûts et résumé
- **database/index.ts** : Ajout des 9 tables espaces verts + table `green_space_document_elements` (liaison documents-éléments) + table `green_space_snapshots` (archives) + colonne `cloned_from_id` (FK auto-référentielle sur `green_spaces`) + table `green_space_group_types` (types de groupes) + table `green_space_element_replacements` (historique remplacements)
- **server.ts** : Route `/api/green-spaces` câblée
- **Layout.tsx** : Entrée de navigation « Espaces Verts » ajoutée avec icône TreePine
- **App.tsx** : Route frontend `/espaces-verts` ajoutée
- **database/index.ts** : Ajout des 3 tables `manifestations`, `manifestation_items`, `manifestation_history`
- **server.ts** : Route `/api/manifestations` câblée
- **Layout.tsx** : Icône `CalendarDays` ajoutée, entrée de navigation « Manifestations » ajoutée
- **App.tsx** : Route frontend `/manifestations` ajoutée
- **pages/index.ts** : Export `ManifestationsPage` ajouté
- **seed.ts** : Nouveau plugin `import-export` ajouté aux `DEFAULT_PLUGINS` avec config JSON (formats autorisés, taille max)
- **Layout.tsx** : Import/Export retiré du `baseNavigation` codé en dur — ajouté à `builtInPluginSlugs` (`['calendar', 'reservations', 'depreciation', 'map', 'import-export']`) — sa visibilité dans la sidebar dépend désormais de l'activation du plugin — icône `FileSpreadsheet` ajoutée au `iconMap`
- **ROADMAP_FONCTIONNALITES.md** : Import/Export marqué comme « Plugin système » au lieu de « Fait »
- **README.md** : Section Import/Export mise à jour pour refléter son statut de plugin système activable/désactivable
- **examples/plugins/README.md** : Ajout de la liste des 4 plugins système built-in avec explication de la différence entre plugins système et plugins personnalisés

## [1.3.1] - 2026-03-06

### Ajouté
- **PWA complète** : Génération des icônes PNG (`pwa-192x192.png`, `pwa-512x512.png`, `apple-touch-icon.png`, `favicon.ico`, `favicon.svg`) dans `client/public/` via script `scripts/generate-icons.js` (Sharp)
- **Meta tags PWA** dans `index.html` : `theme-color`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`, `apple-touch-icon`, `mask-icon`
- **Plugins système** : Réservations, Amortissement et Cartographie convertis en plugins de type `menu` (`is_system: 1`, `is_active: 1`) — activables/désactivables depuis Paramètres > Plugins
- **Exports pages** : Ajout de `TrackingPage`, `ReservationsPage`, `DepreciationPage`, `ImportExportPage`, `MapPage` dans `client/src/pages/index.ts`

### Modifié
- **seed.ts** : 3 nouveaux plugins ajoutés (`reservations`, `depreciation`, `map`) avec config JSON (statuts, durée amortissement, coordonnées par défaut) — INSERT inclut désormais `plugin_type` et `route` pour tous les plugins
- **Layout.tsx** : Réservations, Amortissement et Cartographie retirés de `baseNavigation` — apparaissent désormais via `pluginNavigation` (visibles uniquement si le plugin est actif) — `builtInPluginSlugs` étendu à `['calendar', 'reservations', 'depreciation', 'map']` — `iconMap` enrichi (`calendar-clock`, `trending-down`, `map-pin`)
- **vite.config.ts** : Manifest PWA corrigé pour pointer vers les fichiers PNG réels, `includeAssets` mis à jour

### Dépendances
- Ajout dev : `sharp` (génération icônes PNG)

## [1.3.0] - 2026-03-06

### Ajouté — 12 nouvelles fonctionnalités

#### 🔴 Priorité Haute
- **QR Codes matériels** : Génération de QR codes par matériel (`/api/qrcode/:id`), composant React `QRCodeDisplay`, affichage et téléchargement depuis la fiche objet — librairies `qrcode` (backend) et `react-qr-code` (frontend)
- **Import/Export CSV & Excel** : Import massif de matériels depuis fichiers CSV/Excel avec validation, export filtrable par catégorie au format CSV ou XLSX — route `/api/import-export`, page `ImportExportPage` — librairie `exceljs`
- **Tests automatisés** : 36 tests (15 backend + 21 frontend) — Jest + ts-jest + supertest côté serveur (tests slugify, routes API, WebSocket service), Vitest + @testing-library/react côté client (tests Badge, Button, Card)

#### 🟠 Priorité Moyenne
- **Réservation / Prêt de matériel** : Module complet avec table `reservations`, routes CRUD (`/api/reservations`), statuts (pending/approved/active/returned/overdue/cancelled), vérification CRON des retours en retard, page `ReservationsPage` avec filtres
- **Amortissement / Dépréciation** : Endpoint `/api/dashboard/depreciation` avec calcul linéaire de la valeur résiduelle, page `DepreciationPage` avec graphiques Recharts (barres + camembert)
- **PWA (Progressive Web App)** : Configuration `vite-plugin-pwa` avec manifest, service worker Workbox, cache intelligent, app installable sur mobile

#### 🟡 Priorité Basse
- **Cartographie GPS (Leaflet)** : Page `MapPage` avec carte interactive OpenStreetMap via `react-leaflet`, affichage des matériels géolocalisés avec filtres par catégorie
- **Timeline historique matériel** : Composant `ObjectTimeline` affichant la frise chronologique consolidée (créations, maintenances, contrôles, carburant, alertes), intégré comme onglet dans la fiche objet
- **Reporting périodique automatique** : Tâche CRON hebdomadaire (lundi 7h) envoyant un rapport HTML par email aux admins/superviseurs (stats objets, alertes, réservations)

#### 🟢 Optionnel
- **Dark Mode** : Hook `useDarkMode` avec persistance localStorage, sélecteur de thème (clair/sombre/système) dans le header, classes `dark:` appliquées à tous les composants UI (Card, Modal, Input, Select, TextArea, Button, Tabs) et au Layout
- **Internationalisation (i18n)** : Configuration `react-i18next` avec fichiers de traduction FR/EN, détection automatique de la langue navigateur, traduction de la navigation et des menus dans le Layout
- **WebSocket temps réel** : Service `websocket.service.ts` avec Socket.io, émission d'alertes en temps réel lors de la création, hook `useRealtimeAlerts` invalidant le cache React Query, fonctions `emitToAll`, `emitToRole`, `emitToUser`, `emitAlert`

### Dépendances
- Ajout backend : `qrcode`, `exceljs`, `socket.io`
- Ajout frontend : `react-qr-code`, `react-leaflet`, `leaflet`, `react-i18next`, `i18next`, `i18next-browser-languagedetector`, `socket.io-client`, `vite-plugin-pwa`
- Ajout dev/test : `jest`, `ts-jest`, `supertest`, `@types/supertest`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`

### Corrigé
- `req.user?.id` → `req.user?.userId` dans les routes importExport et reservation (conformité `JwtPayload`)
- Catégories de log invalides (`'export'`, `'import'`, `'reservation'`) → `'other'`
- Imports inutilisés nettoyés dans ObjectTimeline, useWebSocket, DepreciationPage, MapPage, ImportExportPage, ReservationsPage
- Composant `Select` remplacé par `<select>` natif dans ReservationsPage et ImportExportPage (incompatibilité props)
- Limite Workbox `maximumFileSizeToCacheInBytes` augmentée à 5 Mo pour le service worker PWA
- Typo `setupFilesAfterSetup` → `setupFilesAfterEnv` dans jest.config.ts

## [1.2.60] - 2026-03-06

### Ajouté
- **Page Paramètres > API** : Nouvelle section dans les paramètres d'administration affichant les informations complètes de l'API REST (nombre d'endpoints, version, format, authentification)
- **Documentation Swagger UI** : Interface interactive accessible via `/api-docs` permettant d'explorer et tester tous les endpoints de l'API directement depuis le navigateur
- **Spécification OpenAPI 3.0** : Endpoint `/api/swagger.json` fournissant la spec complète importable dans Postman, Insomnia ou tout client compatible
- **Endpoint `/api/api-info`** : Retourne les métadonnées de l'API (nombre d'endpoints, répartition par méthode HTTP et par module, tags, URLs)
- **Configuration Swagger** (`src/config/swagger.ts`) : Documentation centralisée des ~90 endpoints organisés en 18 tags (Auth, Users, Categories, Objects, Calendar, Alerts, Tracking, Dashboard, Upload, Settings, Plugins, Email Templates, Backup, Permissions, Custom Fields, Logs, Webhooks, Security)
- **Statistiques API** : Cartes affichant le nombre total d'endpoints, la version, le format REST et le type d'authentification JWT
- **URLs copiables** : Base URL, Swagger UI et OpenAPI Spec avec bouton de copie dans le presse-papiers
- **Guide d'authentification** : Bloc de code intégré montrant le flux complet (login → token → refresh)
- **Tableau Rate Limiting** : Récapitulatif des limites de requêtes par route (global, auth, upload, backup)
- **Modules API** : Grille listant tous les modules avec le nombre d'endpoints par module

### Dépendances
- Ajout de `swagger-jsdoc` et `swagger-ui-express` (+ types `@types/swagger-jsdoc`, `@types/swagger-ui-express`)

## [1.2.59] - 2026-03-04

### Ajouté
- **Route `PUT /api/users/me`** : Permet à l'utilisateur connecté de modifier son propre profil (prénom, nom, email) sans nécessiter le rôle administrateur — retourne les données utilisateur mises à jour pour actualiser le store frontend
- **Route `PUT /api/users/me/password`** : Permet à l'utilisateur connecté de changer son mot de passe en fournissant le mot de passe actuel et le nouveau (minimum 8 caractères)

### Corrigé
- **[CRITIQUE] Page Mon profil — Modification impossible** : Le formulaire de modification du prénom, nom et email retournait une erreur 404 (`PUT /api/users/me` inexistant). Le frontend appelait `/api/users/me` mais seule la route `/api/users/:id` (réservée admin) existait côté backend — Express interprétait `"me"` comme un ID numérique, la requête SQL ne trouvait aucun utilisateur et retournait 404
- **[CRITIQUE] Page Mon profil — Changement de mot de passe impossible** : Le formulaire de changement de mot de passe échouait en 404 (`PUT /api/users/me/password` inexistant) — ajout de la route dédiée avec vérification du mot de passe actuel

## [1.2.58] - 2026-03-04

### Ajouté
- **Avatar utilisateur** : Possibilité d'uploader une photo de profil (JPG, PNG, GIF, WebP, max 5 Mo) depuis la page Mon profil — l'image remplace le cercle à initiales partout dans l'application (header, profil)
- **Route `POST /api/auth/avatar`** : Upload d'avatar avec multer, stockage dans `uploads/avatars/`, suppression automatique de l'ancien fichier
- **Route `DELETE /api/auth/avatar`** : Suppression de l'avatar avec nettoyage du fichier sur le serveur
- **UX — Overlay caméra au survol** : Un overlay avec icône caméra apparaît au survol de l'avatar pour indiquer qu'il est cliquable
- **UX — Bouton supprimer** : Bouton rouge en bas à droite de l'avatar pour supprimer la photo et revenir aux initiales
- **Fallback initiales** : Si aucune photo n'est définie, le cercle avec les initiales est affiché comme avant

## [1.2.57] - 2026-03-04

### Corrigé
- **[CRITIQUE] SQL spécifique SQLite `datetime('now')` éradiqué du projet** : Remplacement systématique de **toutes** les occurrences restantes de `datetime('now')` par `new Date().toISOString()` (ou paramètre lié) pour une compatibilité totale SQLite/MySQL — corrigé dans 13 fichiers : `webhook.routes.ts` (6), `permission.routes.ts` (2), `auth.routes.ts` (4), `calendar.routes.ts` (14), `emailTemplate.routes.ts` (1), `object.routes.ts` (1), `plugin.routes.ts` (4), `server.ts` (1), `jwtRotation.service.ts` (5), `log.service.ts` (1), `plugin.service.ts` (1), `pluginAdvanced.service.ts` (2), `cron.service.ts` (2) — total : **44 occurrences** corrigées
- **[HAUTE] Incohérence validation mot de passe dans auth** : Les routes `POST /register`, `POST /reset-password` et `PUT /change-password` validaient un minimum de 6 caractères au lieu de 8 — aligné sur 8 caractères minimum comme le frontend et les routes utilisateurs
- **[HAUTE] `DEFAULT (datetime('now'))` non conditionnel dans pluginAdvanced** : La création dynamique de tables plugin utilisait `datetime('now')` en dur pour les colonnes timestamp — rendu conditionnel avec `db.getType()` pour utiliser `DEFAULT CURRENT_TIMESTAMP` sous MySQL
- **[HAUTE] Calcul de dates SQLite dans cron.service** : La requête de rappels calendrier utilisait `datetime(ce.start_date, '-' || ...)` incompatible MySQL — rendu conditionnel avec `DATE_SUB()` pour MySQL

### Amélioré
- **Recherche utilisateurs** : Le endpoint `GET /api/users` supporte désormais un paramètre `search` (recherche par nom, prénom, email) et `roles` (filtrage par rôle, ex: `?roles=admin,supervisor`)
- **Performance — Optimisation `PUT /api/settings`** : Remplacement des requêtes SELECT séquentielles par un batch unique + `Promise.all` pour les UPDATE/INSERT
- **UX — Modal de confirmation dans WebhooksPage** : Remplacement du `confirm()` natif du navigateur par une modal stylisée cohérente avec le reste de l'application (icône Trash2, boutons Annuler/Supprimer avec état de chargement)

## [1.2.56] - 2026-03-04

### Corrigé
- **[CRITIQUE] Page Base de données entièrement cassée** : Le frontend accédait à `response.data.type`, `response.data.size`, `response.data.tables` alors que le backend renvoyait les données sous `response.data.database.*` — le type affichait toujours "MySQL/MariaDB" même sur SQLite, la taille affichait "N/A", le nombre de tables affichait "[object Object] tables", la note SQLite et la section migration n'apparaissaient jamais
- **[HAUTE] SQL spécifique SQLite `datetime('now')`** : Remplacé dans 3 endroits supplémentaires — `PUT /api/settings` (mise à jour paramètres), `PUT /api/settings/smtp` (configuration SMTP), `PUT /api/users/:id` (modification utilisateur) — par `new Date().toISOString()` compatible SQLite et MySQL
- **[HAUTE] Incohérence validation mot de passe** : Le backend validait un minimum de 6 caractères à la création d'utilisateur alors que le frontend affichait "Minimum 8 caractères" — aligné le backend sur 8 caractères minimum
- **[HAUTE] Pas de validation longueur mot de passe à la modification** : Le `PUT /api/users/:id` acceptait n'importe quelle longueur de mot de passe — ajout d'une validation minimum 8 caractères
- **[MOYENNE] Section statistiques vide sur la page Base de données** : Le frontend cherchait `dbInfo.stats` qui n'existait pas dans la réponse API — remplacé par l'affichage des compteurs par table (`dbInfo.tables`) déjà fournis par le backend, avec total des enregistrements

### Amélioré
- **Performance — Parallélisation des comptages de tables** : Les 9 requêtes `COUNT(*)` séquentielles du endpoint `GET /api/settings/database` sont désormais exécutées en parallèle via `Promise.all`
- **UX — Taille formatée de la base de données** : Ajout d'un champ `sizeFormatted` dans la réponse API (ex: "12.50 Mo") pour un affichage lisible
- **UX — Total des enregistrements** : Ajout d'un bandeau affichant le nombre total d'enregistrements dans la section statistiques

## [1.2.55] - 2026-03-04

### Corrigé
- **[CRITIQUE] Sécurité — Pas de filtrage par permissions sur le Tableau de bord** : Le endpoint `GET /api/dashboard/stats` retournait les statistiques globales (nombre de catégories, matériels, alertes, carburant, contrôles, entretiens, valeur du parc) de **tout** le système, y compris pour les utilisateurs non-admin à accès limité — toutes les requêtes sont désormais filtrées par `getAccessibleCategoryIds`
- **[HAUTE] Activité récente non triée par date** : Le frontend appelait `GET /objects?sort=updatedAt` mais le backend ignorait le paramètre `sort`, affichant les matériels triés alphabétiquement au lieu des derniers modifiés — ajout du support du paramètre `sort` (valeurs : `name`, `updatedAt`, `createdAt`, `status`) avec whitelist de sécurité
- **[BASSE] Import `TrendingUp` inutilisé** : Icône importée de lucide-react mais jamais utilisée dans le composant — supprimée

### Amélioré
- **Performance — Parallélisation des requêtes du dashboard** : Les 9 requêtes séquentielles du endpoint `GET /api/dashboard/stats` sont désormais exécutées en parallèle via `Promise.all`
- **UX — Affichage de la valeur totale du parc** : Ajout d'une 5ème carte statistique affichant la valeur totale des matériels (déjà calculée par le backend mais non affichée) avec formatage en euros
- **UX — Couleur `emerald` pour StatCard** : Ajout du support de la couleur `emerald` dans le composant `StatCard`

## [1.2.54] - 2026-03-04

### Corrigé
- **[CRITIQUE] Performance — Requêtes N+1 sur la liste des catégories** : `GET /api/categories` exécutait 2 requêtes par catégorie (comptage objets + sous-catégories) dans une boucle — remplacé par 2 requêtes `GROUP BY` avec Maps pour un chargement O(1)
- **[CRITIQUE] Performance — Requêtes N+1 sur les sous-catégories** : `GET /api/categories/:id/subcategories` exécutait une requête de comptage par sous-catégorie — remplacé par une seule requête `GROUP BY subcategory_id`
- **[HAUTE] Boutons édition/suppression visibles pour les simples utilisateurs** : Sur `CategoriesPage` et `CategoryDetailPage`, les boutons Modifier/Supprimer et les boutons de création étaient affichés pour tous les rôles alors que le backend exige `requireSupervisor` (PUT) et `requireAdmin` (DELETE) — masqués selon le rôle utilisateur
- **[HAUTE] Champ `description` absent du schéma DB** : Le frontend envoyait un champ `description` pour les catégories mais la colonne n'existait pas en base — ajout de la colonne `description TEXT` dans la table `categories` et support complet (POST, PUT, GET)
- **[MOYENNE] Statut par défaut incorrect pour les objets** : Le formulaire de création d'objet utilisait `'active'` comme statut par défaut alors que les options du select commencent par `'available'` — corrigé
- **[MOYENNE] Recherche non implémentée pour les sous-catégories** : Le frontend envoyait `?search=...` sur `GET /api/categories/:id/subcategories` mais le backend ignorait le paramètre — ajout du filtre `name LIKE ?`
- **[BASSE] SQL spécifique SQLite `datetime('now')`** : Remplacé dans les 3 routes PUT (catégorie, sous-catégorie imbriquée, sous-catégorie indépendante) par `new Date().toISOString()` compatible SQLite et MySQL
- **[BASSE] Formulaire sous-catégorie avec champ description inutile** : Le modal de création/édition de sous-catégorie contenait un champ `description` non supporté par la table `subcategories` — supprimé du formulaire

## [1.2.53] - 2026-03-04

### Corrigé
- **[CRITIQUE] Page Alertes — Mutations cassées** : Les actions « Marquer comme lu », « Résoudre » et « Tout marquer comme lu » échouaient en 404 car le frontend appelait des endpoints inexistants (`PUT /alerts/:id` au lieu de `PUT /alerts/:id/read`, `POST /alerts/acknowledge-all` au lieu de `PUT /alerts/read-all`)
- **[CRITIQUE] Page Alertes — Filtres inopérants** : Les filtres par statut (`status`) et par type (`type`) étaient ignorés car le backend n'acceptait que `alertType` et `severity` comme paramètres de requête — ajout du support `type` et `status` côté backend
- **[CRITIQUE] Page Alertes — Incohérence modèle frontend/backend** : Le frontend utilisait `alert.type`, `alert.priority`, `alert.status` mais le backend retournait `alertType`, `severity`, `isRead`/`isDismissed` — ajout de champs calculés (`type`, `status`, `priority`) dans la réponse API pour compatibilité
- **[HAUTE] Injection SQL dans les paramètres d'alertes** : `PUT /api/alerts/settings` interpolait `settings.*.days` directement dans les requêtes SQL (`date('now', '+${days} days')`) — remplacé par calcul de date côté serveur avec requêtes paramétrées et validation des valeurs (1-365)
- **[HAUTE] Pas de filtrage par catégorie sur les alertes** : Les endpoints `GET /api/alerts` et `GET /api/alerts/count` retournaient les alertes de toutes les catégories — filtrage par `getAccessibleCategoryIds` ajouté pour que les utilisateurs non-admin ne voient que les alertes liées à leurs catégories autorisées
- **[MOYENNE] Boutons admin visibles pour les simples utilisateurs** : Les boutons « Supprimer » et « Paramètres » étaient affichés pour tous les utilisateurs alors que le backend exige `requireSupervisor` — masqués pour le rôle `user`
- **[BASSE] SQL spécifique SQLite** : `datetime('now')` dans la mise à jour des paramètres remplacé par `new Date().toISOString()` compatible SQLite et MySQL

## [1.2.52] - 2026-03-04

### Corrigé
- **[CRITIQUE] Sécurité — Filtrage par catégorie sur le module Suivi des coûts** : Les endpoints `/tracking/data`, `/tracking/charts`, `/tracking/yearly-comparison` et `/tracking/filters` exposaient les données de toutes les catégories. Les utilisateurs non-admin ne voient désormais que les données des catégories auxquelles ils ont accès
- **[HAUTE] Requête costByCategory sans filtre objet** : Le graphique "Coûts par catégorie" ignorait les filtres catégorie/objet sélectionnés par l'utilisateur — corrigé en appliquant `objectCondition` à la requête
- **[MOYENNE] percentageChange retournait une chaîne au lieu d'un nombre** : Les cartes statistiques n'affichaient pas correctement le pourcentage d'évolution (sans signe `+` ni symbole `%`) — corrigé en retournant un `number` depuis le backend
- **[BASSE] Requête de comparaison inutile en mode annuel/mensuel** : Le endpoint `/data` recevait `compareStartDate`/`compareEndDate` même en mode de comparaison annuelle/mensuelle, déclenchant une requête de comparaison inutile — corrigé côté frontend

### Amélioré
- **Performance — Comparaison annuelle optimisée** : L'endpoint `/yearly-comparison` exécutait 72 requêtes séquentielles (12 mois × 3 types × 2 années). Remplacé par 6 requêtes groupées par mois avec `GROUP BY` et exécutées en parallèle via `Promise.all`
- **UX — État vide** : Ajout d'un message informatif lorsqu'aucune donnée de suivi n'existe pour la période et les filtres sélectionnés
- **Code — Nettoyage** : Suppression de 3 appels `objectCondition.replace(/o\./g, 'o.')` qui étaient des no-op (remplaçaient `o.` par `o.`)

## [1.2.51] - 2026-03-04

### Amélioré
- **Sécurité - Droits & Permissions renforcés** : Audit et correction des failles de permissions
  - **[CRITIQUE]** Filtrage des objets par catégorie autorisée dans `GET /api/objects` — un utilisateur ne voit plus que les objets des catégories auxquelles il a accès
  - **[CRITIQUE]** Vérification de l'accès catégorie dans `GET /api/objects/:id` — un utilisateur ne peut plus consulter le détail d'un objet d'une catégorie interdite
  - **[HAUTE]** Vérification `can_edit` par catégorie lors de la création (`POST /api/objects`) et modification (`PUT /api/objects/:id`) — un superviseur ne peut plus créer/modifier dans une catégorie sans permission d'édition
  - **[HAUTE]** Sécurisation de `GET /api/permissions/effective/:userId` — seul un admin ou l'utilisateur lui-même peut consulter ses permissions effectives (fuite d'information corrigée)
  - **[MOYENNE]** Routes d'upload (`POST /api/upload/*`, `DELETE /api/upload/*`) restreintes aux superviseurs et admins — un simple utilisateur ne peut plus uploader ni supprimer de fichiers
  - **[MOYENNE]** Route de déclenchement de webhooks (`POST /api/webhooks/trigger`) restreinte aux superviseurs et admins
  - **[BASSE]** Vérification `checkCategoryAccess` ajoutée sur les routes de sous-catégories (`GET /:categoryId/subcategories`, `GET /by-slug/:slug`, `GET /:id`)

### Ajouté
- **Helpers de permissions réutilisables** dans le middleware d'authentification :
  - `checkCategoryAccess()` : vérifie si un utilisateur peut voir une catégorie
  - `checkCategoryPermission()` : vérifie un droit spécifique (vue/édition/suppression) sur une catégorie
  - `getAccessibleCategoryIds()` : retourne la liste des catégories accessibles par un utilisateur
  - Suppression du code dupliqué dans `category.routes.ts` au profit du helper centralisé

## [1.2.50] - 2026-03-04

### Amélioré
- **Calendrier - Rendu mobile et tablette** : Refonte complète de l'affichage responsive
  - Barre d'outils sur deux lignes pour éviter le débordement sur petits écrans
  - Boutons navigation année masqués sur mobile pour gagner de l'espace
  - Sélecteur de vue compact avec icônes seules sur mobile
  - Champ de recherche masqué sur mobile, accessible via le panneau filtres
  - Tailles de texte et espacements adaptatifs (`text-xs sm:text-sm`)
  - Panneau latéral (mini-calendrier) en overlay sur mobile avec fond semi-transparent
  - Bouton calendrier dans la toolbar pour ouvrir/fermer le mini-calendrier sur mobile
  - Fermeture automatique du panneau après sélection d'un jour sur mobile
  - Correction du bug de grille FullCalendar qui débordait sur mobile (`table-layout: fixed`, `width: 100%`)
  - Styles FullCalendar responsive : polices réduites, cellules compactes, heures masquées dans les événements
  - Padding du calendrier principal réduit sur mobile (`p-1 sm:p-2 md:p-4`)

### Corrigé
- **SMTP - Noms de champs client/serveur désalignés** : Correction de la sauvegarde SMTP inopérante
  - Le client envoyait des champs `smtpHost`, `smtpPort`, etc. mais le serveur attendait `host`, `port`, etc.
  - Tous les champs sont maintenant alignés entre le client et le serveur
  - Le champ `isActive` est maintenant envoyé automatiquement à `true` lors de la sauvegarde
  - Le chargement des paramètres existants fonctionne correctement (lecture de `response.data.smtp`)

## [1.2.49] - 2026-03-03

### Corrigé
- **SMTP - Import dynamique cassé en production** : Correction de l'erreur `Cannot find module email.service`
  - Remplacement de l'import dynamique `await import()` par un import statique
  - L'import dynamique ne résolvait pas correctement le chemin dans le build compilé (Docker)

## [1.2.48] - 2026-03-03

### Corrigé
- **SMTP - Test d'envoi d'email** : Correction de l'erreur 500 lors du test SMTP
  - Le client envoyait `{ email }` mais le serveur attendait `{ testEmail }` — le champ est maintenant aligné sur `email`
  - Ajout d'une validation côté serveur renvoyant une erreur 400 si l'adresse email est absente
  - Correction de la lecture du message d'erreur côté client (`data.message` au lieu de `data.error`)

## [1.2.47] - 2026-02-08

### Amélioré
- **Page Sauvegardes - Design et fonctionnalités** : Refonte complète de l'interface
  - Design plus cohérent et épuré, suppression des sections redondantes
  - Nouveau bouton 🔗 pour générer un lien de téléchargement partageable (valide 7 jours)
  - Modal de génération de lien avec copie en un clic et ouverture directe
  - Indicateur 📎 sur les fichiers > 25 MB dans la liste

### Ajouté
- **Téléchargement via lien temporaire** : Nouveau système pour les gros fichiers
  - Endpoint `GET /api/backup/download/:token` pour téléchargement public sans authentification
  - Endpoint `POST /api/backup/:id/generate-link` pour générer des liens valides 7 jours
  - Tokens stockés en mémoire avec nettoyage automatique des liens expirés
  - Email avec template HTML élégant contenant le lien de téléchargement

- **Gestion intelligente des fichiers volumineux par email** :
  - Les sauvegardes < 25 MB sont envoyées en pièce jointe classique
  - Les sauvegardes > 25 MB génèrent automatiquement un lien de téléchargement temporaire
  - L'envoi par email fonctionne maintenant pour tous les fichiers quelle que soit leur taille

## [1.2.46] - 2026-02-08

### Corrigé
- **Rate Limiter - Support IPv6** : Correction de l'erreur `ERR_ERL_KEY_GEN_IPV6`
  - Utilisation de `ipKeyGenerator` d'express-rate-limit pour normaliser les adresses IPv6
  - Empêche les utilisateurs IPv6 de contourner les limites de rate limiting
  - Corrige le crash au démarrage en production

## [1.2.45] - 2026-02-08

### Corrigé
- **Calendrier - Modification/Suppression d'événement** : Correction de l'erreur 404 lors de la modification ou suppression
  - Ajout des routes raccourcies `PUT /api/calendar/:id` et `DELETE /api/calendar/:id`
  - Le client envoyait les requêtes sur `/api/calendar/:id` mais seules `/api/calendar/events/:id` existaient

## [1.2.44] - 2026-02-08

### Amélioré
- **Calendrier - Lier à un matériel** : Remplacement du champ Select par un composant Autocomplete
  - Nouveau composant `Autocomplete` réutilisable avec recherche intégrée
  - Champ de recherche pour filtrer facilement les matériels
  - Bouton de suppression (X) pour vider la sélection
  - Menu déroulant avec défilement pour les longues listes
  - Fermeture automatique au clic à l'extérieur

## [1.2.43] - 2026-02-08

### Corrigé
- **Calendrier - Création d'événement** : Correction de l'erreur 404 lors de la création d'un événement
  - Ajout de la route `POST /api/calendar` manquante (raccourci vers `/api/calendar/events`)
  - Le client envoyait les requêtes sur `/api/calendar` mais seule `/api/calendar/events` existait

## [1.2.42] - 2026-02-07

### Corrigé
- **Tableau de bord - Statistiques des modules** : Correction de l'affichage des statistiques qui restaient à 0
  - Ajout du calcul du carburant consommé ce mois depuis la table `fuel_entries`
  - Ajout du comptage des contrôles techniques à venir (30 prochains jours)
  - Ajout du comptage des entretiens à prévoir (30 prochains jours)
  - Les trois indicateurs (Carburant, Contrôles, Entretiens) affichent maintenant les bonnes valeurs

## [1.2.41] - 2026-02-07

### Corrigé
- **Calendrier - Boutons de vue** : Correction des boutons Mois/Semaine/Jour/Liste qui ne fonctionnaient pas
  - Installation du plugin manquant `@fullcalendar/list` pour la vue Liste
  - Import et intégration du `listPlugin` dans le composant FullCalendar
  - Les 4 modes de vue sont maintenant pleinement fonctionnels

## [1.2.40] - 2026-02-06

### Corrigé
- **Health check Docker** : Correction de l'erreur SSL sur le health check en production
  - Le middleware HTTPS excluait pas les requêtes internes de health check
  - Les requêtes vers `/api/health` depuis `127.0.0.1` ne sont plus redirigées vers HTTPS
  - Résout l'erreur "SSL routines:packet length too long" dans les containers

## [1.2.39] - 2026-02-06

### Sécurité
- **Cookie d'authentification pour les uploads** : Résolution de l'erreur 401 sur les images
  - Ajout du middleware `cookie-parser` pour la gestion des cookies
  - Cookie `auth_token` HttpOnly créé lors de la connexion
  - Le middleware `verifyUploadAccess` accepte maintenant le token via :
    - Header `Authorization: Bearer <token>`
    - Cookie `auth_token` (nouveau - pour les balises `<img>`)
    - Query parameter `?token=<token>`
  - Cookie mis à jour lors du refresh token
  - Cookie supprimé lors de la déconnexion

### Dépendances
- Ajout de `cookie-parser` et `@types/cookie-parser`

## [1.2.38] - 2026-02-06

### Sécurité
- **Rate Limiting** : Protection contre les attaques par force brute via `express-rate-limit`
  - Rate limiter global : 1000 requêtes / 15 minutes
  - Rate limiter authentification : 10 tentatives / 15 minutes (login, register, forgot-password)
  - Rate limiter uploads : 100 / heure
  - Rate limiter exports/backups : 10 / heure
  - Journalisation des dépassements de limite dans les logs de sécurité
  
- **HTTPS forcé** : Redirection automatique HTTP → HTTPS en production
  - Middleware de détection de protocole (direct ou via proxy)
  - Support de `X-Forwarded-Proto` et `X-Forwarded-SSL`
  - Header HSTS (Strict-Transport-Security) avec max-age 1 an
  - Route `/api/https-status` pour le debugging
  
- **Audit des tokens** : Journalisation complète des authentifications
  - Connexions réussies et échouées avec métadonnées (IP, User-Agent)
  - Déconnexions tracées
  - Rafraîchissements de tokens avec alertes pour utilisateurs inexistants
  - Changements de mots de passe loggés
  
- **Rotation des secrets JWT** : Service complet de rotation périodique
  - Génération de secrets cryptographiquement sécurisés (64 octets)
  - Période de grâce configurable (défaut: 24h) pour transition en douceur
  - Intervalle de rotation configurable (défaut: 90 jours)
  - Rotation automatique ou manuelle
  - Historique des rotations consultable
  - Rapport de sécurité avec recommandations

### API
- `GET /api/security/jwt/status` - Rapport de sécurité JWT
- `GET /api/security/jwt/settings` - Paramètres de rotation
- `PUT /api/security/jwt/settings` - Modifier les paramètres de rotation
- `POST /api/security/jwt/rotate` - Déclencher une rotation manuelle
- `GET /api/security/jwt/history` - Historique des rotations
- `POST /api/security/jwt/cleanup` - Nettoyer les anciens secrets
- `GET /api/https-status` - Vérifier le statut HTTPS

### Documentation
- Mise à jour de `docs/AUDIT_SECURITE_API.md` avec les nouvelles fonctionnalités
- Nouveau document `docs/JWT_ROTATION.md` avec guide complet de rotation
- Score de sécurité mis à jour : 9.5/10

### Base de données
- Table `jwt_secrets` : Stockage des secrets JWT pour rotation

### Dépendances
- Ajout de `express-rate-limit` pour la protection contre les abus

## [1.2.37] - 2026-02-06

### Corrigé
- **TypeScript** : Correction des erreurs de typage dans `calendar.routes.ts`
  - Ajout des assertions de type pour les réponses JSON des API Outlook/Microsoft Graph
  - Correction du type `unknown` retourné par `response.json()` pour `errorData`, `tokenData` et `eventsData`

## [1.2.36] - 2026-02-06

### Sécurité
- **Protection des fichiers uploadés** : Les fichiers dans `/uploads` nécessitent maintenant une authentification JWT
  - Middleware de vérification de token ajouté pour tous les fichiers sensibles
  - Fichiers publics autorisés : logos, favicons, images du site
  - Support du token via header `Authorization: Bearer` ou paramètre `?token=`
  - Correction de la vulnérabilité d'exposition publique des fichiers (CVSS 6.5)

### Documentation
- **Audit de sécurité** : Ajout du rapport d'audit complet (`docs/AUDIT_SECURITE_API.md`)
  - Analyse de toutes les routes API et leur niveau de protection
  - Matrice de conformité OWASP
  - Plan d'action de sécurité priorisé

## [1.2.35] - 2026-02-06

### Amélioré
- **Responsive Mobile** : Amélioration significative de l'affichage sur mobile
  - **Composant Tabs** : Scroll horizontal avec barre de défilement cachée
  - **Graphiques** : Formatage intelligent des axes (€, k€, M€ selon la valeur)
  - **Graphiques** : Réduction de la taille des labels pour mobile
  - **Page ObjectDetail** : Image et titre adaptés aux petits écrans
  - **Composants Card** : Padding responsive (réduit sur mobile)

### Corrigé
- **Graphiques Suivi** : Les valeurs < 1000€ s'affichent maintenant correctement (au lieu de "0k€")
- **TypeScript** : Correction de l'erreur `attachments` manquant dans `openControlModal`
- **TypeScript** : Ajout de `fieldOptions` au type des champs personnalisés
- **Import inutilisé** : Suppression de l'import `Paperclip` non utilisé

## [1.2.34] - 2026-02-06

### Amélioré
- **Module Suivi - Interface de comparaison unifiée** : Fusion des modes de comparaison
  - Nouveau sélecteur de mode de comparaison (Périodes personnalisées, Années, Mois spécifiques)
  - Mode "Périodes personnalisées" : Compare deux plages de dates libres
  - Mode "Années" : Compare deux années complètes avec graphiques mois par mois
  - Mode "Mois spécifiques" : Compare deux mois spécifiques (ex: Janvier 2025 vs Janvier 2024)
  - Interface visuelle avec couleurs distinctives (bleu, violet, vert)
  - Affichage dynamique du label de l'onglet selon le mode sélectionné
  - Résumé comparatif avec différence et pourcentage pour tous les modes

### Corrigé
- **Calcul des différences** : Correction de la logique (year2 - year1) pour afficher correctement les augmentations/réductions
- **Filtres avancés** : Correction de l'overflow pour afficher les dropdowns Catégories/Sous-catégories/Objets
- **Export PDF** : Remplacement des emojis par des symboles ASCII compatibles avec jsPDF
- **Export PDF comparaison** : Support des modes yearly/monthly en plus du mode period

### API
- `GET /api/tracking/yearly-comparison` - Support des paramètres `month1` et `month2` pour la comparaison mensuelle

## [1.2.33] - 2026-02-06

### Amélioré
- **Module Suivi - Graphiques comparatifs** : Ajout de la comparaison année par année
  - Sélection de deux années à comparer (ex: 2025 vs 2026)
  - Graphiques en barres comparatifs mois par mois
  - Graphiques en lignes par type de coût (carburant, entretiens, contrôles)
  - Résumé des totaux par année avec différence et pourcentage
  - Visualisation claire des augmentations/diminutions de coûts
- **Export PDF amélioré** : Génération PDF native (téléchargement direct)
  - Utilisation de jsPDF au lieu d'une fenêtre d'impression
  - Barre de progression pendant la génération
  - Téléchargement automatique du fichier PDF
  - Capture des graphiques en images haute qualité (html2canvas)

### Dépendances
- Ajout de `jspdf` pour la génération PDF native
- Ajout de `html2canvas` pour la capture des graphiques

### API
- `GET /api/tracking/yearly-comparison` - Comparer les coûts entre deux années

## [1.2.32] - 2026-02-06

### Ajouté
- **Module Suivi** : Nouveau menu dans la barre latérale pour le suivi des coûts
  - Tableau de bord avec cartes statistiques (coût total, carburant, entretiens, contrôles)
  - Filtrage par période, catégorie, sous-catégorie, objet(s) multiples
  - Filtrage par type de données (carburant, entretiens, contrôles techniques)
  - Filtres avancés par type de carburant et type d'entretien
  - Graphiques interactifs (barres, donut) pour l'évolution des coûts
  - Tableaux détaillés avec tri, pagination et accès aux pièces jointes
  - Comparaison de périodes pour suivre l'évolution des coûts
  - Tendances visuelles (hausse/baisse) par rapport à la période de comparaison
  - Export PDF personnalisable avec options de contenu
  - Possibilité d'inclure les pièces jointes dans le rapport
- **Permissions du module Suivi** : Nouvel onglet "Modules" dans Paramètres > Droits
  - Permissions par rôle (Superviseur, Utilisateur)
  - Permissions individuelles par utilisateur
  - Droits : Voir, Exporter, Comparer

### Base de données
- Table `module_permissions` : Permissions d'accès aux modules par rôle
- Table `user_module_permissions` : Permissions individuelles par utilisateur

### API
- `GET /api/tracking/data` - Récupérer les données de suivi filtrées
- `GET /api/tracking/charts` - Récupérer les données pour les graphiques
- `GET /api/tracking/filters` - Récupérer les options de filtrage
- `GET /api/tracking/permissions` - Vérifier les permissions de l'utilisateur
- `GET /api/permissions/modules` - Lister les modules disponibles
- `GET /api/permissions/modules/:module/group/:role` - Permissions d'un module par rôle
- `PUT /api/permissions/modules/:module/group/:role` - Modifier les permissions
- `GET /api/permissions/modules/:module/user/:userId` - Permissions individuelles
- `PUT /api/permissions/modules/:module/user/:userId` - Modifier les permissions individuelles

## [1.2.31] - 2026-02-06

### Ajouté
- **Gestion des Webhooks** : Nouveau menu dans les paramètres pour configurer des webhooks
  - Création, modification et suppression de webhooks
  - Sélection des événements à écouter (objets, catégories, alertes, maintenances, etc.)
  - Configuration d'headers personnalisés
  - Secret de signature HMAC-SHA256 pour la sécurité
  - Bouton de test pour vérifier la connexion
  - Affichage du statut et de la dernière réponse
  - Activation/désactivation individuelle

### API
- `GET /api/webhooks` - Lister tous les webhooks
- `GET /api/webhooks/:id` - Obtenir un webhook par ID
- `POST /api/webhooks` - Créer un webhook
- `PUT /api/webhooks/:id` - Modifier un webhook
- `DELETE /api/webhooks/:id` - Supprimer un webhook
- `POST /api/webhooks/:id/test` - Tester un webhook
- `POST /api/webhooks/trigger` - Déclencher les webhooks pour un événement

## [1.2.30] - 2026-02-06

### Ajouté
- **Synchronisation automatique de la version** : 
  - Script `scripts/sync-version.js` pour synchroniser la version depuis CHANGELOG.md vers package.json et README.md
  - Commandes npm : `npm run version:check`, `npm run version:sync`, `npm run version:get`
  - Synchronisation automatique lors de `npm run build`
  - Mise à jour automatique de la version en base de données au démarrage du serveur

### Amélioré
- **Couleurs des cartes d'alertes selon la priorité** : Les cartes d'alertes affichent maintenant une couleur de fond légère correspondant à leur priorité
  - Priorité Basse : fond bleu clair
  - Priorité Moyenne : fond orange clair  
  - Priorité Élevée : fond rouge clair
- Meilleure identification visuelle du niveau d'importance des alertes

## [1.2.29] - 2026-02-05

### Ajouté
- **Route API `/api/alerts/check`** : Permet de forcer manuellement la vérification des alertes (superviseurs uniquement)

## [1.2.28] - 2026-02-05

### Corrigé
- **Alertes pour échéances passées** : Les alertes sont maintenant générées pour les maintenances et contrôles techniques en retard
  - Les maintenances en retard affichent "en retard depuis le..." avec une sévérité critique
  - Les contrôles techniques expirés affichent "a expiré le..." avec une sévérité critique
  - Les alertes existantes sont mises à jour automatiquement si l'échéance est dépassée

### Amélioré
- **Service cron** : La vérification des alertes inclut maintenant :
  - Les échéances à venir (dans les X jours configurés)
  - Les échéances passées (en retard ou expirées)
- **Sévérité automatique** : Les éléments en retard/expirés sont automatiquement marqués comme critiques

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
