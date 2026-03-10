# Structure des Plugins

## Vue d'ensemble

L'application utilise un système de plugins extensible avec deux catégories :

### Plugins système (built-in)
Plugins intégrés à l'application avec des pages React dédiées, mais gérés comme des plugins activables/désactivables depuis **Paramètres > Plugins**.

| Plugin | Slug | Route | Description |
|--------|------|-------|-------------|
| Calendrier | `calendar` | `/calendar` | Planning et événements |
| Réservations | `reservations` | `/reservations` | Gestion des prêts de matériel |
| Amortissement | `depreciation` | `/depreciation` | Dépréciation et valeur résiduelle |
| Cartographie | `map` | `/map` | Carte interactive Leaflet |
| Import / Export | `import-export` | `/import-export` | Import/Export CSV et Excel |

### Plugins personnalisés (ZIP)
Plugins importables via fichier ZIP avec pages dynamiques JSON et API configurables.

## Format du fichier ZIP

Un plugin personnalisé doit être fourni sous forme de fichier ZIP contenant :

```
mon-plugin.zip
├── plugin.json          # Configuration du plugin (obligatoire)
├── pages/               # Pages du plugin (pour type "menu")
│   ├── index.json       # Page principale
│   └── detail.json      # Pages supplémentaires (optionnel)
└── icon.svg             # Icône personnalisée (optionnel)
```

## Fichier plugin.json

```json
{
  "name": "Gestion des Images",
  "slug": "image-manager",
  "version": "1.0.0",
  "description": "Gérez toutes les images de l'application",
  "author": "Admin",
  "icon": "Image",
  "type": "menu",
  "route": "images",
  "config": {
    "maxFileSize": 10,
    "allowedTypes": ["image/jpeg", "image/png", "image/webp"]
  },
  "database": {
    "tables": [
      {
        "name": "plugin_images",
        "columns": [
          { "name": "id", "type": "INTEGER", "primaryKey": true, "autoIncrement": true },
          { "name": "filename", "type": "VARCHAR(255)", "notNull": true },
          { "name": "original_name", "type": "VARCHAR(255)", "notNull": true },
          { "name": "mime_type", "type": "VARCHAR(100)" },
          { "name": "size", "type": "INTEGER" },
          { "name": "category_id", "type": "INTEGER", "foreignKey": { "table": "categories", "column": "id", "onDelete": "SET NULL" } },
          { "name": "subcategory_id", "type": "INTEGER", "foreignKey": { "table": "subcategories", "column": "id", "onDelete": "SET NULL" } },
          { "name": "object_id", "type": "INTEGER", "foreignKey": { "table": "objects", "column": "id", "onDelete": "SET NULL" } },
          { "name": "created_at", "type": "DATETIME", "default": "CURRENT_TIMESTAMP" },
          { "name": "created_by", "type": "INTEGER" }
        ]
      }
    ]
  },
  "api": {
    "endpoints": [
      {
        "method": "GET",
        "path": "/list",
        "query": "SELECT * FROM plugin_images ORDER BY created_at DESC",
        "description": "Liste toutes les images"
      },
      {
        "method": "GET",
        "path": "/by-category/:categoryId",
        "query": "SELECT * FROM plugin_images WHERE category_id = :categoryId",
        "description": "Images par catégorie"
      },
      {
        "method": "POST",
        "path": "/upload",
        "action": "upload",
        "table": "plugin_images",
        "description": "Upload une image"
      },
      {
        "method": "DELETE",
        "path": "/:id",
        "query": "DELETE FROM plugin_images WHERE id = :id",
        "description": "Supprime une image"
      }
    ]
  },
  "pages": {
    "index": {
      "title": "Gestion des Images",
      "layout": "grid",
      "components": [
        {
          "type": "header",
          "title": "Bibliothèque d'images",
          "actions": [
            { "label": "Importer", "action": "upload", "icon": "Upload", "variant": "primary" }
          ]
        },
        {
          "type": "filters",
          "fields": [
            { "name": "category", "label": "Catégorie", "type": "select", "source": "categories" },
            { "name": "search", "label": "Rechercher", "type": "text", "placeholder": "Nom du fichier..." }
          ]
        },
        {
          "type": "dataGrid",
          "source": "/api/plugins/image-manager/list",
          "columns": [
            { "field": "preview", "type": "image", "width": 100 },
            { "field": "original_name", "label": "Nom", "sortable": true },
            { "field": "size", "label": "Taille", "format": "filesize" },
            { "field": "created_at", "label": "Date", "format": "date" }
          ],
          "actions": [
            { "icon": "Eye", "action": "preview", "tooltip": "Aperçu" },
            { "icon": "Download", "action": "download", "tooltip": "Télécharger" },
            { "icon": "Trash2", "action": "delete", "tooltip": "Supprimer", "confirm": true }
          ]
        }
      ]
    }
  }
}
```

