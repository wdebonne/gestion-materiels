/**
 * Les jours, les semaines et les durées, calculés en JavaScript.
 *
 * Un module qui compte des heures ne peut pas se permettre d'avoir tort sur une
 * date. Deux pièges, tous deux déjà présents ailleurs dans le projet, sont
 * désamorcés ici une fois pour toutes.
 *
 * **Le fuseau.** L'application n'a aucune configuration de fuseau horaire : ni
 * `TZ`, ni `Europe/Paris`, ni option sur `node-cron` ou sur `mysql2`. L'idiome
 * `new Date().toISOString().split('T')[0]`, qu'on trouve un peu partout, rend
 * donc **hier** pour quelqu'un en UTC+1 entre minuit et 1 h du matin — soit
 * exactement à l'heure où un agent reste tard pour saisir sa journée. Le jour
 * courant se lit avec les accesseurs locaux ; toute l'arithmétique qui suit se
 * fait ensuite sur des dates construites en UTC à partir d'entiers, forme sur
 * laquelle un changement d'heure n'a aucune prise.
 *
 * **La semaine ISO.** `strftime('%W')` sur SQLite et `DATE_FORMAT('%u')` sur
 * MySQL ne numérotent pas les semaines pareil, et aucun des deux n'est ISO :
 * pour le 1er janvier 2026, un jeudi, le premier répond « W00 » et le second
 * « W01 ». Les faire cohabiter, c'est accepter que le même rapport donne deux
 * résultats selon le moteur. La semaine se calcule donc ici, par son jeudi.
 *
 * Les jours circulent partout sous forme de chaînes ISO `YYYY-MM-DD` : c'est la
 * seule écriture que SQLite et MySQL comparent et trient de la même façon, et
 * elle traverse `res.json()` sans se faire réinterpréter.
 */

export type Granularite = 'jour' | 'semaine' | 'mois' | 'annee';

/** Un intervalle de jours, bornes comprises. */
export interface Bornes {
  debut: string;
  fin: string;
}

/** Une période d'une série, telle qu'un graphique l'affiche. */
export interface Periode extends Bornes {
  /** Identifiant stable : `2026-03-18`, `2026-W12`, `2026-03`, `2026`. */
  cle: string;
  /** Court, pour un axe : « 18/03 », « S12 », « mars », « 2026 ». */
  libelle: string;
  /** Complet, pour un titre : « Semaine 12 (16–22 mars 2026) ». */
  libelleLong: string;
}

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

const MOIS_COURTS = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
];

const MS_PAR_JOUR = 86_400_000;
const MINUTES_PAR_JOUR = 1440;

// --------------------------------------------------------------- conversions

const FORMAT_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const FORMAT_HEURE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Ce jour est-il écrit `YYYY-MM-DD`, et désigne-t-il une date qui existe ? */
export function estJourValide(valeur: unknown): valeur is string {
  if (typeof valeur !== 'string' || !FORMAT_JOUR.test(valeur)) return false;
  // `2026-02-30` passe l'expression régulière : seule la reconstruction le
  // démasque, parce que `Date.UTC` reporte le surplus sur le mois suivant.
  return enJour(depuisJour(valeur)) === valeur;
}

/** Cette heure est-elle écrite `HH:MM`, entre `00:00` et `23:59` ? */
export function estHeureValide(valeur: unknown): valeur is string {
  return typeof valeur === 'string' && FORMAT_HEURE.test(valeur);
}

/**
 * Le jour d'une valeur venue de la base, quel que soit le moteur.
 *
 * Les colonnes `planning_*` sont en `VARCHAR(10)` précisément pour éviter ça,
 * mais une jointure peut ramener une colonne `DATE` d'une table plus ancienne :
 * mysql2 la rend alors en objet `Date`, là où SQLite rend une chaîne.
 */
export function versJour(valeur: unknown): string {
  if (valeur instanceof Date) return enJour(new Date(Date.UTC(
    valeur.getFullYear(), valeur.getMonth(), valeur.getDate()
  )));
  const texte = String(valeur ?? '');
  return texte.length > 10 ? texte.slice(0, 10) : texte;
}

/** Une date UTC à partir d'un jour ISO. Jamais `new Date('2026-03-18')`. */
function depuisJour(jour: string): Date {
  const [annee, mois, quantieme] = jour.split('-').map(Number);
  return new Date(Date.UTC(annee, mois - 1, quantieme));
}

/** Le jour ISO d'une date UTC. */
function enJour(date: Date): string {
  const annee = String(date.getUTCFullYear()).padStart(4, '0');
  const mois = String(date.getUTCMonth() + 1).padStart(2, '0');
  const quantieme = String(date.getUTCDate()).padStart(2, '0');
  return `${annee}-${mois}-${quantieme}`;
}

