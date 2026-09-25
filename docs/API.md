# Référence de l'API

> Toutes les routes sont sous `/api` et, sauf mention contraire, exigent un jeton JWT (`Authorization: Bearer …`). La documentation interactive est servie par l'application sur `/api-docs`. Retour au [README](../README.md).

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

#### Passkeys (WebAuthn / FIDO2)

Les routes vont par paires : la première remet un défi à signer, la seconde vérifie la signature.

```
GET    /api/auth/passkey/status           # Le bouton doit-il s'afficher ? (public)
POST   /api/auth/passkey/login/options    # Défi de connexion, sans identifiant (public)
POST   /api/auth/passkey/login/verify     # Connexion sans mot de passe (public)
POST   /api/auth/passkey/2fa/verify       # Second facteur, avec le ticket rendu par /login
GET    /api/auth/passkey                  # Mes passkeys
POST   /api/auth/passkey/register/options # Défi d'enregistrement
POST   /api/auth/passkey/register/verify  # Enregistre la clé publique
PATCH  /api/auth/passkey/:id              # Renommer une des miennes
DELETE /api/auth/passkey/:id              # Supprimer une des miennes
DELETE /api/auth/passkey/user/:userId     # Retirer celles d'un agent (admin)
```

Quand le second facteur est exigé, `POST /api/auth/login` ne rend aucun jeton : il rend `secondFacteur: { ticket, options }`, et c'est `/2fa/verify` qui ouvre la session.

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

GET    /api/users/annuaire        # Noms seuls, pour désigner quelqu'un (agent et au-dessus)
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
```

Le sens est unique : l'application reste la source de vérité, le fichier déposé sert à consulter
et à annoter à côté.

**Connexion Nextcloud** — *Paramètres > Nextcloud*

```
GET    /api/nextcloud            # Connexion enregistrée (sans le mot de passe)
PUT    /api/nextcloud            # Enregistrer la connexion
POST   /api/nextcloud/test       # Dépose un fichier témoin dans le dossier de travail, puis le retire
GET    /api/nextcloud/browse     # Contenu d'un dossier (?path=), dossiers d'abord
GET    /api/nextcloud/download   # Télécharge un fichier distant (?path=)
POST   /api/nextcloud/test-pdf   # Convertit un document témoin, et dit quel chemin a répondu
```

Utilisez un **mot de passe d'application** Nextcloud, jamais celui du compte : il se révoque sans
changer les identifiants de la personne. L'adresse du site suffit — la racine WebDAV
(`/remote.php/dav/files/identifiant`) est complétée à l'enregistrement, car elle ne s'affiche nulle
part dans Nextcloud. Le test **dépose réellement** un fichier témoin puis le retire, au lieu de
valider la forme des champs ; l'explorateur sert à désigner un dossier plutôt qu'à l'épeler, le
dépôt étant silencieux par construction — un Nextcloud injoignable ne fait jamais échouer la
validation d'une manifestation.

La connexion sert aussi aux **modèles de document** (`/api/services/nextcloud-templates`) : un
modèle tenu dans Nextcloud est relu à chaque génération, si bien qu'une correction faite le matin
s'applique l'après-midi.

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
POST   /api/services/:id/template/preview # Télécharger un aperçu rempli (format: docx | pdf)
DELETE /api/services/:id/template

POST   /api/manifestations/:id/documents/generate   # Refaire les documents des services
POST   /api/manifestations/documents/:docId/pdf     # Convertir une pièce .docx en PDF, à la demande
```

Le modèle est un `.docx` ordinaire : `{manifestation}` pour une valeur, `{#materiels}…{/materiels}`
pour une liste répétée. La bibliothèque retenue, `easy-template-x` (MIT), **n'exécute aucun code venu
du modèle** — un fichier Word déposé dans un Nextcloud partagé ne doit rien pouvoir faire tourner
sur le serveur.

