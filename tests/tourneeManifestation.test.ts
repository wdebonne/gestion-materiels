/**
 * Ce qu'un agent voit en arrivant le matin.
 *
 * La tournée décide seule de ce qui est à faire, de ce qui est en retard et de
 * ce qui est réglé. Ces règles-là ne se vérifient pas à l'œil dans une interface :
 * un « reste » mal compté fait ressortir chaque matin un dossier clos, ou pire,
 * fait disparaître de la liste trente chaises qui sont encore dehors.
 *
 * Le test porte sur les fonctions pures, sans base : c'est justement pour
 * pouvoir les éprouver que le calcul a été séparé de la lecture.
 */

import {
  assemblerTournee,
  etatDeLArret,
  jourDeLivraison,
  jourDeRecuperation,
  joursDeRetard,
  resteDeLaLigne,
  type LigneTournee,
  type NatureLigne,
} from '../src/services/tourneeManifestation.service';

/** Une ligne de tournée, réduite à ce que le test fait varier. */
const ligne = (champs: Partial<LigneTournee> & { nature?: NatureLigne } = {}): LigneTournee => ({
  ref: 'stock:1',
  source: 'stock',
  ligne_id: 1,
  nom: 'Chaise pliante',
  repere: '',
  unite: 'unité',
  nature: 'quantite',
  demande: 0,
  livre: 0,
  rendu: 0,
  perdu: 0,
  etat_retour: null,
  reste: 0,
  ...champs,
});

describe('le jour où un arrêt est attendu', () => {
  it('préfère la date de livraison saisie au premier jour de la manifestation', () => {
    expect(jourDeLivraison({ delivery_date: '2026-07-13', date_start: '2026-07-14' })).toBe(
      '2026-07-13'
    );
  });

  it("retombe sur le début de la manifestation quand aucune livraison n'est datée", () => {
    expect(jourDeLivraison({ delivery_date: null, date_start: '2026-07-14' })).toBe('2026-07-14');
  });

  it('ignore une heure accolée à la date', () => {
    expect(jourDeLivraison({ date_start: '2026-07-14T00:00:00.000Z' })).toBe('2026-07-14');
  });

  it('descend la cascade complète pour la récupération', () => {
    expect(jourDeRecuperation({ recovery_date: '2026-07-16', date_end: '2026-07-15' })).toBe(
      '2026-07-16'
    );
    expect(jourDeRecuperation({ date_end: '2026-07-15', date_start: '2026-07-14' })).toBe(
      '2026-07-15'
    );
    expect(jourDeRecuperation({ date_start: '2026-07-14' })).toBe('2026-07-14');
  });

  it('rend une chaîne vide quand rien ne permet de dater', () => {
    expect(jourDeLivraison({})).toBe('');
    expect(jourDeRecuperation({ recovery_date: '', date_end: null })).toBe('');
  });
});