/**
 * Aujourd'hui, tel que le voit la personne devant l'écran.
 *
 * Accesseurs locaux, et non `toISOString()` : voir l'en-tête du fichier.
 */
export function jourCourant(maintenant: Date = new Date()): string {
  const annee = String(maintenant.getFullYear()).padStart(4, '0');
  const mois = String(maintenant.getMonth() + 1).padStart(2, '0');
  const quantieme = String(maintenant.getDate()).padStart(2, '0');
  return `${annee}-${mois}-${quantieme}`;
}

/** Le jour situé `nombre` jours plus loin (ou plus tôt, si négatif). */
export function decalerJours(jour: string, nombre: number): string {
  const date = depuisJour(jour);
  date.setUTCDate(date.getUTCDate() + nombre);
  return enJour(date);
}

/**
 * Le même quantième, `nombre` mois plus loin — borné à la fin du mois.
 *
 * `setUTCMonth` seul ferait déborder : un contrôle du 31 janvier, reporté d'un
 * mois, tomberait le 3 mars. Une échéance réglementaire ne recule pas d'elle-même
 * au mois suivant ; on la ramène donc au dernier jour du mois visé.
 */
export function decalerMois(jour: string, nombre: number): string {
  const [annee, mois, quantieme] = jour.split('-').map(Number);
  const cible = new Date(Date.UTC(annee, mois - 1 + nombre, 1));
  const dernierJour = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(quantieme, dernierJour));
  return enJour(cible);
}

/**
 * La part d'une période qui tombe dans une fenêtre, au jour près — entre 0 et 1.
 *
 * C'est ce qui permet de ranger une facture de gaz de décembre-janvier pour
 * moitié dans chaque mois, ou un contrat annuel au prorata du trimestre qu'on
 * regarde. Sans elle, un montant tombe tout entier à la date de la facture, et
 * comparer janvier d'une année à l'autre ne veut rien dire.
 *
 * Une période inversée ou vide rend 0 ; une période d'un seul jour vaut 1 si ce
 * jour est dans la fenêtre.
 */
export function partDansFenetre(periode: Bornes, fenetre: Bornes): number {
  if (periode.fin < periode.debut) return 0;
  const debut = periode.debut > fenetre.debut ? periode.debut : fenetre.debut;
  const fin = periode.fin < fenetre.fin ? periode.fin : fenetre.fin;
  if (fin < debut) return 0;
  return nombreDeJours({ debut, fin }) / nombreDeJours(periode);
}

/** Combien de jours séparent deux jours, bornes comprises. */
export function nombreDeJours({ debut, fin }: Bornes): number {
  return Math.round((depuisJour(fin).getTime() - depuisJour(debut).getTime()) / MS_PAR_JOUR) + 1;
}

// ------------------------------------------------------------------ semaines

/** Le lundi de la semaine qui contient ce jour. */
export function lundiDe(jour: string): string {
  const date = depuisJour(jour);
  // `getUTCDay()` rend 0 pour dimanche : le décalage ramène lundi à 0.
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return enJour(date);
}

/**
 * La semaine ISO d'un jour, sous la forme `2026-W12`.
 *
 * C'est le **jeudi** de la semaine qui décide de l'année : une semaine
 * appartient à l'année où tombe son jeudi. C'est ce qui fait que le
 * 1er janvier 2027, un vendredi, est en `2026-W53` et non en `2027-W01` — et
 * c'est la règle que ni SQLite ni MySQL n'appliquent.
 */
export function cleSemaineISO(jour: string): string {
  const jeudi = depuisJour(decalerJours(lundiDe(jour), 3));
  const anneeISO = jeudi.getUTCFullYear();
  const jeudiInitial = depuisJour(decalerJours(lundiDe(`${anneeISO}-01-04`), 3));
  const numero = 1 + Math.round((jeudi.getTime() - jeudiInitial.getTime()) / (7 * MS_PAR_JOUR));
  return `${anneeISO}-W${String(numero).padStart(2, '0')}`;
}

/** Le lundi de la semaine `numero` de l'année ISO `annee`. */
export function lundiDeSemaineISO(annee: number, numero: number): string {
  // Le 4 janvier est toujours dans la semaine 01, quelle que soit l'année.
  return decalerJours(lundiDe(`${annee}-01-04`), (numero - 1) * 7);
}

/** Combien de semaines compte une année ISO : 52, ou 53. */
export function semainesDansAnneeISO(annee: number): number {
  return cleSemaineISO(`${annee}-12-28`) === `${annee}-W53` ? 53 : 52;
}

// ------------------------------------------------------------------ périodes

