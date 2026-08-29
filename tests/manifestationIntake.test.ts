import crypto from 'crypto';
import {
  CHAMPS_INTAKE,
  cheminsDe,
  detecterChamps,
  extraireManifestation,
  extraireMateriels,
  genererSecret,
  normaliserDate,
  normaliserEntier,
  normaliserHeure,
  resoudreCorrespondance,
  signatureValide,
  valeurAuChemin,
} from '../src/services/manifestationIntake.service';

/**
 * Réception d'une demande de manifestation.
 *
 * Les demandes arrivaient d'une application de formulaires et étaient ressaisies
 * à la main. Le contrat d'entrée n'est pas figé : ces tests protègent les deux
 * propriétés qui comptent — une charge utile non signée n'entre pas, et une
 * charge utile signée est lue quelle que soit la façon dont le formulaire nomme
 * et imbrique ses champs.
 */

const signer = (corps: string, secret: string): string =>
  'sha256=' + crypto.createHmac('sha256', secret).update(corps).digest('hex');

describe('Signature', () => {
  const secret = 'secret-de-la-source';
  const corps = JSON.stringify({ titre: 'Fête de la musique' });

  it('accepte une signature calculée sur les octets envoyés', () => {
    expect(signatureValide(corps, signer(corps, secret), secret)).toBe(true);
  });

  it('refuse une signature calculée avec un autre secret', () => {
    expect(signatureValide(corps, signer(corps, 'autre-secret'), secret)).toBe(false);
  });

  it('refuse un corps modifié après signature', () => {
    const signature = signer(corps, secret);
    const altere = JSON.stringify({ titre: 'Fête de la musique', materiels: [{ nom: 'sono' }] });
    expect(signatureValide(altere, signature, secret)).toBe(false);
  });

  it('refuse l’absence de signature', () => {
    // Sans cette garde, la route serait un dépôt public.
    expect(signatureValide(corps, undefined, secret)).toBe(false);
    expect(signatureValide(corps, '', secret)).toBe(false);
  });

  it('refuse quand la source n’a pas de secret', () => {
    expect(signatureValide(corps, signer(corps, ''), '')).toBe(false);
  });

  it('tolère l’absence de préfixe sha256=', () => {
    const brute = crypto.createHmac('sha256', secret).update(corps).digest('hex');
    expect(signatureValide(corps, brute, secret)).toBe(true);
  });

  it('compare des longueurs différentes sans lever', () => {
    // `timingSafeEqual` jette si les tampons n'ont pas la même taille : une
    // signature tronquée doit donner « faux », pas une erreur 500.
    expect(signatureValide(corps, 'sha256=trop-court', secret)).toBe(false);
  });

  it('produit un secret assez long pour ne pas se deviner', () => {
    expect(genererSecret()).toMatch(/^[0-9a-f]{64}$/);
    expect(genererSecret()).not.toBe(genererSecret());
  });
});

describe('Lecture de la charge utile', () => {
  const payload = {
    id: 'DEM-2026-014',
    data: {
      titre: 'Fête de la musique',
      contact: { nom: 'Martin Dubois', email: 'martin@ville.fr' },
    },
    reponses: [{ valeur: 'salle des fêtes' }],
  };

  it('lit un chemin pointé, y compris à travers un tableau', () => {
    expect(valeurAuChemin(payload, 'data.contact.email')).toBe('martin@ville.fr');
    expect(valeurAuChemin(payload, 'reponses.0.valeur')).toBe('salle des fêtes');
  });

  it('rend undefined plutôt que de lever sur un chemin absent', () => {
    expect(valeurAuChemin(payload, 'data.absent.encore')).toBeUndefined();
    expect(valeurAuChemin(payload, '')).toBeUndefined();
  });

  it('énumère les chemins menant à une valeur simple', () => {
    const chemins = cheminsDe(payload);
    expect(chemins).toContain('data.contact.email');
    expect(chemins).toContain('reponses.0.valeur');
    // Les nœuds intermédiaires ne sont pas des cibles.
    expect(chemins).not.toContain('data.contact');
  });

  it('borne la profondeur pour ne pas parcourir une charge utile absurde', () => {
    let imbrique: any = 'fond';
    for (let i = 0; i < 40; i++) imbrique = { suivant: imbrique };
    expect(() => cheminsDe(imbrique)).not.toThrow();
    expect(cheminsDe(imbrique)).toEqual([]);
  });
});

describe('Reconnaissance des champs', () => {
  it('reconnaît les clés quel que soit leur emplacement', () => {
    const correspondance = detecterChamps({
      data: { 'Nom de la manifestation': 'Brocante', 'Date de la manifestation': '2026-07-14' },
      contact: { Email: 'x@ville.fr' },
    });

    expect(correspondance.title).toBe('data.Nom de la manifestation');
    expect(correspondance.date_start).toBe('data.Date de la manifestation');
    expect(correspondance.contact_email).toBe('contact.Email');
  });

  it('ignore les accents, la casse et la ponctuation', () => {
    const correspondance = detecterChamps({ 'TÉLÉPHONE': '0102030405', 'Lieu_de_livraison': 'Parc' });
    expect(correspondance.contact_phone).toBe('TÉLÉPHONE');
    expect(correspondance.delivery_address).toBe('Lieu_de_livraison');
  });

  it('laisse la correspondance configurée l’emporter sur la détection', () => {
    // Un formulaire peut appeler « objet » ce qui n'est pas le titre : ce que
    // l'administrateur a réglé prime toujours.
    const payload = { objet: 'Pas le titre', libelle_reel: 'Le vrai titre' };
    const { correspondance, origine } = resoudreCorrespondance(payload, { title: 'libelle_reel' });

    expect(origine).toBe('imposee');
    expect(extraireManifestation(payload, correspondance).champs.title).toBe('Le vrai titre');
  });
});