**Conversion en PDF** — le format est réglé **par modèle** (`output_format` : `docx`, `pdf`, ou les
deux). La conversion passe par le serveur bureautique du Nextcloud, par trois chemins essayés dans
l'ordre : le connecteur **Euro-Office** (`/apps/eurooffice/downloadas`), le connecteur **ONLYOFFICE**
(`/apps/onlyoffice/downloadas`), puis l'API de conversion de Nextcloud
(`/ocs/v2.php/apps/files/api/v1/convert`). Euro-Office est un fork d'ONLYOFFICE Docs, mais son
connecteur Nextcloud est une **application distincte** : les routes sont identiques à l'identifiant
près, et interroger le mauvais rend un 404 qu'on lirait comme « pas de serveur bureautique ». L'API
générique vient en dernier — aucun de ces connecteurs n'enregistre de fournisseur de conversion, si
bien qu'elle n'aboutit que lorsque Nextcloud Office est installé à côté, et répond sinon « le
fichier n'a pas pu être converti ». Aucun de ces chemins ne demande de secret supplémentaire. Le
`.docx` est déposé dans un dossier de travail caché,
converti, puis retiré dans tous les cas. Une conversion qui échoue laisse partir le `.docx` et note
l'erreur sur le modèle : un service qui reçoit le mauvais format peut travailler, un service qui ne
reçoit rien est bloqué sans le savoir. `POST /api/nextcloud/test-pdf` vérifie tout cela sur un vrai
document témoin.

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
GET    /api/green-spaces/:id/elements      # Liste filtrable (?search=, ?element_type=)
POST   /api/green-spaces/:id/elements      # Ajouter un élément libre (hors parc)
PUT    /api/green-spaces/elements/:eid     # Modifier un élément
DELETE /api/green-spaces/elements/:eid     # Supprimer un élément
POST   /api/green-spaces/elements/:eid/replace  # Remplacer, en archivant l'état précédent
GET    /api/green-spaces/elements/:eid/history  # Historique des remplacements
GET    /api/green-spaces/:id/replacement-history # Tous les remplacements de l'espace

# Implantation depuis le parc
GET    /api/green-spaces/parc/catalogue    # Matériel implantable (lots et exemplaires, prix unitaire, déjà implanté)
POST   /api/green-spaces/:id/implantations # Poser plusieurs matériels d'un coup, prix figé à la pose

# Coûts
GET    /api/green-spaces/couts             # Synthèse : par espace, par nature de lieu, par variété, par année
GET    /api/green-spaces/:id/couts         # Détail d'un espace : par groupe, type, variété, année

# Annotations (repères du plan)
POST   /api/green-spaces/:id/annotations   # Ajouter un repère
PUT    /api/green-spaces/annotations/:aid  # Modifier un repère (partiel : ce qu'on n'envoie pas ne bouge pas)
DELETE /api/green-spaces/annotations/:aid  # Supprimer un repère

# Matériel implantable — ce que le parc propose aux espaces verts
GET    /api/green-spaces/materiel-implantable/tree     # Arbre des catégories, avec leur réglage
GET    /api/green-spaces/materiel-implantable/objects  # Matériels d'une catégorie (?category_id=)
GET    /api/green-spaces/materiel-implantable/search   # Chercher dans tout le parc (?q=)
PUT    /api/green-spaces/materiel-implantable/:niveau/:id  # Régler category | subcategory | object

# Groupes de composition
POST   /api/green-spaces/:id/groups        # Ajouter un groupe
PUT    /api/green-spaces/groups/:gid       # Modifier un groupe (partiel)
PUT    /api/green-spaces/groups/:gid/elements # Fixer la composition du groupe
DELETE /api/green-spaces/groups/:gid       # Supprimer un groupe (les éléments sont détachés)

# Suivi saisonnier
POST   /api/green-spaces/:id/seasons       # Ajouter une saison
PUT    /api/green-spaces/seasons/:sid      # Modifier une saison
DELETE /api/green-spaces/seasons/:sid      # Supprimer une saison

# Documents
POST   /api/green-spaces/:id/documents     # Ajouter un document
DELETE /api/green-spaces/documents/:did    # Supprimer un document

# Entretiens
POST   /api/green-spaces/:id/maintenances  # Ajouter un entretien
PUT    /api/green-spaces/maintenances/:mid # Modifier un entretien
DELETE /api/green-spaces/maintenances/:mid # Supprimer un entretien

