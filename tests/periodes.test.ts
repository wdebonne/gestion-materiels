import {
  bornesPeriode,
  cleDePeriode,
  cleSemaineISO,
  decalerJours,
  enHeuresDecimales,
  estDureeValide,
  estHeureValide,
  estJourValide,
  formaterDuree,
  granularitePour,
  jourCourant,
  libelleDePeriode,
  lundiDe,
  lundiDeSemaineISO,
  memePeriodeAnneePrecedente,
  minutesEntre,
  nombreDeJours,
  periodePrecedente,
  periodesEntre,
  semainesDansAnneeISO,
  versJour,
} from '../src/utils/periodes';

/**
 * Le calcul des jours et des durées, figé.
 *
 * Ces fonctions portent seules la justesse de tous les chiffres du module :
 * une semaine mal bornée ne produit pas d'erreur, elle produit un total faux,
 * qui ne se remarque qu'en réunion. Les cas ci-dessous sont ceux où les
 * implémentations naïves se trompent.
 */

describe('minutesEntre', () => {
  it('compte une plage ordinaire', () => {
    expect(minutesEntre('14:00', '16:00')).toBe(120);
    expect(minutesEntre('08:15', '12:45')).toBe(270);
  });

  it('traite une fin antérieure au début comme une tâche de nuit', () => {
    expect(minutesEntre('22:00', '02:00')).toBe(240);
    expect(minutesEntre('23:30', '00:15')).toBe(45);
  });

  it('refuse deux heures identiques plutôt que de choisir entre 0 et 24 h', () => {
    expect(() => minutesEntre('08:00', '08:00')).toThrow();
  });

  it('refuse une heure mal formée', () => {
    expect(() => minutesEntre('8:00', '10:00')).toThrow();
    expect(() => minutesEntre('14:00', '24:00')).toThrow();
    expect(() => minutesEntre('14:60', '16:00')).toThrow();
  });
});

describe('formaterDuree', () => {
  it("écrit une durée comme on la lit", () => {
    expect(formaterDuree(150)).toBe('2 h 30');
    expect(formaterDuree(120)).toBe('2 h');
    expect(formaterDuree(45)).toBe('45 min');
    expect(formaterDuree(0)).toBe('0 min');
    expect(formaterDuree(605)).toBe('10 h 05');
  });
});

describe('enHeuresDecimales', () => {
  it('convertit pour un tableur', () => {
    expect(enHeuresDecimales(150)).toBe(2.5);
    expect(enHeuresDecimales(20)).toBe(0.33);
  });
});

describe('estDureeValide', () => {
  it('borne la durée entre 1 minute et 24 heures', () => {
    expect(estDureeValide(1)).toBe(true);
    expect(estDureeValide(1440)).toBe(true);
    expect(estDureeValide(0)).toBe(false);
    expect(estDureeValide(1441)).toBe(false);
    expect(estDureeValide(90.5)).toBe(false);
    expect(estDureeValide('120' as unknown)).toBe(false);
  });
});

describe('estJourValide', () => {
  it('accepte un jour ISO qui existe', () => {
    expect(estJourValide('2026-03-18')).toBe(true);
    expect(estJourValide('2024-02-29')).toBe(true);
  });

  it("refuse un jour qui passe l'expression régulière mais n'existe pas", () => {
    expect(estJourValide('2026-02-30')).toBe(false);
    expect(estJourValide('2026-13-01')).toBe(false);
    expect(estJourValide('2025-02-29')).toBe(false);
  });

  it('refuse une autre écriture', () => {
    expect(estJourValide('18/03/2026')).toBe(false);
    expect(estJourValide('2026-3-18')).toBe(false);
    expect(estJourValide('')).toBe(false);
  });
});

describe('estHeureValide', () => {
  it('accepte HH:MM sur 24 heures', () => {
    expect(estHeureValide('00:00')).toBe(true);
    expect(estHeureValide('23:59')).toBe(true);
    expect(estHeureValide('24:00')).toBe(false);
    expect(estHeureValide('9:30')).toBe(false);
  });
});

