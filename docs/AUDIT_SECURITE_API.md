# 🔒 Rapport d'Audit de Sécurité des API

**Date de l'audit initial** : 6 février 2026  
**Révision** : 29 août 2026  
**Projet** : Gestion Matériels  
**Version auditée** : Branche `main`

> ⚠️ La conclusion de l'audit initial (« score 9,5/10 ») portait sur la protection des routes, qui était effectivement bonne. Elle ne couvrait pas ce que faisaient les contrôles une fois passés. La révision d'août 2026 a trouvé quatre défauts que l'audit de février n'avait pas vus, tous listés plus bas.

---

## 📋 Résumé exécutif

L'audit de sécurité des API a révélé que **la grande majorité des routes sont correctement protégées** par le middleware d'authentification JWT. Un seul point critique a été identifié concernant l'exposition publique du dossier `/uploads`.

| Catégorie | Statut |
|-----------|--------|
| Routes API protégées | ✅ 100% |
| Middleware d'authentification | ✅ Robuste |
| Gestion des rôles | ✅ Implémentée |
| Fichiers statiques | ✅ Protégés par JWT |

---

## 🛡️ Architecture de sécurité

### Middleware d'authentification (`auth.middleware.ts`)

Le middleware implémente les contrôles suivants :

1. **Vérification du token JWT** : Extraction depuis le header `Authorization: Bearer <token>`
2. **Validation cryptographique** : Vérification de la signature JWT
3. **Contrôle d'existence** : Vérification que l'utilisateur existe toujours en base
4. **Contrôle d'état** : Vérification que l'utilisateur est actif (`is_active = 1`)
5. **Gestion des rôles** : Middlewares `requireAdmin` et `requireSupervisor`

```typescript
// Hiérarchie des rôles
admin > supervisor > agent > user
```

Le rôle **agent de terrain** a été ajouté en août 2026. Il ouvre uniquement les écritures du quotidien — relevé de plein, entretien, contrôle technique, entretien d'espace vert, pièce jointe, demande de réservation — via un garde unique `requireFieldWrite`. Le référentiel et toutes les suppressions restent au superviseur.

Avant lui, saisir un plein exigeait le rôle superviseur, qui donnait au passage la suppression des espaces verts, la gestion du stock des manifestations et les seuils d'alerte : la pratique était donc de sur-privilégier les agents.

La matrice complète est figée par `tests/roles.test.ts`, qui vérifie à la fois les gardes et le contrat déclaré de chaque route protégée.

---

## ✅ Routes correctement protégées

### 🔴 Niveau Admin requis (`requireAdmin`)

| Route | Fichier | Description |
|-------|---------|-------------|
| `/api/users/*` | `user.routes.ts` | Gestion des utilisateurs |
| `/api/backup/*` | `backup.routes.ts` | Sauvegardes et restaurations |
| `/api/email-templates/*` | `emailTemplate.routes.ts` | Templates d'emails |
| `/api/permissions/*` | `permission.routes.ts` | Gestion des permissions |
| `/api/webhooks/*` | `webhook.routes.ts` | Configuration des webhooks |
| `/api/logs/*` | `log.routes.ts` | Consultation des logs |
| `PUT /api/settings` | `settings.routes.ts` | Modification des paramètres |
| `DELETE /api/objects/:id` | `object.routes.ts` | Suppression d'objets |
| `DELETE /api/categories/:id` | `category.routes.ts` | Suppression de catégories |

### 🟠 Niveau Supervisor requis (`requireSupervisor`)

| Route | Fichier | Description |
|-------|---------|-------------|
| `POST /api/objects` | `object.routes.ts` | Création d'objets |
| `PUT /api/objects/:id` | `object.routes.ts` | Modification d'objets |
| `POST /api/calendar/events` | `calendar.routes.ts` | Création d'événements |
| `PUT /api/alerts/settings` | `alert.routes.ts` | Configuration des alertes |

### 🔵 Niveau Agent de terrain requis (`requireFieldWrite`)

| Route | Fichier | Description |
|-------|---------|-------------|
| `POST /api/objects/:id/fuel` | `object.routes.ts` | Relevé de plein |
| `POST /api/objects/:id/maintenance` | `object.routes.ts` | Relevé d'entretien |
| `POST /api/objects/:id/technical-control` | `object.routes.ts` | Relevé de contrôle technique |
| `POST /api/green-spaces/:id/maintenances` | `espaceVert.routes.ts` | Entretien d'espace vert |
| `POST /api/upload/*` | `upload.routes.ts` | Pièces jointes |
| `POST /api/reservations` | `reservation.routes.ts` | Demande de réservation (statut forcé à `pending` si non-superviseur) |

