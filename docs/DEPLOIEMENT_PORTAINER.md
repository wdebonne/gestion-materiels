# Déploiement sur Portainer via Git

Ce guide explique comment déployer l'application **Gestion Matériels** sur Portainer en utilisant le dépôt Git.

## Prérequis

- Portainer installé et accessible
- Docker et Docker Compose sur le serveur
- Accès au dépôt Git : `https://github.com/wdebonne/gestion-materiels`

---

## Méthode 1 : Stack depuis Git (Recommandée)

### Étape 1 : Accéder à Portainer

1. Ouvrez votre interface Portainer (ex: `https://votre-serveur:9443`)
2. Connectez-vous avec vos identifiants
3. Sélectionnez votre environnement Docker

### Étape 2 : Créer une nouvelle Stack

1. Dans le menu latéral, cliquez sur **Stacks**
2. Cliquez sur **+ Add stack**
3. Donnez un nom à votre stack : `gestion-materiels`

### Étape 3 : Configurer le dépôt Git

1. Sélectionnez **Repository** comme méthode de build
2. Remplissez les informations :

| Champ | Valeur |
|-------|--------|
| **Repository URL** | `https://github.com/wdebonne/gestion-materiels` |
| **Repository reference** | `refs/heads/main` |
| **Compose path** | `docker-compose.yml` |

> Pour un déploiement sur MySQL plutôt que SQLite, indiquez `docker-compose.mysql.yml` comme **Compose path**. Cette pile lance son propre serveur MySQL et exige trois variables supplémentaires : `MYSQL_ROOT_PASSWORD`, `MYSQL_APP_PASSWORD` et `JWT_SECRET`. Elle refuse de démarrer sans elles.

3. Si le dépôt est privé, cochez **Authentication** et entrez vos identifiants GitHub

### Étape 4 : Variables d'environnement

Ajoutez les variables d'environnement nécessaires :

```env
# Base de données et sécurité
JWT_SECRET=votre_secret_jwt_tres_securise_minimum_32_caracteres
NODE_ENV=production

# Configuration serveur
PORT=3001

# Email (optionnel)
SMTP_HOST=smtp.exemple.com
SMTP_PORT=587
SMTP_USER=user@exemple.com
SMTP_PASS=motdepasse
SMTP_FROM=noreply@exemple.com
```

### Étape 5 : Déployer

1. Cliquez sur **Deploy the stack**
2. Attendez que les conteneurs soient créés et démarrés
3. L'application sera accessible sur le port configuré (par défaut : 80)

---

## Méthode 2 : Stack manuelle avec docker-compose.yml

Si vous préférez copier le fichier docker-compose directement :

### Étape 1 : Créer la Stack

1. Dans **Stacks** > **+ Add stack**
2. Sélectionnez **Web editor**
3. Collez le contenu suivant :

```yaml
version: '3.8'

services:
  app:
    build: .
    container_name: gestion-materiels
    restart: unless-stopped
    ports:
      - "${PORT:-3001}:3001"
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
      - ./backups:/app/backups
      - ./plugins:/app/plugins
    environment:
      - NODE_ENV=production
      - JWT_SECRET=${JWT_SECRET}
      - PORT=3001
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  nginx:
    image: nginx:alpine
    container_name: gestion-materiels-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - app

volumes:
  data:
  uploads:
  backups:
  plugins:
```

---

## Méthode 3 : Déploiement avec GitOps (Auto-update)

Pour activer les mises à jour automatiques depuis Git :

### Configuration

1. Dans les paramètres de la stack, activez **GitOps updates**
2. Configurez :

| Option | Valeur recommandée |
|--------|-------------------|
| **Polling interval** | `5m` (5 minutes) |
| **Pull and redeploy** | ✅ Activé |
| **Force update** | ❌ Désactivé (sauf si nécessaire) |

### Fonctionnement

- Portainer vérifie le dépôt Git toutes les 5 minutes
- Si un nouveau commit est détecté, la stack est automatiquement redéployée
- Les volumes de données sont préservés

---

## Configuration SSL/HTTPS

### Option 1 : Certificats Let's Encrypt (via Portainer)

Si vous utilisez Portainer avec un reverse proxy intégré :

1. Allez dans **Settings** > **SSL certificate**
2. Activez Let's Encrypt
3. Entrez votre domaine