describe('le retard', () => {
  it("ne compte rien le jour même ni pour ce qui n'est pas encore dû", () => {
    expect(joursDeRetard('2026-07-14', '2026-07-14')).toBe(0);
    expect(joursDeRetard('2026-07-20', '2026-07-14')).toBe(0);
  });

  it('compte les jours entiers écoulés', () => {
    expect(joursDeRetard('2026-07-11', '2026-07-14')).toBe(3);
  });

  it('franchit un changement de mois et une année bissextile', () => {
    expect(joursDeRetard('2026-07-31', '2026-08-02')).toBe(2);
    expect(joursDeRetard('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('ne se fâche pas sur une date absente', () => {
    expect(joursDeRetard('', '2026-07-14')).toBe(0);
  });
});

describe('ce qui reste à faire sur une ligne', () => {
  it('à la livraison, ce qui n’est pas encore parti', () => {
    expect(resteDeLaLigne('livraison', ligne({ demande: 40, livre: 12 }))).toBe(28);
  });

  it('à la récupération, ce qui est sorti et n’est ni revenu ni déclaré perdu', () => {
    expect(resteDeLaLigne('recuperation', ligne({ demande: 40, livre: 40, rendu: 38 }))).toBe(2);
    expect(
      resteDeLaLigne('recuperation', ligne({ demande: 40, livre: 40, rendu: 38, perdu: 2 }))
    ).toBe(0);
  });

  it('ne compte jamais négativement, même sur une saisie incohérente', () => {
    expect(resteDeLaLigne('livraison', ligne({ demande: 10, livre: 12 }))).toBe(0);
    expect(resteDeLaLigne('recuperation', ligne({ livre: 5, rendu: 9 }))).toBe(0);
  });

  it("n'attend pas le retour d'une prestation : elle se réalise, elle ne revient pas", () => {
    const raccordement = ligne({ nature: 'prestation', demande: 1, livre: 1 });
    expect(resteDeLaLigne('livraison', raccordement)).toBe(0);
    expect(resteDeLaLigne('recuperation', raccordement)).toBe(0);
    expect(resteDeLaLigne('livraison', ligne({ nature: 'prestation', demande: 3 }))).toBe(3);
  });

  it('tient un exemplaire déclaré perdu pour réglé : il ne rentrera pas', () => {
    const remorque = ligne({
      source: 'parc',
      nature: 'exemplaire',
      demande: 1,
      livre: 1,
      rendu: 0,
      etat_retour: 'perdu',
    });
    expect(resteDeLaLigne('recuperation', remorque)).toBe(0);
  });

  it("garde en attente un exemplaire revenu abîmé mais pas encore compté rendu", () => {
    const banc = ligne({
      source: 'parc',
      nature: 'exemplaire',
      demande: 1,
      livre: 1,
      rendu: 0,
      etat_retour: 'abime',
    });
    expect(resteDeLaLigne('recuperation', banc)).toBe(1);
  });
});

describe("l'état d'un arrêt", () => {
  it('est « à faire » tant que rien n’a bougé', () => {
    expect(etatDeLArret([ligne({ demande: 40 }), ligne({ demande: 10 })], 'livraison')).toBe(
      'a_faire'
    );
  });

  it('est « commencé » dès qu’une seule ligne a été saisie', () => {
    expect(
      etatDeLArret([ligne({ demande: 40, livre: 40 }), ligne({ demande: 10 })], 'livraison')
    ).toBe('commence');
  });

  it('est « fait » quand il ne reste rien, sans attendre le changement de statut', () => {
    expect(
      etatDeLArret([ligne({ demande: 40, livre: 40 }), ligne({ demande: 10, livre: 10 })], 'livraison')
    ).toBe('fait');
  });
});

describe('la tournée assemblée', () => {
  const AUJOURDHUI = '2026-07-14';

  const fete = {
    id: 1,
    title: 'Fête de la musique',
    status: 'validated',
    delivery_date: '2026-07-14',
    date_start: '2026-07-14',
    delivery_address: 'Place du marché',
    contact_name: 'M. Durand',
    contact_phone: '0600000000',
  };

  const brocante = {
    id: 2,
    title: 'Brocante',
    status: 'delivered',
    date_start: '2026-07-09',
    date_end: '2026-07-11',
    recovery_date: '2026-07-11',
  };

  const lignes = new Map<number, LigneTournee[]>([
    [1, [ligne({ ligne_id: 10, demande: 40 })]],
    [2, [ligne({ ligne_id: 20, demande: 30, livre: 30, rendu: 28 })]],
  ]);

  it('range une manifestation confirmée dans les livraisons, une livrée dans les récupérations', () => {
    const t = assemblerTournee([fete, brocante], lignes, AUJOURDHUI, AUJOURDHUI);

    expect(t.livraisons.map((a) => a.titre)).toEqual(['Fête de la musique']);
    expect(t.recuperations.map((a) => a.titre)).toEqual(['Brocante']);
  });

  it('signale le retard et reporte le contact et le lieu', () => {
    const t = assemblerTournee([fete, brocante], lignes, AUJOURDHUI, AUJOURDHUI);

    expect(t.livraisons[0]).toMatchObject({
      retard: 0,
      lieu: 'Place du marché',
      contact_nom: 'M. Durand',
      contact_tel: '0600000000',
      reste: 40,
      etat: 'a_faire',
    });
    expect(t.recuperations[0]).toMatchObject({ retard: 3, reste: 2, etat: 'commence' });
  });

  it("retient ce qui est dû jusqu'à la borne, retards compris, et rien au-delà", () => {
    const demain = {
      ...fete,
      id: 3,
      title: 'Cérémonie',
      delivery_date: '2026-07-15',
      date_start: '2026-07-15',
    };
    const avecDemain = new Map(lignes);
    avecDemain.set(3, [ligne({ ligne_id: 30, demande: 5 })]);

    const jour = assemblerTournee([fete, demain], avecDemain, AUJOURDHUI, AUJOURDHUI);
    expect(jour.livraisons.map((a) => a.titre)).toEqual(['Fête de la musique']);

    const veille = assemblerTournee([fete, demain], avecDemain, AUJOURDHUI, '2026-07-15');
    expect(veille.livraisons.map((a) => a.titre)).toEqual(['Fête de la musique', 'Cérémonie']);
  });

  it('met le plus en retard en tête', () => {
    const vieille = {
      ...brocante,
      id: 4,
      title: 'Vide-grenier',
      recovery_date: '2026-06-30',
      date_end: '2026-06-30',
    };
    const avecVieille = new Map(lignes);
    avecVieille.set(4, [ligne({ ligne_id: 40, demande: 12, livre: 12 })]);

    const t = assemblerTournee([brocante, vieille], avecVieille, AUJOURDHUI, AUJOURDHUI);
    expect(t.recuperations.map((a) => a.titre)).toEqual(['Vide-grenier', 'Brocante']);
    expect(t.recuperations[0].retard).toBe(14);
  });

  it('écarte un arrêt sans matériel : ce n’est pas un déplacement', () => {
    const vide = { ...fete, id: 5, title: 'Réunion publique' };
    const t = assemblerTournee([fete, vide], lignes, AUJOURDHUI, AUJOURDHUI);

    expect(t.livraisons.map((a) => a.titre)).toEqual(['Fête de la musique']);
  });

  it('écarte un arrêt qu’aucune date ne situe, plutôt que de le montrer tous les jours', () => {
    const sansDate = { id: 6, title: 'Demande incomplète', status: 'validated' };
    const avecSansDate = new Map(lignes);
    avecSansDate.set(6, [ligne({ ligne_id: 60, demande: 3 })]);

    const t = assemblerTournee([fete, sansDate], avecSansDate, AUJOURDHUI, AUJOURDHUI);
    expect(t.livraisons.map((a) => a.titre)).toEqual(['Fête de la musique']);
  });

  it('garde un arrêt entièrement saisi, marqué fait, tant que le statut n’a pas suivi', () => {
    const tout = new Map<number, LigneTournee[]>([[1, [ligne({ demande: 40, livre: 40 })]]]);
    const t = assemblerTournee([fete], tout, AUJOURDHUI, AUJOURDHUI);

    expect(t.livraisons).toHaveLength(1);
    expect(t.livraisons[0]).toMatchObject({ etat: 'fait', reste: 0, fait: 40 });
  });

  it('retire les prestations de ce qu’on va rechercher, sans toucher à la livraison', () => {
    const avecPrestation = new Map<number, LigneTournee[]>([
      [
        2,
        [
          ligne({ ligne_id: 20, demande: 30, livre: 30, rendu: 30 }),
          ligne({ ligne_id: 21, nature: 'prestation', nom: 'Raccordement', demande: 1, livre: 1 }),
        ],
      ],
    ]);

    const t = assemblerTournee([brocante], avecPrestation, AUJOURDHUI, AUJOURDHUI);
    expect(t.recuperations[0].lignes.map((l) => l.nom)).toEqual(['Chaise pliante']);
  });
});