### 🟢 Authentification simple (`authenticateToken`)

| Route | Fichier | Description |
|-------|---------|-------------|
| `GET /api/objects/*` | `object.routes.ts` | Lecture des objets |
| `GET /api/categories/*` | `category.routes.ts` | Lecture des catégories |
| `GET /api/calendar/*` | `calendar.routes.ts` | Lecture du calendrier |
| `GET /api/alerts/*` | `alert.routes.ts` | Lecture des alertes |
| `GET /api/dashboard/stats` | `dashboard.routes.ts` | Statistiques |
| `GET /api/plugins/*` | `plugin.routes.ts` | Liste des plugins |
| `GET /api/settings` | `settings.routes.ts` | Lecture des paramètres |
| `/api/upload/*` | `upload.routes.ts` | Upload de fichiers |
| `/api/custom-fields/*` | `customFields.routes.ts` | Champs personnalisés |
| `/api/tracking/*` | `tracking.routes.ts` | Module de suivi |

### 🔓 Routes publiques (intentionnel)

Ces routes doivent rester publiques pour le bon fonctionnement de l'application :

| Route | Raison |
|-------|--------|
| `POST /api/auth/login` | Connexion utilisateur |
| `POST /api/auth/forgot-password` | Récupération de mot de passe |
| `POST /api/auth/reset-password` | Réinitialisation du mot de passe |
| `POST /api/auth/refresh` | Rafraîchissement du token |

---

## ⚠️ Vulnérabilités identifiées

### ✅ ~~Critique : Exposition publique du dossier `/uploads`~~ **CORRIGÉ**

**Localisation** : `src/server.ts`

**Correction appliquée le 06/02/2026** :

```typescript
// Middleware de vérification de token pour les fichiers sensibles
const verifyUploadAccess = (req: Request, res: Response, next: NextFunction): void => {
  // Permettre l'accès aux fichiers publics (logos, favicons, images de catégories)
  const publicPatterns = [/^logo/i, /^favicon/i, /^site_/i];
  const filename = path.basename(req.path);
  
  if (publicPatterns.some(pattern => pattern.test(filename))) {
    return next();
  }

  // Vérifier le token pour les autres fichiers
  // Priorité : Header Authorization > Cookie auth_token > Query parameter
  const authHeader = req.headers['authorization'];
  const tokenFromQuery = req.query.token as string;
  const tokenFromCookie = req.cookies?.auth_token;
  const token = (authHeader && authHeader.split(' ')[1]) || tokenFromCookie || tokenFromQuery;

  if (!token) {
    res.status(401).json({ success: false, message: 'Accès non autorisé' });
    return;
  }

  try {
    // Depuis août 2026 : plus de repli codé en dur, le secret vient de
    // getJwtSecret() qui refuse de démarrer en production s'il est absent,
    // trop court ou laissé à sa valeur d'exemple.
    jwt.verify(token, getJwtSecret());
    next();
  } catch (error) {
    res.status(403).json({ success: false, message: 'Token invalide ou expiré' });
  }
};

app.use('/uploads', verifyUploadAccess, express.static(path.join(__dirname, '../uploads')));
```

**Statut** : ✅ Corrigé  
**Impact résiduel** : Aucun  
**Méthode d'accès** : 
- Token JWT via header `Authorization: Bearer <token>`
- Cookie HttpOnly `auth_token` (pour les balises `<img>` et ressources statiques)
- Paramètre URL `?token=<token>`

---

## 🔍 Contrôles de sécurité additionnels

### ✅ Bonnes pratiques déjà implémentées

| Contrôle | Statut | Détails |
|----------|--------|---------|
| Helmet.js | ✅ | Headers de sécurité HTTP |
| CORS | ✅ | Configuré selon l'environnement |
| Rate limiting | ✅ | `express-rate-limit` avec limiteurs spécifiques |
| Validation des entrées | ✅ | Via `express-validator` |
| Hashage des mots de passe | ✅ | Bcrypt avec 12 rounds |
| Tokens JWT | ✅ | Expiration configurée |
| Logging des actions | ✅ | Service de logs dédié |
| HTTPS forcé | ✅ | Redirection automatique en production |
| Rotation JWT | ✅ | Service de rotation avec période de grâce |
| Secret JWT obligatoire | ✅ | Plus de secret de repli codé en dur ; démarrage refusé en production |
| Portée des tokens API | ✅ | Appliquée depuis août 2026 (voir ci-dessous) |
| SQL des plugins | ✅ | Tables système protégées, écritures interdites |