/** La clé de la période qui contient ce jour, à la granularité demandée. */
export function cleDePeriode(jour: string, granularite: Granularite): string {
  switch (granularite) {
    case 'jour': return jour;
    case 'semaine': return cleSemaineISO(jour);
    case 'mois': return jour.slice(0, 7);
    case 'annee': return jour.slice(0, 4);
  }
}

/** Les bornes de la période qui contient `ancre`. */
export function bornesPeriode(granularite: Granularite, ancre: string): Bornes {
  const date = depuisJour(ancre);
  const annee = date.getUTCFullYear();
  const mois = date.getUTCMonth();

  switch (granularite) {
    case 'jour':
      return { debut: ancre, fin: ancre };
    case 'semaine': {
      const debut = lundiDe(ancre);
      return { debut, fin: decalerJours(debut, 6) };
    }
    case 'mois':
      return {
        debut: enJour(new Date(Date.UTC(annee, mois, 1))),
        // Le jour 0 du mois suivant est le dernier du mois courant : ça évite
        // d'avoir à connaître les années bissextiles.
        fin: enJour(new Date(Date.UTC(annee, mois + 1, 0))),
      };
    case 'annee':
      return { debut: `${annee}-01-01`, fin: `${annee}-12-31` };
  }
}

/** Les bornes de la période qui précède immédiatement celle de `ancre`. */
export function periodePrecedente(granularite: Granularite, ancre: string): Bornes {
  switch (granularite) {
    case 'jour':
      return bornesPeriode('jour', decalerJours(ancre, -1));
    case 'semaine':
      return bornesPeriode('semaine', decalerJours(lundiDe(ancre), -7));
    case 'mois': {
      const date = depuisJour(ancre);
      // Recalculé depuis (année, mois) et non en retirant des jours : le
      // 31 mars moins un mois doit donner février, pas le 3 mars.
      return bornesPeriode('mois', enJour(new Date(Date.UTC(
        date.getUTCFullYear(), date.getUTCMonth() - 1, 1
      ))));
    }
    case 'annee':
      return bornesPeriode('annee', `${depuisJour(ancre).getUTCFullYear() - 1}-01-01`);
  }
}

/** Les bornes de la même période, un an plus tôt. */
export function memePeriodeAnneePrecedente(granularite: Granularite, ancre: string): Bornes {
  const date = depuisJour(ancre);
  const annee = date.getUTCFullYear();

  switch (granularite) {
    case 'jour': {
      // Le 29 février n'existe pas toutes les années : on retombe sur le 28.
      const quantieme = Math.min(
        date.getUTCDate(),
        new Date(Date.UTC(annee - 1, date.getUTCMonth() + 1, 0)).getUTCDate()
      );
      return bornesPeriode('jour', enJour(new Date(Date.UTC(annee - 1, date.getUTCMonth(), quantieme))));
    }
    case 'semaine': {
      const [anneeISO, numero] = cleSemaineISO(ancre).split('-W').map(Number);
      const cible = anneeISO - 1;
      // Une année ISO de 52 semaines n'a pas de semaine 53 : on prend la dernière.
      const retenu = Math.min(numero, semainesDansAnneeISO(cible));
      return bornesPeriode('semaine', lundiDeSemaineISO(cible, retenu));
    }
    case 'mois':
      return bornesPeriode('mois', enJour(new Date(Date.UTC(annee - 1, date.getUTCMonth(), 1))));
    case 'annee':
      return bornesPeriode('annee', `${annee - 1}-01-01`);
  }
}

/**
 * Toutes les périodes d'un intervalle, y compris celles qui n'ont rien.
 *
 * Un `GROUP BY` ne rend que les périodes qui portent des lignes : une semaine
 * sans saisie disparaîtrait du graphique au lieu d'y valoir zéro, et une
 * comparaison entre deux périodes n'aurait plus le même nombre de colonnes de
 * part et d'autre. La série se construit donc ici, pleine, et les totaux
 * viennent s'y déposer.
 */
export function periodesEntre(debut: string, fin: string, granularite: Granularite): Periode[] {
  const periodes: Periode[] = [];
  let courant = bornesPeriode(granularite, debut);

  // Borne de sûreté : un intervalle aberrant ne doit pas boucler sans fin.
  for (let garde = 0; courant.debut <= fin && garde < 4000; garde += 1) {
    const cle = cleDePeriode(courant.debut, granularite);
    periodes.push({ cle, ...courant, ...libellesDePeriode(cle, granularite, courant) });
    courant = bornesPeriode(granularite, decalerJours(courant.fin, 1));
  }

  return periodes;
}