### Option 2 : Certificats manuels

1. Placez vos certificats dans `nginx/ssl/` :
   - `cert.pem` - Certificat
   - `key.pem` - Clé privée

2. Modifiez `nginx/nginx.conf` pour activer HTTPS

---

## Volumes et Persistance

Les données importantes sont stockées dans des volumes Docker :

| Volume | Contenu | Importance |
|--------|---------|------------|
| `data/` | Base de données SQLite | ⚠️ Critique |
| `uploads/` | Images et fichiers uploadés | ⚠️ Critique |
| `backups/` | Sauvegardes automatiques | Important |
| `plugins/` | Plugins installés | Important |

### Sauvegarde des volumes

```bash
# Depuis le serveur Docker
docker run --rm -v gestion-materiels_data:/data -v $(pwd):/backup alpine tar czf /backup/data-backup.tar.gz /data
```

---

## Mise à jour manuelle

Pour mettre à jour l'application :

### Via l'interface Portainer

1. Allez dans **Stacks** > `gestion-materiels`
2. Cliquez sur **Pull and redeploy**
3. Cliquez sur **Update**

> Inutile de cocher **Re-pull image** : l'image de l'application n'est publiée sur aucun registre, elle se construit depuis le `Dockerfile` du dépôt. Les deux fichiers compose la déclarent `pull_policy: build` pour que Portainer ne parte pas la chercher sur Docker Hub — voir le dépannage ci-dessous.

### Via ligne de commande

```bash
# Sur le serveur
cd /chemin/vers/stack
git pull origin main
docker-compose up -d --build
```

---

## Dépannage

### « pull access denied for gestion-materiels-app »

```
failed to pull images of the stack: compose pull operation failed:
Error response from daemon: pull access denied for gestion-materiels-app,
repository does not exist or may require 'docker login'
```

Portainer lance `docker compose pull` avant de redéployer. L'image de l'application n'existe sur aucun registre : elle se construit depuis le `Dockerfile` du dépôt. Compose la cherche donc sur Docker Hub, ne l'y trouve pas, et la mise à jour s'arrête avant même de commencer.

Les deux fichiers compose déclarent `pull_policy: build` : Compose saute cette image au lieu de tenter de la télécharger. Si la stack déployée est plus ancienne que ce correctif, la mise à jour qui l'apporte doit se faire **sans** cocher « Re-pull image » ; les suivantes n'en auront plus besoin.

### Les conteneurs ne démarrent pas

```bash
# Voir les logs
docker logs gestion-materiels

# Ou via Portainer : Containers > gestion-materiels > Logs
```

### Health check "unhealthy" avec erreur SSL

Si le container affiche un statut "unhealthy" avec une erreur SSL comme :
```
SSL routines:packet length too long
```

Cela signifie que le health check HTTP est redirigé vers HTTPS. Ce problème a été corrigé dans la version 1.2.40+. Si vous utilisez une version antérieure :

1. Mettez à jour vers la dernière version
2. Reconstruisez l'image : `docker-compose build --no-cache`
3. Redémarrez : `docker-compose up -d`

### Erreur de permission sur les volumes

```bash
# Corriger les permissions
docker exec gestion-materiels chown -R node:node /app/data /app/uploads
```

### La base de données est corrompue

1. Arrêtez la stack
2. Restaurez depuis une sauvegarde :
```bash
cp backups/backup-YYYYMMDD.sqlite data/database.sqlite
```
3. Redémarrez la stack

### Port déjà utilisé

Modifiez le port dans les variables d'environnement ou le docker-compose :
```yaml
ports:
  - "8080:3001"  # Utilisez 8080 au lieu de 3001
```

---

## Accès à l'application

Une fois déployée, l'application est accessible :

- **URL** : `http://votre-serveur` ou `https://votre-serveur`
- **Compte admin par défaut** :
  - Email : `admin@admin.com`
  - Mot de passe : `admin123`

⚠️ **Important** : Changez le mot de passe admin dès la première connexion !

---

## Ressources

- [Documentation Portainer](https://docs.portainer.io/)
- [Dépôt GitHub](https://github.com/wdebonne/gestion-materiels)
- [Docker Compose Reference](https://docs.docker.com/compose/compose-file/)