### ✅ Recommandations implémentées (06/02/2026)

1. ✅ **Rate Limiting** : Implémenté via `express-rate-limit`
   - Global : 1000 req/15min pour l'API
   - Auth : 10 tentatives/15min pour login/register
   - Uploads : 100/heure
   - Exports/Backups : 10/heure
   
2. ✅ **HTTPS forcé** : Middleware de redirection HTTP → HTTPS
   - Actif uniquement en production
   - Support des proxies (X-Forwarded-Proto)
   - Header HSTS avec max-age 1 an
   
3. ✅ **Audit des tokens** : Journalisation complète
   - Connexions réussies et échouées
   - Déconnexions avec métadonnées
   - Rafraîchissements de tokens
   - Changements de mots de passe
   
4. ✅ **Rotation des secrets JWT** : Service complet
   - Rotation manuelle ou automatique
   - Période de grâce configurable (défaut: 24h)
   - Intervalle de rotation (défaut: 90 jours)
   - API d'administration (`/api/security/jwt/*`)

---

## 🔎 Révision d'août 2026 — défauts trouvés après le premier audit

L'audit de février portait sur *quelles routes sont protégées*. Ces défauts concernent *ce que font les contrôles une fois franchis*, et aucun n'était visible depuis la liste des routes.

### 1. Portée des tokens API analysée puis ignorée — **corrigé**

`authenticateApiToken` lisait les permissions du token, les rangeait dans `req.apiTokenPermissions`, et **plus aucune ligne ne les relisait** : zéro référence dans les 25 fichiers de routes. Or un token hérite du rôle complet de son créateur.

Un token créé « lecture seule » par un administrateur pouvait donc supprimer tout ce que cet administrateur pouvait supprimer. L'écran des tokens proposait pourtant trois cases distinctes et affichait la portée sur chaque ligne.

**Correction** : contrôle unique dans `authenticateApiToken`, avant que la requête n'atteigne la moindre route. GET/HEAD/OPTIONS exigent « Lecture », POST/PUT/PATCH « Écriture », DELETE « Suppression » — le découpage annoncé par l'écran. Une méthode inattendue est traitée comme une écriture, jamais comme une lecture. Un JSON corrompu ou une permission inventée ramènent à la lecture seule.

**Vérifié** sur trois tokens créés par un administrateur : lecture seule refusée en POST et en DELETE, lecture+écriture refusée en DELETE. Figé par `tests/apiTokens.test.ts` (10 tests).

### 2. La déconnexion épuisait le limiteur d'authentification — **corrigé**

`logout()` envoyait `POST /auth/logout` puis effaçait l'état. Les intercepteurs axios étant asynchrones, l'état était nul avant que la requête ne parte : elle partait sans en-tête d'autorisation et prenait un 401. Ce 401 déclenchait la reprise de session, qui rappelait `logout()`, qui rappelait `/auth/logout` — une dizaine de requêtes en cascade jusqu'au 429.

Comme `authLimiter` couvre **tout** `/api/auth` à 10 requêtes par quart d'heure, la cascade épuisait le quota : se déconnecter, ou simplement se tromper de mot de passe, **interdisait de se reconnecter pendant 15 minutes**. Sur un poste partagé, cela bloque la personne suivante.

Le limiteur faisait donc exactement son travail, contre l'application elle-même. C'est le type de défaut qu'une revue de la configuration du rate limiting ne peut pas voir.

**Correction** : le jeton est joint explicitement à la requête de déconnexion, et un 401 sur `/auth/logout`, `/auth/refresh` ou `/auth/login` ne déclenche plus de reprise de session — ces routes ne décrivent pas une session à récupérer.

**Mesuré** : déconnexion passée de ~10 requêtes (401 puis 429) à 1 requête en 200 ; mot de passe erroné passé d'une cascade à zéro requête de déconnexion.

### 3. Aucune déconnexion n'était journalisée — **corrigé**

Conséquence du point précédent : `POST /auth/logout` prenant un 401 systématique, la route n'était jamais exécutée. La déconnexion n'était pas enregistrée dans `logs` ni dans `activity_logs`, et le cookie `auth_token` n'était jamais effacé côté serveur.

Le journal d'audit ne contenait donc que des connexions — un défaut de traçabilité invisible tant qu'on ne cherche pas les déconnexions manquantes.

### 4. Politique de mot de passe et blocage jamais appliqués — **corrigé**

L'écran **Paramètres > Authentification** permet de configurer la longueur minimale, la complexité, l'expiration des mots de passe, le blocage après N tentatives échouées, la 2FA obligatoire et le timeout de session.