## Types de composants disponibles

### header
Affiche un en-tête avec titre et boutons d'action.

### filters
Affiche des filtres pour la recherche/filtrage des données.

### dataGrid
Affiche une grille de données avec colonnes configurables.

### dataTable
Affiche un tableau de données classique.

### form
Affiche un formulaire pour créer/éditer des entrées.

### stats
Affiche des statistiques/compteurs.

### chart
Affiche un graphique (nécessite chart.js).

## Types de champs pour les filtres/formulaires

- `text`: Champ texte simple
- `number`: Champ numérique
- `select`: Liste déroulante
- `multiselect`: Sélection multiple
- `date`: Sélecteur de date
- `file`: Upload de fichier
- `image`: Upload d'image avec aperçu
- `textarea`: Zone de texte multiligne
- `checkbox`: Case à cocher
- `radio`: Boutons radio

## Actions disponibles

- `upload`: Ouvre un dialogue d'upload
- `download`: Télécharge le fichier
- `preview`: Affiche un aperçu
- `delete`: Supprime l'élément (avec confirmation)
- `edit`: Ouvre le formulaire d'édition
- `custom`: Action personnalisée (nécessite un handler)

## Plugins système built-in

Les plugins système utilisent des pages React dédiées tout en étant enregistrés dans la table `plugins` de la base de données. Ils possèdent aussi des fichiers `plugin.json` et `index.json` dans `plugins/pages/`.

### Structure des dossiers

```
plugins/pages/
├── reservations/
│   ├── plugin.json        # Configuration du plugin
│   └── index.json         # Définition de la page principale
├── depreciation/
│   ├── plugin.json
│   └── index.json
├── map/
│   ├── plugin.json
│   └── index.json
├── import-export/
│   ├── plugin.json
│   └── index.json
├── image-manager/         # Plugin personnalisé (exemple)
│   └── index.json
└── file-manager/          # Plugin personnalisé (exemple)
    └── index.json
```

### Navigation dynamique

La sidebar charge les plugins actifs via `GET /api/plugins/menu`. Les plugins système sont routés directement (`/reservations`, `/map`, etc.) tandis que les plugins personnalisés passent par `/plugin/:slug`.

```typescript
// Layout.tsx
const builtInPluginSlugs = ['calendar', 'reservations', 'depreciation', 'map', 'import-export']
const pluginNavigation = menuPlugins.map((plugin) => ({
  name: plugin.name,
  href: builtInPluginSlugs.includes(plugin.slug)
    ? `/${plugin.route || plugin.slug}`
    : `/plugin/${plugin.slug}`,
  icon: iconMap[plugin.icon] || Plug
}))
```

### Activation / Désactivation

Depuis **Paramètres > Plugins**, un administrateur peut activer ou désactiver chaque plugin système. Lorsqu'un plugin est désactivé :
- Il disparaît de la sidebar
- Sa route reste définie mais n'est plus accessible via la navigation
- Les données associées sont conservées