# Référentiels — tous en lecture seule côté agent, CRUD côté superviseur
GET    /api/green-spaces/types             # Types d'espaces (référence figée)
GET    /api/green-spaces/element-types      # Types d'éléments
GET    /api/green-spaces/maintenance-types  # Types d'entretien par défaut
GET    /api/green-spaces/doc-types          # Types de documents
POST   /api/green-spaces/doc-types          # Créer un type de document
PUT    /api/green-spaces/doc-types/:id      # Modifier un type
DELETE /api/green-spaces/doc-types/:id      # Supprimer un type
GET    /api/green-spaces/custom-maintenance-types     # Types d'entretien personnalisés
POST   /api/green-spaces/custom-maintenance-types     # Créer
PUT    /api/green-spaces/custom-maintenance-types/:id # Modifier
DELETE /api/green-spaces/custom-maintenance-types/:id # Supprimer
GET    /api/green-spaces/group-types        # Types de groupes de composition
POST   /api/green-spaces/group-types        # Créer  (PUT et DELETE /:id existent aussi)
GET    /api/green-spaces/space-types        # Types d'espaces, éditables par la commune
GET    /api/green-spaces/space-statuses     # Statuts d'espaces, éditables par la commune
GET    /api/green-spaces/search/objects     # Recherche libre dans le parc (?q=)

# Clonage & Archives
POST   /api/green-spaces/:id/clone         # Cloner un espace vert
POST   /api/green-spaces/:id/snapshots     # Créer un snapshot
GET    /api/green-spaces/:id/snapshots     # Liste des snapshots
GET    /api/green-spaces/snapshots/:sid    # Détail d'un snapshot
DELETE /api/green-spaces/snapshots/:sid    # Supprimer un snapshot
GET    /api/green-spaces/:id/archives      # Archives (snapshots + données source si cloné)
```

### Cartographie — implantations

Un **modèle** vit dans le parc (`/api/objects`), ses **exemplaires** vivent ici.

Les routes de **lecture** couvrent les deux gisements — `street_furniture` pour
la voie publique, `green_space_elements` pour les espaces verts — et rendent une
forme unique : un banc est un banc, qu'il soit sur un trottoir ou dans un parc.
Les routes d'**écriture** ne touchent que la voie publique ; un élément d'espace
vert se modifie dans son module, qui connaît son plan, ses surfaces et ses coûts.

Toutes les lectures appliquent la portée par catégorie du compte ; toutes les
écritures vérifient en plus que l'administrateur a ouvert ce matériel à la pose.

```
# Lecture — les deux gisements
GET    /api/mobilier-urbain                # Implantations, filtrées (voir ci-dessous)
GET    /api/mobilier-urbain/export         # Les mêmes lignes (?avec_interventions=1) pour le PDF
GET    /api/mobilier-urbain/objets/:objectId # Toutes les implantations d'un modèle, où qu'elles soient
GET    /api/mobilier-urbain/element/:eid   # Un élément d'espace vert vu de la carte
POST   /api/mobilier-urbain/element/:eid/interventions  # Consigner un entretien dessus (geste de terrain)
GET    /api/mobilier-urbain/stats          # Total, voirie, espaces verts, modèles, rues, à reprendre,
                                           #   en retard, et ce que la carte ne peut pas montrer
GET    /api/mobilier-urbain/facettes       # Rues, zones, modèles, catégories et espaces verts, avec effectifs

# Écriture — voie publique seulement
GET    /api/mobilier-urbain/:id            # Un exemplaire, son contenu et son historique
POST   /api/mobilier-urbain                # Poser (modèle + position, ou modèle + parent_id)
PUT    /api/mobilier-urbain/:id            # Modifier, déplacement compris (le modèle n'est pas modifiable)
DELETE /api/mobilier-urbain/:id            # Supprimer (superviseur ; préférer le statut « déposé »)

# Interventions — ce qui n'est arrivé qu'à cet exemplaire
POST   /api/mobilier-urbain/:id/interventions             # Consigner (état et prochaine échéance compris)
PUT    /api/mobilier-urbain/interventions/:iid            # Corriger
DELETE /api/mobilier-urbain/interventions/:iid            # Retirer (superviseur)

# Poser, documenter
GET    /api/mobilier-urbain/catalogue       # Modèles posables (?q=), avec le nombre déjà posé et implanté
GET    /api/mobilier-urbain/referentiels    # Statuts, états, gisements, sources de position, interventions
GET    /api/mobilier-urbain/fonds           # Fonds de carte (photo IGN, plan IGN, OSM)