Aucune de ces règles n'était appliquée : zéro référence dans `auth.routes.ts` et `user.routes.ts`. Un administrateur qui configurait « blocage après 5 tentatives » croyait disposer d'un contrôle qui n'existait pas, et seul le rate limiting global protégeait du bourrinage.

**Correction** : `src/services/passwordPolicy.service.ts` lit la configuration et l'applique.

- **Longueur et complexité** vérifiées aux six endroits où un mot de passe est défini : inscription, réinitialisation, changement, création par un administrateur, changement de son propre mot de passe, réattribution par un administrateur. Les quatre contrôles de longueur codés en dur ont été retirés — ils auraient contredit un minimum configuré différemment.
- **Blocage du compte** après N échecs, pendant la durée configurée, réponse `423`. Ce contrôle protège un compte précis, là où le rate limiting protège l'API dans son ensemble. Le nombre d'essais restants n'est pas révélé : il indiquerait qu'un email existe. Un administrateur débloque en réattribuant un mot de passe, et une réinitialisation réussie débloque aussi.
- **Expiration** signalée à la connexion par un drapeau `passwordExpired`, affiché en bandeau. Elle ne bloque pas : refuser l'accès à un agent en extérieur parce que son mot de passe a 91 jours coûterait plus que cela ne protège. Un compte sans date de changement connue — tous ceux créés avant la migration — n'est jamais déclaré expiré.
- **Configuration illisible** : une valeur absente, d'un type inattendu ou négative retombe sur la valeur par défaut, jamais sur « aucune exigence ».

Colonnes ajoutées par la migration `002_politique_connexion` : `failed_login_attempts`, `locked_until`, `password_changed_at`.

**Trois réglages restent inapplicables** et ont été retirés du formulaire, remplacés par un encart qui dit pourquoi plutôt que par des interrupteurs sans effet : la 2FA (aucun second facteur n'existe), le timeout de session (demanderait un suivi d'inactivité), et la connexion locale (la désactiver rendrait l'application inaccessible tant qu'aucun SSO ne fonctionne).

**Vérifié** : blocage au 3ᵉ échec avec le seuil réglé à 3, bon mot de passe refusé pendant le blocage, déblocage par un administrateur, et signalement d'expiration sur un mot de passe daté de 100 jours avec un seuil à 90. 21 tests figent le contrat.

### 5. L'export ignorait les permissions de catégorie — **corrigé**

`GET /api/import-export/export` n'avait que `authenticateToken`. Il construisait
sa requête sur `WHERE 1=1`, sans le filtrage par catégories accessibles
qu'applique `GET /objects`.

Un compte dont l'écran ne montre aucune catégorie récupérait donc l'inventaire
complet dans un classeur — nom, référence, numéro de série, localisation, prix
d'achat de chaque matériel. La route était bien authentifiée, ce qui explique
qu'elle figure dans la liste des routes protégées de l'audit de février : c'est
le contrôle *après* l'authentification qui manquait.

**Correction** : le même filtre que `GET /objects`, et un 403 explicite quand
aucune catégorie n'est accessible.

**Vérifié** : un compte `user` sans permission voit 0 matériel à l'écran et
reçoit désormais `403 Aucune catégorie ne vous est accessible` sur l'export, là
où il obtenait auparavant les 57 matériels du parc.

### Journalisation muette — **corrigé**

Deux défauts indépendants faisaient disparaître des entrées de journal sans erreur :

- La catégorie `'other'`, déclarée dans le type et proposée en filtre sous le nom « Autre », manquait dans les catégories activées par défaut. Les 13 appels qui l'utilisaient — création et suppression d'espace vert, cycle de vie des manifestations, import/export, réservations — n'écrivaient rien.
- L'appel journalisant les changements de configuration d'authentification passait `action` et omettait `level` ; `log()` filtre sur les niveaux activés, `includes(undefined)` est faux, et l'entrée était jetée.

---

## 📈 Matrice de conformité

| Critère OWASP | Statut | Notes |
|---------------|--------|-------|
| A01 - Broken Access Control | ✅ | Uploads protégés par JWT. La portée des tokens API et le cloisonnement de l'export par catégorie, ignorés jusqu'en août 2026, sont désormais appliqués |
| A02 - Cryptographic Failures | ✅ | Bcrypt + JWT avec rotation |
| A03 - Injection | ✅ | Requêtes paramétrées |
| A04 - Insecure Design | ✅ | Architecture sécurisée |
| A05 - Security Misconfiguration | ✅ | Headers OK, HTTPS forcé, secret JWT obligatoire. La politique de mot de passe et le blocage après N tentatives sont appliqués depuis août 2026 |
| A06 - Vulnerable Components | ⚠️ | Audit npm recommandé |
| A07 - Authentication Failures | ✅ | Rate limiting + audit complet. Corrigé en août 2026 : la cascade de déconnexion épuisait le limiteur et bloquait la reconnexion 15 minutes, et aucune déconnexion n'était journalisée |
| A08 - Data Integrity Failures | ✅ | Validation des entrées |
| A09 - Security Logging | ✅ | Service de logs complet. Corrigé en août 2026 : la catégorie « Autre » n'était pas activée, ce qui faisait disparaître 13 types d'événements |
| A10 - SSRF | ✅ | Non applicable |

