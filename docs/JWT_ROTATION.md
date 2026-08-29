# 🔐 Guide de Rotation des Secrets JWT

**Date de création** : 6 février 2026  
**Révision** : 29 août 2026  
**Projet** : Gestion Matériels

---

## 📋 Vue d'ensemble

Ce document décrit la procédure de rotation des secrets JWT implémentée dans l'application Gestion Matériels. La rotation régulière des secrets JWT est une bonne pratique de sécurité qui limite l'impact d'une éventuelle compromission de clé.

---

## 🏗️ Architecture

### Composants

1. **Service de rotation** (`src/services/jwtRotation.service.ts`)
   - Génération de secrets cryptographiquement sécurisés
   - Gestion de la période de grâce
   - Nettoyage automatique des anciens secrets

2. **API d'administration** (`src/routes/security.routes.ts`)
   - Endpoints REST pour la gestion des rotations
   - Accessible uniquement aux administrateurs

3. **Table de stockage** (`jwt_secrets`)
   - Historique des secrets
   - Dates de création et d'expiration

---

## ⚙️ Configuration

### Paramètres par défaut

| Paramètre | Valeur par défaut | Description |
|-----------|-------------------|-------------|
| `rotationIntervalDays` | 90 | Intervalle entre les rotations |
| `gracePeriodHours` | 24 | Période de grâce avec l'ancien secret |
| `autoRotate` | false | Rotation automatique (désactivée par défaut) |

### Variables d'environnement

```env
# Secret JWT principal (OBLIGATOIRE en production, 32 caractères minimum)
JWT_SECRET=votre_secret_tres_securise_64_caracteres_minimum

# Durée de validité des tokens
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# Confiance aux proxies (pour rate limiting)
TRUST_PROXY=true
```

> **Depuis août 2026**, le secret est résolu par `getJwtSecret()` (`src/config/secrets.ts`) et non plus par `process.env.JWT_SECRET || 'secret'`. En production, le serveur **refuse de démarrer** si le secret est absent, fait moins de 32 caractères, ou correspond à une valeur d'exemple. En développement, un secret de repli est utilisé avec un avertissement en console.
>
> Le jeton de rafraîchissement est signé avec **le même** secret : `JWT_REFRESH_SECRET`, présent dans `docker-compose.yml`, n'est lu par aucun code. Une rotation change donc les deux jetons ensemble.

---

## 🔄 Procédure de rotation manuelle

### Via l'API (recommandé)

```bash
# 1. Effectuer la rotation
curl -X POST https://votre-domaine.com/api/security/jwt/rotate \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Rotation trimestrielle planifiée"}'

# 2. Récupérer le nouveau secret depuis les logs serveur

# 3. Mettre à jour le fichier .env avec le nouveau JWT_SECRET

# 4. Redémarrer l'application (après la période de grâce si souhaité)
```

### Via le script (alternative)

```bash
# Dans le répertoire du projet
npm run jwt:rotate
```

---

## 📊 API de Sécurité

### GET /api/security/jwt/status

Retourne un rapport complet sur l'état de la rotation JWT.

**Réponse** :
```json
{
  "success": true,
  "activeSecretsCount": 1,
  "expiredSecretsCount": 0,
  "lastRotation": "2026-02-06T10:00:00.000Z",
  "nextRotation": "2026-05-06T10:00:00.000Z",
  "autoRotateEnabled": false,
  "rotationIntervalDays": 90,
  "gracePeriodHours": 24,
  "recommendations": [
    "Envisagez d'activer la rotation automatique des secrets JWT"
  ]
}
```

### GET /api/security/jwt/settings

Retourne les paramètres actuels de rotation.

### PUT /api/security/jwt/settings

Met à jour les paramètres de rotation.

**Corps de la requête** :
```json
{
  "rotationIntervalDays": 60,
  "gracePeriodHours": 48,
  "autoRotate": true
}
```

### POST /api/security/jwt/rotate

Déclenche une rotation manuelle.