describe('Conversion des valeurs', () => {
  it('accepte les deux écritures de date que produisent les formulaires', () => {
    expect(normaliserDate('2026-07-14')).toBe('2026-07-14');
    expect(normaliserDate('2026-07-14T09:00:00Z')).toBe('2026-07-14');
    expect(normaliserDate('14/07/2026')).toBe('2026-07-14');
    expect(normaliserDate('4/7/2026')).toBe('2026-07-04');
  });

  it('rend null sur une date non reconnue plutôt que d’en deviner une', () => {
    // Une manifestation placée au mauvais jour bloquerait le mauvais matériel.
    expect(normaliserDate('la semaine prochaine')).toBeNull();
    expect(normaliserDate('')).toBeNull();
    expect(normaliserDate(null)).toBeNull();
  });

  it('normalise les heures et les nombres', () => {
    expect(normaliserHeure('9h30')).toBe('09:30');
    expect(normaliserHeure('14:05')).toBe('14:05');
    expect(normaliserHeure('8h')).toBe('08:00');
    expect(normaliserEntier('environ 250 personnes')).toBe(250);
    expect(normaliserEntier('aucun')).toBeNull();
  });
});

describe('Extraction d’une demande', () => {
  it('refuse une demande sans titre ni date, et dit lesquels manquent', () => {
    const { manquants } = extraireManifestation({ contact: 'Martin' }, { contact_name: 'contact' });
    expect(manquants.map((m) => m.champ).sort()).toEqual(['date_start', 'title']);
  });

  it('accepte une demande incomplète dès lors que l’essentiel est là', () => {
    // Mieux vaut une demande à compléter qu'une demande perdue.
    const { champs, manquants } = extraireManifestation(
      { titre: 'Brocante', date: '14/07/2026' },
      { title: 'titre', date_start: 'date' }
    );

    expect(manquants).toEqual([]);
    expect(champs).toEqual({ title: 'Brocante', date_start: '2026-07-14' });
  });

  it('n’expose que deux champs obligatoires, ceux que la table exige', () => {
    expect(CHAMPS_INTAKE.filter((c) => c.obligatoire).map((c) => c.champ)).toEqual([
      'title',
      'date_start',
    ]);
  });
});

describe('Matériel demandé', () => {
  it('lit une liste d’objets', () => {
    const lignes = extraireMateriels({
      materiels: [
        { nom: 'Table 180 cm', quantite: 10 },
        { nom: 'Chaise', quantite: 50 },
      ],
    });
    expect(lignes).toEqual([
      { libelle: 'Table 180 cm', quantite: 10 },
      { libelle: 'Chaise', quantite: 50 },
    ]);
  });

  it('lit un objet dont les clés sont les articles', () => {
    // Forme produite par un formulaire à une case par article.
    expect(extraireMateriels({ materiels: { Tables: 8, Chaises: 40 } })).toEqual([
      { libelle: 'Tables', quantite: 8 },
      { libelle: 'Chaises', quantite: 40 },
    ]);
  });

  it('compte 1 pour un article coché sans quantité', () => {
    expect(extraireMateriels({ materiels: ['Sono', 'Vidéoprojecteur'] })).toEqual([
      { libelle: 'Sono', quantite: 1 },
      { libelle: 'Vidéoprojecteur', quantite: 1 },
    ]);
  });

  it('découpe une saisie libre « 10 tables »', () => {
    expect(extraireMateriels({ materiels: '10 tables\n50 chaises ; sono' })).toEqual([
      { libelle: 'tables', quantite: 10 },
      { libelle: 'chaises', quantite: 50 },
      { libelle: 'sono', quantite: 1 },
    ]);
  });

  it('suit le chemin et les clés configurés par l’administrateur', () => {
    const lignes = extraireMateriels(
      { demande: { lignes: [{ ref: 'Barrière', nb: 12 }] } },
      { chemin: 'demande.lignes', champ_libelle: 'ref', champ_quantite: 'nb' }
    );
    expect(lignes).toEqual([{ libelle: 'Barrière', quantite: 12 }]);
  });

  it('écarte les lignes vides ou à quantité nulle', () => {
    expect(extraireMateriels({ materiels: [{ nom: '', quantite: 5 }, { nom: 'Table', quantite: 0 }] })).toEqual([]);
  });

  it('rend une liste vide quand la demande ne porte aucun matériel', () => {
    expect(extraireMateriels({ titre: 'Réunion' })).toEqual([]);
  });
});