# Quel parc se pose sur la voie publique (superviseur)
GET    /api/mobilier-urbain/materiel-voie-publique/tree          # Arbre des catégories et leur réglage
GET    /api/mobilier-urbain/materiel-voie-publique/objects       # Matériels d'une catégorie (?category_id=)
GET    /api/mobilier-urbain/materiel-voie-publique/search        # Recherche dans tout le parc (?q=)
PUT    /api/mobilier-urbain/materiel-voie-publique/:niveau/:id   # Régler (category | subcategory | object)
```

**Filtres de `GET /` et `GET /export`**, tous facultatifs et combinables :
`q`, `source` (`voirie` | `espace_vert`, vide pour les deux), `category_id`,
`subcategory_id`, `object_id`, `green_space_id` (listes séparées par des
virgules), `status`, `condition_state`, `street`, `sector`,
`bbox=minLat,minLng,maxLat,maxLng`, `pose_du`, `pose_au`, `echeance_avant`,
`en_retard=1`, `jamais_entretenu=1`, `avec_deposes=1`, `lat`/`lng`/`rayon`
(« autour de moi », en mètres — la distance est rendue avec chaque ligne),
`limit`.

Chaque ligne porte une `cle` unique tous gisements confondus (`voirie-12`,
`espace_vert-45`), son `lieu` (« Voie publique » ou le nom du parc) et sa
`precision_position` : `exacte` (relevée ou pointée), `plan` (calculée depuis le
cadrage du plan capturé de son espace vert), `espace` (repli sur la position du
parc — « quelque part par là ») ou `inconnue` (listée, mais pas cartographiable).

**Rue et zone ne concernent que la voie publique** : un élément de parc n'a pas
de rue, il a un parc. Le mobilier **déposé** est exclu par défaut — il sort de la
carte sans perdre son historique ; `avec_deposes=1` le ramène.

### Calendrier

```
GET    /api/calendar/events   # Liste des événements (filtrée par les droits du compte)
POST   /api/calendar/events   # Créer un événement
PUT    /api/calendar/:id      # Modifier un événement
DELETE /api/calendar/:id      # Supprimer un événement

# Agendas externes — qui reçoit quoi (superviseur)
GET    /api/calendar/agendas              # Les carnets configurés, sans leurs secrets
GET    /api/calendar/agendas/vocabulaire  # Natures d'échéances et sens de synchronisation
POST   /api/calendar/agendas              # Ajouter un carnet
PUT    /api/calendar/agendas/:id          # Modifier (un secret en pastilles reste inchangé)
DELETE /api/calendar/agendas/:id          # Retirer (ce qui est déjà déposé là-bas y reste)
POST   /api/calendar/agendas/:id/test     # Le serveur répond-il, et accepte-t-il les identifiants ?
GET    /api/calendar/agendas/:id/apercu   # Ce que l'envoi ferait, sans rien envoyer
POST   /api/calendar/agendas/:id/sync     # Faire passer ce carnet seul