describe('jourCourant', () => {
  it("rend le jour local, et non celui d'UTC", () => {
    // Le 18 mars à 00 h 30 en UTC+1, `toISOString()` rendrait le 17 : c'est
    // exactement l'heure à laquelle un agent saisit sa journée en rentrant.
    const minuitPasse = new Date(2026, 2, 18, 0, 30, 0);
    expect(jourCourant(minuitPasse)).toBe('2026-03-18');
  });

  it('complète les nombres à un chiffre', () => {
    expect(jourCourant(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
  });
});

describe('versJour', () => {
  it("accepte ce que rend SQLite comme ce que rend MySQL", () => {
    expect(versJour('2026-03-18')).toBe('2026-03-18');
    expect(versJour('2026-03-18T00:00:00.000Z')).toBe('2026-03-18');
    // mysql2 rend une colonne DATE en Date locale : c'est le jour local qui
    // compte, pas sa projection UTC.
    expect(versJour(new Date(2026, 2, 18, 0, 0, 0))).toBe('2026-03-18');
  });
});

describe('decalerJours', () => {
  it('franchit les mois et les années', () => {
    expect(decalerJours('2026-03-31', 1)).toBe('2026-04-01');
    expect(decalerJours('2026-01-01', -1)).toBe('2025-12-31');
    expect(decalerJours('2024-02-28', 1)).toBe('2024-02-29');
    expect(decalerJours('2025-02-28', 1)).toBe('2025-03-01');
  });

  it("ne glisse pas d'un jour au changement d'heure", () => {
    // 29 mars 2026 et 25 octobre 2026 : les deux bascules en France.
    expect(decalerJours('2026-03-28', 1)).toBe('2026-03-29');
    expect(decalerJours('2026-03-29', 1)).toBe('2026-03-30');
    expect(decalerJours('2026-10-24', 1)).toBe('2026-10-25');
    expect(decalerJours('2026-10-25', 1)).toBe('2026-10-26');
  });
});

describe('lundiDe', () => {
  it('remonte au lundi de la semaine', () => {
    expect(lundiDe('2026-03-18')).toBe('2026-03-16'); // mercredi
    expect(lundiDe('2026-03-16')).toBe('2026-03-16'); // lundi
    expect(lundiDe('2026-03-22')).toBe('2026-03-16'); // dimanche
  });
});

describe('cleSemaineISO', () => {
  it("attribue la semaine à l'année de son jeudi", () => {
    // Le 1er janvier 2026 est un jeudi : sa semaine est bien la première.
    expect(cleSemaineISO('2026-01-01')).toBe('2026-W01');
    // Le 1er janvier 2027 est un vendredi : sa semaine appartient à 2026.
    expect(cleSemaineISO('2027-01-01')).toBe('2026-W53');
    // Le 3 janvier 2021 est un dimanche, dernier jour de la semaine 53 de 2020.
    expect(cleSemaineISO('2021-01-03')).toBe('2020-W53');
    // Le 30 décembre 2024 est un lundi : sa semaine est la première de 2025.
    expect(cleSemaineISO('2024-12-30')).toBe('2025-W01');
  });

  it("ne reproduit pas les numérotations de SQLite ni de MySQL", () => {
    // strftime('%W') rendrait « 00 » ici, DATE_FORMAT('%u') rendrait « 01 ».
    expect(cleSemaineISO('2026-01-01')).not.toBe('2026-W00');
  });

  it('reste cohérente avec lundiDeSemaineISO', () => {
    for (const jour of ['2020-12-31', '2024-12-30', '2026-01-01', '2027-01-01']) {
      const [annee, numero] = cleSemaineISO(jour).split('-W').map(Number);
      expect(lundiDeSemaineISO(annee, numero)).toBe(lundiDe(jour));
    }
  });
});

describe('semainesDansAnneeISO', () => {
  it('distingue les années de 53 semaines', () => {
    expect(semainesDansAnneeISO(2020)).toBe(53);
    expect(semainesDansAnneeISO(2026)).toBe(53);
    expect(semainesDansAnneeISO(2025)).toBe(52);
    expect(semainesDansAnneeISO(2024)).toBe(52);
  });
});

describe('bornesPeriode', () => {
  it('borne un jour', () => {
    expect(bornesPeriode('jour', '2026-03-18')).toEqual({ debut: '2026-03-18', fin: '2026-03-18' });
  });

  it('borne une semaine du lundi au dimanche', () => {
    expect(bornesPeriode('semaine', '2026-03-18')).toEqual({ debut: '2026-03-16', fin: '2026-03-22' });
  });

  it('borne une semaine à cheval sur deux mois', () => {
    expect(bornesPeriode('semaine', '2026-04-01')).toEqual({ debut: '2026-03-30', fin: '2026-04-05' });
  });

  it('borne un mois sans connaître sa longueur', () => {
    expect(bornesPeriode('mois', '2026-02-10')).toEqual({ debut: '2026-02-01', fin: '2026-02-28' });
    expect(bornesPeriode('mois', '2024-02-10')).toEqual({ debut: '2024-02-01', fin: '2024-02-29' });
    expect(bornesPeriode('mois', '2026-12-31')).toEqual({ debut: '2026-12-01', fin: '2026-12-31' });
  });

  it('borne une année', () => {
    expect(bornesPeriode('annee', '2026-07-04')).toEqual({ debut: '2026-01-01', fin: '2026-12-31' });
  });
});

describe('periodePrecedente', () => {
  it('recule d une semaine', () => {
    expect(periodePrecedente('semaine', '2026-03-18')).toEqual({ debut: '2026-03-09', fin: '2026-03-15' });
  });

  it("recule d'un mois sans passer par les jours", () => {
    // 31 mars moins un mois doit donner février entier, pas « le 3 mars ».
    expect(periodePrecedente('mois', '2026-03-31')).toEqual({ debut: '2026-02-01', fin: '2026-02-28' });
    expect(periodePrecedente('mois', '2026-01-15')).toEqual({ debut: '2025-12-01', fin: '2025-12-31' });
  });

  it("recule d'une année", () => {
    expect(periodePrecedente('annee', '2026-07-04')).toEqual({ debut: '2025-01-01', fin: '2025-12-31' });
  });
});

describe('memePeriodeAnneePrecedente', () => {
  it('retrouve le même mois', () => {
    expect(memePeriodeAnneePrecedente('mois', '2026-03-18')).toEqual({ debut: '2025-03-01', fin: '2025-03-31' });
  });

  it('retrouve la même semaine ISO', () => {
    const bornes = memePeriodeAnneePrecedente('semaine', '2026-03-18'); // 2026-W12
    expect(cleSemaineISO(bornes.debut)).toBe('2025-W12');
  });

  it("se rabat sur la dernière semaine quand l'année d'avant n'en a que 52", () => {
    // 2026 compte 53 semaines, 2025 seulement 52.
    const bornes = memePeriodeAnneePrecedente('semaine', lundiDeSemaineISO(2026, 53));
    expect(cleSemaineISO(bornes.debut)).toBe('2025-W52');
  });

  it('ramène le 29 février au 28', () => {
    expect(memePeriodeAnneePrecedente('jour', '2024-02-29')).toEqual({ debut: '2023-02-28', fin: '2023-02-28' });
  });
});

describe('periodesEntre', () => {
  it('rend une série pleine, y compris les périodes vides', () => {
    const series = periodesEntre('2026-03-01', '2026-03-31', 'semaine');
    expect(series.map((p) => p.cle)).toEqual([
      '2026-W09', '2026-W10', '2026-W11', '2026-W12', '2026-W13', '2026-W14',
    ]);
  });

  it('couvre chaque jour du mois', () => {
    expect(periodesEntre('2026-02-01', '2026-02-28', 'jour')).toHaveLength(28);
  });

  it('couvre les douze mois d une année', () => {
    const mois = periodesEntre('2026-01-01', '2026-12-31', 'mois');
    expect(mois).toHaveLength(12);
    expect(mois[0].cle).toBe('2026-01');
    expect(mois[11].cle).toBe('2026-12');
  });

  it('rend une seule période quand les bornes sont dans la même', () => {
    expect(periodesEntre('2026-03-17', '2026-03-19', 'semaine')).toHaveLength(1);
  });

  it('rend une liste vide si les bornes sont inversées', () => {
    expect(periodesEntre('2026-03-31', '2026-03-01', 'jour')).toHaveLength(0);
  });
});

describe('libellés', () => {
  it('nomme une semaine sans répéter le mois', () => {
    expect(libelleDePeriode('semaine', bornesPeriode('semaine', '2026-03-18')))
      .toBe('Semaine 12 (16 – 22 mars 2026)');
  });

  it('nomme une semaine à cheval en précisant les deux mois', () => {
    expect(libelleDePeriode('semaine', bornesPeriode('semaine', '2026-04-01')))
      .toBe('Semaine 14 (30 mars – 5 avr. 2026)');
  });

  it('nomme un mois et une année', () => {
    expect(libelleDePeriode('mois', bornesPeriode('mois', '2026-03-18'))).toBe('Mars 2026');
    expect(libelleDePeriode('annee', bornesPeriode('annee', '2026-03-18'))).toBe('Année 2026');
  });
});

describe('cleDePeriode', () => {
  it('découpe selon la granularité', () => {
    expect(cleDePeriode('2026-03-18', 'jour')).toBe('2026-03-18');
    expect(cleDePeriode('2026-03-18', 'semaine')).toBe('2026-W12');
    expect(cleDePeriode('2026-03-18', 'mois')).toBe('2026-03');
    expect(cleDePeriode('2026-03-18', 'annee')).toBe('2026');
  });
});

describe('nombreDeJours', () => {
  it('compte les bornes comprises', () => {
    expect(nombreDeJours({ debut: '2026-03-16', fin: '2026-03-22' })).toBe(7);
    expect(nombreDeJours({ debut: '2026-03-18', fin: '2026-03-18' })).toBe(1);
    expect(nombreDeJours({ debut: '2026-01-01', fin: '2026-12-31' })).toBe(365);
  });

  it("ne se trompe pas d'un jour au changement d'heure", () => {
    expect(nombreDeJours({ debut: '2026-03-28', fin: '2026-03-30' })).toBe(3);
    expect(nombreDeJours({ debut: '2026-10-24', fin: '2026-10-26' })).toBe(3);
  });
});

describe('granularitePour', () => {
  it("choisit un découpage qui ne donne ni une barre ni deux cents", () => {
    expect(granularitePour({ debut: '2026-03-16', fin: '2026-03-22' })).toBe('jour');
    expect(granularitePour({ debut: '2026-03-01', fin: '2026-03-31' })).toBe('jour');
    expect(granularitePour({ debut: '2026-01-01', fin: '2026-06-30' })).toBe('semaine');
    expect(granularitePour({ debut: '2026-01-01', fin: '2026-12-31' })).toBe('mois');
    expect(granularitePour({ debut: '2020-01-01', fin: '2026-12-31' })).toBe('annee');
  });
});