---

## 🛠️ Plan d'action recommandé

### Priorité haute (à traiter immédiatement)

- [x] ~~Sécuriser l'accès au dossier `/uploads`~~ ✅ Corrigé le 06/02/2026
- [x] ~~Implémenter le rate limiting sur `/api/auth/login`~~ ✅ Implémenté le 06/02/2026

### Priorité moyenne (dans les 30 jours)

- [x] ~~Ajouter rate limiting global~~ ✅ Implémenté le 06/02/2026
- [ ] Exécuter `npm audit` et corriger les vulnérabilités
- [x] ~~Documenter la politique de rotation des secrets JWT~~ ✅ Implémenté le 06/02/2026

### Priorité basse (dans les 90 jours)

- [x] ~~Implémenter la détection de tentatives de brute force~~ ✅ Via rate limiting
- [x] ~~Ajouter des tests de sécurité automatisés~~ ✅ Août 2026 — `roles.test.ts` (31 tests, matrice rôle × endpoint) et `apiTokens.test.ts` (10 tests, portée des tokens)
- [ ] Mettre en place un WAF (Web Application Firewall)

### Ouvert après la révision d'août 2026

- [x] ~~**Appliquer ou retirer la politique de mot de passe et le blocage après N tentatives**~~ ✅ Août 2026 — appliqués ; les trois réglages inapplicables ont été retirés du formulaire
- [ ] **Finir ou retirer les écrans SSO SAML / OIDC / LDAP / Passkey** — `auth_config` est écrite et relue par personne
- [ ] **Séparer le secret du jeton de rafraîchissement** — `JWT_REFRESH_SECRET` est déclaré dans `docker-compose.yml` et lu par personne : les deux jetons sont signés avec `JWT_SECRET`, donc une fuite du secret d'accès permet aussi de forger des jetons de rafraîchissement
- [ ] Exécuter `npm audit` et corriger les vulnérabilités

---

## 🔐 API de Sécurité

### Routes disponibles (Admin uniquement)

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/security/jwt/status` | GET | Rapport de sécurité JWT |
| `/api/security/jwt/settings` | GET | Paramètres de rotation |
| `/api/security/jwt/settings` | PUT | Modifier les paramètres |
| `/api/security/jwt/rotate` | POST | Rotation manuelle |
| `/api/security/jwt/history` | GET | Historique des rotations |
| `/api/security/jwt/cleanup` | POST | Nettoyer anciens secrets |
| `/api/https-status` | GET | Vérifier le statut HTTPS |

---

## 📝 Conclusion

**Le contrôle d'accès aux routes est solide** : toutes les routes sont protégées, les rôles sont vérifiés et désormais figés par une matrice de tests, le rate limiting et les en-têtes de sécurité sont en place.

La révision d'août 2026 montre en revanche que la protection des routes ne dit rien de ce qui se passe une fois le contrôle franchi. Trois défauts corrigés depuis — portée des tokens API ignorée, cascade de déconnexion bloquant la reconnexion 15 minutes, déconnexions jamais journalisées — étaient invisibles depuis la liste des endpoints.

**Le point ouvert le plus sérieux n'est pas un défaut de code mais un écart entre l'interface et la réalité.** La politique de mot de passe et le blocage après N tentatives, qui étaient dans ce cas, sont désormais appliqués ; les réglages inapplicables ont été retirés du formulaire.

Restent les **écrans SSO SAML, OIDC, LDAP et Passkey** : ils font croire à un administrateur que l'authentification est déléguée alors qu'elle reste en bcrypt local. Tant qu'ils sont affichés sans être appliqués, ils réduisent la sécurité effective plutôt que de l'augmenter, parce qu'ils dissuadent de chercher une autre protection.

**Priorité suivante** : finir ou retirer ces quatre écrans.

---

*Audit initial du 06/02/2026 par GitHub Copilot — révision du 29/08/2026 après vérification du comportement réel dans le navigateur et en base.*