GET    /api/calendar/sync/status          # État des carnets au dernier passage
POST   /api/calendar/sync                 # Faire passer tous les carnets actifs
```

Un carnet reçoit un événement quand **sa nature** est cochée (ou qu'aucune ne
l'est) **et** que **la catégorie** du matériel concerné l'est (ou qu'aucune ne
l'est). Ce qui ne désigne aucun matériel — une tonte de parc, un rendez-vous
saisi à la main — passe ou non selon `include_uncategorized`. Un événement
**importé** n'est jamais réexporté : la boucle recopierait indéfiniment les
mêmes rendez-vous d'un agenda à l'autre.

### Bâtiments — contrôles et documents

```
GET    /api/batiments                        # Bâtiments consultés, avec l'état de leurs contrôles
GET    /api/batiments/a-valider              # Documents en attente, dans les bâtiments gérés
GET    /api/batiments/rubriques              # Catalogue des objets (?toutes=true : désactivés compris)
POST   /api/batiments/rubriques              # Ajouter un objet (gestionnaire de tous les lieux)
PUT    /api/batiments/rubriques/:id          # Périodicité, rappel, libellé, activation
POST   /api/batiments/rubriques/:id/appliquer # Suivre cet objet partout ({ tous: true }) ou dans { siteIds }
GET    /api/batiments/:id                    # Un bâtiment et ses pièces
GET    /api/batiments/:id/suivis             # État des contrôles : dernière réalisation, échéance, statut
POST   /api/batiments/:id/suivis             # Suivre un contrôle (gestionnaire du bâtiment)
PUT    /api/batiments/suivis/:id             # Régler un suivi (périodicité et rappel propres, échéance initiale)
GET    /api/batiments/:id/documents          # Documents (?statut=a_valider|valide|refuse&rubrique=&q=)
POST   /api/batiments/:id/documents          # Déposer (multipart, champ « fichier ») — validé si gestionnaire
POST   /api/batiments/documents/:id/valider  # Valider en reclassant ; le document fait foi pour l'échéance
POST   /api/batiments/documents/:id/refuser  # Refuser, { motif } renvoyé au déposant
GET    /api/batiments/documents/:id/fichier  # Le fichier — jamais mis en cache
GET    /api/batiments/:id/etages             # Étages, plans et pièces (zones, surfaces, matériel)
POST   /api/batiments/etages/:id/plan        # Poser le plan (image ; un PDF est converti côté navigateur)
POST   /api/batiments/etages/:id/pieces      # Créer une pièce depuis un contour tracé
PUT    /api/batiments/pieces/:id/zone        # Redessiner ou effacer le contour d'une pièce
GET    /api/batiments/pieces/:id             # Fiche : matériel, clés qui l'ouvrent, portes, documents
POST   /api/batiments/pieces/:id/materiels   # Poser un matériel (un unique se déplace, un lot se répartit)
GET    /api/batiments/materiels/:objectId/pieces # Où se trouve ce matériel
PUT    /api/batiments/:id/surface            # Surface du bâtiment, pour les ratios au m²
GET    /api/batiments/:id/compteurs          # Compteurs d'énergie et leur dernier relevé
POST   /api/batiments/compteurs/:id/releves  # Noter un relevé (refusé s'il recule)
GET    /api/batiments/:id/factures           # Factures (?annee=&energie=)
POST   /api/batiments/:id/factures           # Saisir une facture (période, consommation, montants ; négatif = avoir)
GET    /api/batiments/:id/energie/synthese   # Coût et consommation par énergie, comparés à N-1 (?annee=)
GET    /api/batiments/statistiques           # Coûts par catégorie, période, bâtiment (?debut=&fin=&granularite=&comparaison=&sites=&categories=&energies=)
GET    /api/batiments/contrats               # Contrats des bâtiments suivis, avec leur date clé (?site=)
POST   /api/batiments/contrats               # Ajouter un contrat sur { siteIds } — tous gérés
GET    /api/batiments/:id/interventions      # Interventions (?piece=&annee=&nature=)
POST   /api/batiments/:id/interventions      # Noter une intervention
```

**Entreprises** (gestionnaire de tous les lieux) et **portail** (session `X-Session-Portail`, sans compte) :

```
GET    /api/entreprises                      # Entreprises et état de leur accès
POST   /api/entreprises                      # Créer (nom, email obligatoires)
PUT    /api/entreprises/:id/contacts         # Remplacer les contacts
PUT    /api/entreprises/:id/droits           # { sites: [..], rubriques: [{ rubriqueId, lecture, depot }] }
POST   /api/entreprises/:id/acces            # Nouveau code (rendu une fois) et envoi { envoyer, inclureCode }
PUT    /api/entreprises/:id/acces            # { fin, suspendu }
POST   /api/portail/:lien/connexion          # { code } → jeton de session (8 h)
GET    /api/portail/moi                      # Bâtiments, objets ouverts, échéances à venir
GET    /api/portail/documents                # Documents validés ouverts en lecture, et ses dépôts
POST   /api/portail/documents                # Déposer (multipart) — en attente de validation
```

Les fichiers ne passent jamais par `/uploads`, qui refuse `uploads/prive/` quelle que soit l'écriture du chemin. Derrière un autre reverse proxy que le nginx fourni, relevez la taille des envois (`client_max_body_size 30m;` ou équivalent) : par défaut, un rapport de plus de 1 Mo est refusé avant d'atteindre l'application.

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

# Utilisateurs et personnes — le superviseur n'y voit que les personnes sans compte
GET    /api/users             # Liste ; ?canLogin=1 les comptes, ?canLogin=0 les fiches
GET    /api/users/annuaire    # Noms seuls, pour désigner quelqu'un
POST   /api/users             # Créer ; canLogin:false = une personne, un nom suffit
PUT    /api/users/:id         # Modifier, accorder ou retirer la connexion
DELETE /api/users/:id         # Supprimer, ou désactiver si des traces existent

# Sauvegardes
GET    /api/backup            # Liste des sauvegardes
POST   /api/backup            # Créer une sauvegarde
GET    /api/backup/:id        # Télécharger
POST   /api/backup/:id/restore # Restaurer
DELETE /api/backup/:id        # Supprimer

# Migration
POST   /api/backup/migrate    # Migrer vers MySQL
```
