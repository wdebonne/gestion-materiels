import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Envoi des webhooks.
 *
 * Le CRUD, le bouton de test et la journalisation existaient depuis toujours,
 * mais `POST /webhooks/trigger` n'était appelé par aucune route ni tâche
 * planifiée : un administrateur configurait une URL, la testait avec succès, et
 * plus jamais rien ne partait. L'écran proposait pourtant douze événements.
 *
 * Ces tests protègent la propriété qui compte : chaque événement annoncé dans
 * l'écran a bien un endroit qui le déclenche.
 */

const RACINE = path.join(__dirname, '..');

function lire(...morceaux: string[]): string {
  return fs.readFileSync(path.join(RACINE, ...morceaux), 'utf8');
}

const SERVICE = lire('src', 'services', 'webhook.service.ts');
const ECRAN = lire('client', 'src', 'pages', 'settings', 'WebhooksPage.tsx');

/** Tout le code serveur, pour retrouver les points de déclenchement. */
function sourcesServeur(dossier = path.join(RACINE, 'src'), trouves: string[] = []): string[] {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) sourcesServeur(chemin, trouves);
    else if (entree.name.endsWith('.ts')) trouves.push(fs.readFileSync(chemin, 'utf8'));
  }
  return trouves;
}

const TOUT_LE_SERVEUR = sourcesServeur().join('\n');

/**
 * Événements proposés par l'écran des webhooks, hors joker.
 *
 * Le tiret bas est accepté : sans lui, `manifestation.status_changed` échappait
 * aux deux relevés à la fois et la parité qu'ils vérifient devenait muette
 * précisément sur les événements qu'on venait d'ajouter.
 */
function evenementsDeLEcran(): string[] {
  return [...ECRAN.matchAll(/\{ value: '([a-z]+\.[a-z_]+)'/g)].map((m) => m[1]);
}

describe('Événements annoncés et événements déclenchés', () => {
  it('l’écran et le service décrivent la même liste', () => {
    const ecran = evenementsDeLEcran().sort();
    const service = [...SERVICE.matchAll(/'([a-z]+\.[a-z_]+)',/g)].map((m) => m[1]).sort();
    expect(service).toEqual(ecran);
  });

  it('chaque événement proposé est réellement déclenché quelque part', () => {
    // C'est exactement ce qui manquait : douze événements dans l'écran, zéro
    // appel dans le code.
    const sansDeclencheur = evenementsDeLEcran().filter(
      (e) => !TOUT_LE_SERVEUR.includes(`notifierWebhooks('${e}'`)
    );
    expect(sansDeclencheur).toEqual([]);
  });

  it('les alertes passent par un point unique', () => {
    // Les alertes naissent à cinq endroits : brancher chaque `INSERT` serait
    // le meilleur moyen d'en oublier un. `emitAlert` est déjà le signal commun.
    const ws = lire('src', 'services', 'websocket.service.ts');
    expect(ws).toContain("notifierWebhooks('alert.created'");
  });
});

describe('Un webhook ne doit pas gêner l’action qu’il décrit', () => {
  it('la notification est lancée sans être attendue', () => {
    const debut = SERVICE.indexOf('export function notifierWebhooks');
    const corps = SERVICE.slice(debut, SERVICE.indexOf('\n}', debut));
    // `void` + `.catch` : un agent qui enregistre un plein n'attend pas qu'un
    // service externe réponde, et une URL cassée ne fait pas échouer sa saisie.
    expect(corps).toContain('void envoyerWebhooks');
    expect(corps).toContain('.catch(');
  });

  it('impose un délai maximal réel', () => {
    // `fetch(url, { timeout })` n'existe pas : l'option était ignorée, et une
    // URL qui accepte la connexion sans jamais répondre bloquait indéfiniment.
    expect(SERVICE).toContain('AbortSignal.timeout');
    expect(SERVICE).not.toMatch(/timeout: \d+/);
  });

  it('un destinataire injoignable n’empêche pas les autres de recevoir', () => {
    const debut = SERVICE.indexOf('export async function envoyerWebhooks');
    const corps = SERVICE.slice(debut, SERVICE.indexOf('\n}', debut));
    // Le try/catch est à l'intérieur de la boucle, pas autour.
    const boucle = corps.indexOf('for (const webhook of cibles)');
    expect(corps.indexOf('try {', boucle)).toBeGreaterThan(boucle);
  });
});

describe('Filtrage des destinataires', () => {
  /** Reproduit la règle du service : liste vide ou joker valent « tous ». */
  const ecoute = (abonnements: string[] | null, evenement: string): boolean => {
    const liste = abonnements ?? [];
    return liste.length === 0 || liste.includes('*') || liste.includes(evenement);
  };

  it('le joker reçoit tout', () => {
    expect(ecoute(['*'], 'object.created')).toBe(true);
    expect(ecoute(['*'], 'user.login')).toBe(true);
  });

  it('une liste vide reçoit tout', () => {
    // Un webhook créé sans cocher d'événement doit tout recevoir, sinon il ne
    // reçoit rien et son auteur ne comprend pas pourquoi.
    expect(ecoute([], 'object.created')).toBe(true);
    expect(ecoute(null, 'object.created')).toBe(true);
  });

  it('un abonnement précis ne reçoit que le sien', () => {
    expect(ecoute(['object.created'], 'object.created')).toBe(true);
    expect(ecoute(['object.created'], 'object.deleted')).toBe(false);
  });
});

describe('Signature', () => {
  it('permet au destinataire de vérifier l’origine de l’appel', () => {
    const secret = 'secret-partage';
    const corps = JSON.stringify({ event: 'object.created', data: { id: 1 } });
    const attendue = 'sha256=' + crypto.createHmac('sha256', secret).update(corps).digest('hex');

    // La signature porte sur le corps envoyé, pas sur une re-sérialisation :
    // deux `JSON.stringify` d'un même objet peuvent différer par l'ordre des
    // clés, et la vérification échouerait chez le destinataire.
    expect(SERVICE).toContain("createHmac('sha256', webhook.secret).update(corps)");
    expect(attendue).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('envoie le même corps que celui qui est signé', () => {
    const debut = SERVICE.indexOf('export async function envoyerWebhooks');
    const corps = SERVICE.slice(debut, SERVICE.indexOf('\n}', debut));
    expect(corps).toContain('body: corps');
    expect(corps).toContain('entetes(webhook, corps)');
  });
});