**Corps de la requête** :
```json
{
  "reason": "Rotation de sécurité suite à incident"
}
```

### GET /api/security/jwt/history

Retourne l'historique des rotations.

### POST /api/security/jwt/cleanup

Supprime les secrets expirés depuis plus de 7 jours.

---

## ⏰ Période de grâce

La période de grâce permet aux utilisateurs connectés de continuer à utiliser leurs tokens existants pendant la transition vers le nouveau secret.

### Fonctionnement

1. **Rotation déclenchée** : Un nouveau secret est généré
2. **Ancien secret marqué** : L'ancien secret reste valide pendant la période de grâce
3. **Fin de la période** : L'ancien secret expire, seul le nouveau est valide
4. **Nettoyage** : Les secrets expirés sont supprimés après 7 jours

### Recommandations

| Contexte | Période de grâce recommandée |
|----------|------------------------------|
| Rotation d'urgence (compromission) | 0-2 heures |
| Rotation planifiée | 24-48 heures |
| Rotation lors de maintenance | 12-24 heures |

---

## 🚨 Rotation d'urgence

En cas de compromission suspectée du secret JWT :

### Étapes immédiates

1. **Déclencher une rotation avec période de grâce courte** :
```bash
curl -X POST https://votre-domaine.com/api/security/jwt/rotate \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"reason": "URGENCE: Compromission suspectée"}'
```

2. **Mettre à jour les paramètres** :
```bash
curl -X PUT https://votre-domaine.com/api/security/jwt/settings \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"gracePeriodHours": 1}'
```

3. **Mettre à jour immédiatement le fichier .env**

4. **Redémarrer l'application**

5. **Auditer les logs** pour identifier toute activité suspecte

---

## 📅 Planification recommandée

### Calendrier de rotation

| Fréquence | Contexte |
|-----------|----------|
| Tous les 30 jours | Environnement haute sécurité |
| Tous les 90 jours | Production standard (recommandé) |
| Tous les 180 jours | Environnements de développement/test |

### Checklist de rotation

- [ ] Sauvegarder le secret actuel
- [ ] Déclencher la rotation via l'API
- [ ] Noter le nouveau secret depuis les logs
- [ ] Mettre à jour le fichier .env (ou le gestionnaire de secrets)
- [ ] Attendre la fin de la période de grâce
- [ ] Redémarrer l'application si nécessaire
- [ ] Vérifier que les utilisateurs peuvent toujours se connecter
- [ ] Archiver les logs de rotation

---

## 🔒 Bonnes pratiques

### Stockage du secret

1. **Ne jamais** commiter le secret dans Git
2. **Utiliser** des gestionnaires de secrets (AWS Secrets Manager, HashiCorp Vault, etc.)
3. **Chiffrer** le fichier .env en production

### Génération du secret

Le service génère automatiquement des secrets de 64 octets (128 caractères hexadécimaux) en utilisant `crypto.randomBytes()`.

Pour générer manuellement un secret sécurisé :
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Monitoring

- Configurer des alertes pour les tentatives de connexion avec des tokens invalides
- Surveiller les logs de la catégorie `security`
- Vérifier régulièrement le rapport `/api/security/jwt/status`

---

## 📝 Logs associés

Les événements de rotation sont loggés avec la catégorie `security` :

| Événement | Niveau | Message |
|-----------|--------|---------|
| Rotation réussie | success | "Rotation du secret JWT effectuée" |
| Paramètres modifiés | info | "Paramètres de rotation JWT modifiés" |
| Nettoyage | info | "Nettoyage des anciens secrets JWT" |
| Erreur de rotation | error | "Erreur lors de la rotation du secret JWT" |

---

## 🔗 Références

- [OWASP JWT Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
- [RFC 7519 - JSON Web Token (JWT)](https://tools.ietf.org/html/rfc7519)
- [NIST SP 800-57 - Key Management Guidelines](https://csrc.nist.gov/publications/detail/sp/800-57-part-1/rev-5/final)

---

*Documentation mise à jour le 06/02/2026*
