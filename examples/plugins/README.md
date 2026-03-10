# Exemples de Plugins

Ce dossier contient des exemples de plugins avancés pour l'application de Gestion des Matériels.

## Types de plugins

### Plugins système (built-in)

Les plugins système sont intégrés à l'application avec des pages React dédiées. Ils sont enregistrés dans la base de données au seed et sont activables/désactivables depuis **Paramètres > Plugins**.

| Plugin | Slug | Route | Description |
|--------|------|-------|-------------|
| Calendrier | `calendar` | `/calendar` | Planning et événements |
| Réservations | `reservations` | `/reservations` | Gestion des réservations et prêts de matériel |
| Amortissement | `depreciation` | `/depreciation` | Dépréciation et valeur résiduelle |
| Cartographie | `map` | `/map` | Carte interactive Leaflet/OpenStreetMap |
| Import / Export | `import-export` | `/import-export` | Import/Export CSV et Excel |

Leurs fichiers de configuration se trouvent dans `plugins/pages/<slug>/` (plugin.json + index.json).

### Plugins personnalisés (ZIP)

Les plugins personnalisés sont importables via fichier ZIP avec des pages dynamiques en JSON et des API configurables.

## Comment créer un plugin personnalisé

1. Créez un dossier avec les fichiers suivants :
   - `plugin.json` : Configuration du plugin (obligatoire)
   - Autres fichiers optionnels (icône, assets)

2. Compressez le dossier en ZIP

3. Importez le ZIP depuis l'interface d'administration (Paramètres > Plugins > Importer Plugin ZIP)

## Structure du fichier plugin.json

```json
{
  "name": "Nom du plugin",
  "slug": "nom-plugin",
  "version": "1.0.0",
  "description": "Description du plugin",
  "author": "Auteur",
  "icon": "NomIcone",  // Nom Lucide React
  "type": "menu",      // "menu" ou "object"
  "route": "chemin",   // Route URL pour type "menu"
  "config": {},        // Configuration personnalisée
  "database": {        // Tables à créer
    "tables": [...]
  },
  "api": {             // Endpoints API
    "endpoints": [...]
  },
  "pages": {           // Pages dynamiques
    "index": {...}
  }
}
```

## Exemples de plugins personnalisés inclus

### 1. image-manager (Gestion des Images)
- Type : Menu
- Permet de gérer une bibliothèque d'images
- Créer une table `plugin_images`
- Affiche une grille d'images avec filtres

### 2. file-manager (Gestionnaire de Fichiers)
- Type : Menu  
- Permet de gérer tous les fichiers uploadés
- Crée les tables `plugin_files` et `plugin_file_folders`
- Affiche un tableau avec tri et filtres

## Pour créer les ZIP

Sur Windows (PowerShell) :
```powershell
Compress-Archive -Path "image-manager\*" -DestinationPath "image-manager.zip" -Force
Compress-Archive -Path "file-manager\*" -DestinationPath "file-manager.zip" -Force
```

Sur Linux/Mac :
```bash
cd image-manager && zip -r ../image-manager.zip . && cd ..
cd file-manager && zip -r ../file-manager.zip . && cd ..
```
