import crypto from 'crypto';
import {
  CHAMPS_DETAILS,
  CHAMPS_INTAKE,
  cheminsDe,
  detailsDeLaDemande,
  detecterChamps,
  extraireManifestation,
  extraireMateriels,
  genererSecret,
  normaliserDate,
  normaliserEntier,
  normaliserHeure,
  resoudreCorrespondance,
  signatureValide,
  texteLisible,
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
  });

  it('propose aussi les groupes et les répéteurs, qui sont des réponses entières', () => {
    // « Nom et Prénom du Président » est une question, posée en deux morceaux ;
    // « un bâtiment, puis un autre » en est une aussi. Ne proposer que leurs
    // feuilles obligerait à régler un champ par morceau — et à n'annoncer que le
    // premier bâtiment réservé.
    const chemins = cheminsDe({
      data: { contact: { nom: 'Martin Dubois', email: 'martin@ville.fr' } },
      reponses: [{ valeur: 'salle des fêtes' }],
    });

    expect(chemins).toContain('data.contact');
    expect(chemins).toContain('reponses');
    // Une répétition isolée n'en est pas une : la viser perdrait les suivantes.
    expect(chemins).not.toContain('reponses.0');
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

/**
 * Une demande telle qu'un formulaire l'envoie vraiment.
 *
 * Le formulaire de demande de manifestation ne pose pas quinze questions mais
 * une quarantaine, et il les pose **par branches** : « quel service du pôle
 * Temps de l'Enfant », « quel service du pôle Administration Générale »… Une
 * seule est remplie, les autres arrivent vides. Il les pose aussi **en
 * groupes** — « Nom » et « Prénom » du président — et **en répétitions** — un
 * bâtiment, puis un autre, chacun avec ses salles.
 *
 * Sans correspondance réglée côté formulaire, les clés sont les intitulés
 * eux-mêmes : c'est la forme la plus difficile à lire, et c'est celle qu'on
 * reçoit tant que personne n'a rien réglé. Ce jeu d'essai la reproduit au
 * caractère près, ponctuation comprise.
 */
const DEMANDE_FORMULAIRE = {
  'Nom de la manifestation.': 'Fête de la musique',
  'Date de la manifestation': '21/06/2026',
  "La manifestation dure plus d'une journée ?": 'Non',
  'Date de fin de la manifestation': '',
  'A-t-elle des horaires définis ?': 'Oui',
  'Heure de la manifestation': { 'Début ?': '18:00', 'Fin ?': '23:30' },
  'Nombre de personnes attendues ?': '280',
  'Vous êtes ?': 'Association',
  "Quel service du pôle Temps de l'Enfant et de la Famille ?": '',
  'Quel service du pôle Administration Générale ?': 'Finances & Commande Publique',
  "Nom de l'association": 'Comité des fêtes',
  'Nom et Prénom du Président': { Nom: 'Dubois', Prénom: 'Martin' },
  Demandeur: {
    'Nom du Demandeur / Organisateur de la manifestation': 'Martin Dubois',
    'Numéro de téléphone': '06 12 34 56 78',
    Mail: 'martin@ville.fr',
  },
  'La manifestation se déroule t-elle en intérieur ?': [
    { 'Quel Bâtiment ?': 'Mairie', Mairie: 'Salle des mariages, Foyer des Anciens' },
    { 'Quel Bâtiment ?': 'Complexe Sportif', 'Complexe Sportif': 'Club House' },
  ],
  'La manifestation se déroule t-elle en extérieur ?': [
    { 'Quelle avenue, rue, place… ?': 'Rue Adolphe Lasne' },
  ],
  'Fermeture de la circulation ?': 'Oui',
  'Fermeture ?': 'Partielle',
  'Besoin de Matériel Technique ?': [
    {
      'Quel matériel technique ?': 'Tables Kermesse',
      'Combien avez vous besoin de Matériel Technique ??': { 'Tables Kermesse': 10 },
    },
    {
      'Quel matériel technique ?': 'Chaises Coques',
      'Combien avez vous besoin de Matériel Technique ??': { 'Chaises Coques': 50 },
    },
  ],
  'Veuillez indiquez le lieu de livraison.': 'Place du marché',
  'Veuillez indiquez la date de livraison.': '20/06/2026',
  "Besoin d'Affiches ?": 'Oui',
  'Souhaitez vous formuler une demande de débit de boisson ?': 'Oui',
  Commentaire: 'Prévoir une rallonge',
  _responseId: 'DEM-2026-014',
};

const extraitDuFormulaire = () =>
  extraireManifestation(DEMANDE_FORMULAIRE, detecterChamps(DEMANDE_FORMULAIRE)).champs;

describe('Demande telle qu’un formulaire l’envoie', () => {
  it('lit ce que la table exige, sans correspondance réglée', () => {
    const champs = extraitDuFormulaire();

    expect(champs.title).toBe('Fête de la musique');
    expect(champs.date_start).toBe('2026-06-21');
    expect(champs.expected_people).toBe(280);
  });

  it('lit les deux moitiés d’un groupe là où elles sont posées', () => {
    // « Début ? » et « Fin ? » vivent sous « Heure de la manifestation » : un
    // chemin de premier niveau ne les aurait jamais trouvées.
    const champs = extraitDuFormulaire();

    expect(champs.start_time).toBe('18:00');
    expect(champs.end_time).toBe('23:30');
    expect(champs.contact_name).toBe('Martin Dubois');
    expect(champs.contact_phone).toBe('06 12 34 56 78');
    expect(champs.contact_email).toBe('martin@ville.fr');
  });

  it('retient la branche remplie, pas la première posée', () => {
    // Trois questions portent le service demandeur, une par pôle, et le
    // demandeur n'en remplit qu'une. S'arrêter à la première laisserait le
    // service vide pour deux demandeurs sur trois.
    expect(extraitDuFormulaire().service_demandeur).toBe('Finances & Commande Publique');
  });

  it('rend un groupe d’un trait, sans accolades', () => {
    expect(extraitDuFormulaire().president).toBe('Dubois Martin');
  });

  it('garde toutes les répétitions, et ce qui va ensemble', () => {
    // Un document qui n'annoncerait que le premier bâtiment réservé serait pire
    // qu'un document muet : la salle du second resterait occupée sans le savoir.
    expect(extraitDuFormulaire().lieux_interieurs).toBe(
      'Mairie : Salle des mariages, Foyer des Anciens ; Complexe Sportif : Club House'
    );
    expect(extraitDuFormulaire().lieux_exterieurs).toBe('Rue Adolphe Lasne');
  });

  it('lit les questions que la manifestation n’a pas de colonne pour porter', () => {
    const champs = extraitDuFormulaire();

    expect(champs.type_demandeur).toBe('Association');
    expect(champs.association).toBe('Comité des fêtes');
    expect(champs.fermeture_circulation).toBe('Oui');
    expect(champs.type_fermeture).toBe('Partielle');
    expect(champs.besoin_affiches).toBe('Oui');
    expect(champs.debit_boissons).toBe('Oui');
    expect(champs.notes_interior).toBe('Prévoir une rallonge');
  });

  it('reconnaît l’identifiant de réponse, pour ne pas créer deux fois la demande', () => {
    expect(extraitDuFormulaire().external_id).toBe('DEM-2026-014');
  });

  it('ne retient pas une branche laissée vide', () => {
    expect(extraitDuFormulaire().date_end).toBeUndefined();
  });

  it('rattache le matériel d’une question répétable à quantités', () => {
    // Le formulaire ne range rien sous une clé « materiels » : il demande
    // « Quel matériel technique ? », puis « Combien ? », autant de fois qu'il
    // faut. Sans cette lecture, tout était à ressaisir à la main.
    expect(extraireMateriels(DEMANDE_FORMULAIRE)).toEqual([
      { libelle: 'Tables Kermesse', quantite: 10 },
      { libelle: 'Chaises Coques', quantite: 50 },
    ]);
  });

  it('ne prend pas un lieu pour du matériel', () => {
    // « Quel bâtiment ? » est un répéteur lui aussi, mais il ne compte rien.
    // Le confondre avec du matériel ferait chercher au stock un article nommé
    // « Mairie », et laisserait la ligne à rattacher sur chaque demande.
    const libelles = extraireMateriels(DEMANDE_FORMULAIRE).map((l) => l.libelle);
    expect(libelles).not.toContain('Mairie');
    expect(libelles).not.toContain('Rue Adolphe Lasne');
  });

  it('sépare ce qui va en colonne de ce qui reste un détail de la demande', () => {
    const details = detailsDeLaDemande(extraitDuFormulaire());
    const parCle = Object.fromEntries(details.map((d) => [d.cle, d.valeur]));

    // Un détail porte le nom sous lequel un modèle de document l'affiche, et son
    // intitulé : l'écran qui le montre n'a rien d'autre à connaître.
    expect(parCle.type_demandeur).toBe('Association');
    expect(parCle.materiel_technique).toBe('Tables Kermesse : 10 ; Chaises Coques : 50');
    expect(details.find((d) => d.cle === 'association')?.libelle).toBe('Association');

    // Ce qu'une colonne porte déjà n'est pas recopié dans les détails.
    expect(parCle.manifestation).toBeUndefined();
    expect(parCle.contact_nom).toBeUndefined();
  });

  it('n’invente pas de détail pour une question sans réponse', () => {
    const cles = detailsDeLaDemande(extraitDuFormulaire()).map((d) => d.cle);
    expect(cles).not.toContain('catering');
    expect(CHAMPS_DETAILS.some((d) => d.cleModele === 'catering')).toBe(true);
  });
});

describe('Réponses composées', () => {
  it('énumère des cases cochées, sépare des répétitions', () => {
    expect(texteLisible(['Eau', 'Electricité'])).toBe('Eau, Electricité');
    expect(texteLisible([{ a: 'Mairie' }, { a: 'Colombier' }])).toBe('Mairie ; Colombier');
  });

  it('garde le libellé d’une quantité qui, seule, ne dirait rien', () => {
    expect(texteLisible({ 'Vidéo projecteur': 2, Ecran: 1 })).toBe(
      'Vidéo projecteur : 2 ; Ecran : 1'
    );
  });

  it('ne répète pas un libellé déjà écrit à côté', () => {
    expect(texteLisible([{ quoi: 'Tables Kermesse', combien: { 'Tables Kermesse': 10 } }])).toBe(
      'Tables Kermesse : 10'
    );
  });

  it('rend vide ce qui est vide, plutôt qu’une structure', () => {
    expect(texteLisible({})).toBe('');
    expect(texteLisible([])).toBe('');
    expect(texteLisible(null)).toBe('');
  });
});