/** Comment une période se nomme, en court et en long. */
export function libellesDePeriode(
  cle: string,
  granularite: Granularite,
  bornes: Bornes
): { libelle: string; libelleLong: string } {
  switch (granularite) {
    case 'jour': {
      const date = depuisJour(cle);
      return {
        libelle: `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
        libelleLong: `${date.getUTCDate()} ${MOIS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
      };
    }
    case 'semaine': {
      const numero = Number(cle.split('-W')[1]);
      const premier = depuisJour(bornes.debut);
      const dernier = depuisJour(bornes.fin);
      // « 30 mars – 5 avril » : le mois du premier jour n'est répété que s'il
      // diffère de celui du dernier, sinon on lit deux fois le même mot.
      const debut = premier.getUTCMonth() === dernier.getUTCMonth()
        ? `${premier.getUTCDate()}`
        : `${premier.getUTCDate()} ${MOIS_COURTS[premier.getUTCMonth()]}`;
      const finLibelle = `${dernier.getUTCDate()} ${MOIS_COURTS[dernier.getUTCMonth()]} ${dernier.getUTCFullYear()}`;
      return {
        libelle: `S${String(numero).padStart(2, '0')}`,
        libelleLong: `Semaine ${numero} (${debut} – ${finLibelle})`,
      };
    }
    case 'mois': {
      const [annee, mois] = cle.split('-').map(Number);
      return {
        libelle: MOIS_COURTS[mois - 1],
        libelleLong: `${MOIS[mois - 1][0].toUpperCase()}${MOIS[mois - 1].slice(1)} ${annee}`,
      };
    }
    case 'annee':
      return { libelle: cle, libelleLong: `Année ${cle}` };
  }
}

/** Le libellé complet d'une période, pour un titre de rapport. */
export function libelleDePeriode(granularite: Granularite, bornes: Bornes): string {
  return libellesDePeriode(cleDePeriode(bornes.debut, granularite), granularite, bornes).libelleLong;
}

/**
 * La granularité qui découpe un intervalle sans le réduire à une seule barre
 * ni en produire des centaines.
 */
export function granularitePour(bornes: Bornes): Granularite {
  const jours = nombreDeJours(bornes);
  if (jours <= 31) return 'jour';
  if (jours <= 182) return 'semaine';
  if (jours <= 1100) return 'mois';
  return 'annee';
}

// ------------------------------------------------------------------- durées

/**
 * Combien de minutes séparent deux heures de la même journée de travail.
 *
 * `heure_fin` antérieure à `heure_debut` signifie que la tâche se termine le
 * lendemain — une équipe de nuit, un feu d'artifice. Ses minutes restent
 * rattachées au jour de début : c'est celui que l'agent a saisi, et le
 * déplacer ferait bouger un total d'un jour à l'autre sans que personne
 * l'ait demandé.
 *
 * Deux heures identiques lèvent une erreur plutôt que de valoir 0 ou 24 h : les
 * deux interprétations se défendent, aucune n'est ce que l'agent voulait dire,
 * et un zéro silencieux se retrouverait dans un total sans laisser de trace.
 */
export function minutesEntre(heureDebut: string, heureFin: string): number {
  if (!estHeureValide(heureDebut) || !estHeureValide(heureFin)) {
    throw new Error('Heure attendue au format HH:MM, entre 00:00 et 23:59.');
  }

  const enMinutes = (heure: string) => {
    const [h, m] = heure.split(':').map(Number);
    return h * 60 + m;
  };

  const debut = enMinutes(heureDebut);
  const fin = enMinutes(heureFin);

  if (debut === fin) {
    throw new Error("L'heure de fin doit être différente de l'heure de début.");
  }

  return fin > debut ? fin - debut : MINUTES_PAR_JOUR - debut + fin;
}

/** Cette durée est-elle exprimable par une tâche — au moins 1 min, au plus 24 h ? */
export function estDureeValide(minutes: unknown): minutes is number {
  return typeof minutes === 'number'
    && Number.isInteger(minutes)
    && minutes >= 1
    && minutes <= MINUTES_PAR_JOUR;
}

/**
 * Une durée telle qu'on la lit : « 2 h 30 », « 45 min », « 8 h ».
 *
 * Les minutes nulles ne s'écrivent pas : « 2 h » se lit mieux que « 2 h 00 »,
 * et c'est la forme employée dans le reste de l'application.
 */
export function formaterDuree(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const heures = Math.floor(total / 60);
  const reste = total % 60;

  if (heures === 0) return `${reste} min`;
  if (reste === 0) return `${heures} h`;
  return `${heures} h ${String(reste).padStart(2, '0')}`;
}

/** Une durée en heures décimales, pour un tableur : 150 → 2.5. */
export function enHeuresDecimales(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}
