import JSZip from 'jszip';
import {
  completerDonneesManquantes,
  detecterChamps,
  estDocxValide,
  remplirModele,
} from '../src/services/modeleDocx.service';

/**
 * Modèles `.docx` : détection des champs et remplissage.
 *
 * Le cas qui justifie ces essais est celui du **découpage en runs** : Word coupe
 * volontiers `{date_livraison}` sur plusieurs `<w:t>` — il suffit d'une
 * correction orthographique, d'un mot mis en gras, ou d'un simple aller-retour
 * dans le document. Un modèle parfaitement valide paraîtrait alors ne contenir
 * aucun champ, et l'écran de correspondance resterait vide sans rien expliquer.
 */

const TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/** Un paragraphe, dont le texte peut être réparti sur plusieurs runs. */
function paragraphe(...morceaux: string[]): string {
  const runs = morceaux
    .map((m) => `<w:r><w:t xml:space="preserve">${m}</w:t></w:r>`)
    .join('');
  return `<w:p>${runs}</w:p>`;
}

/** Un `.docx` minimal mais authentique, que Word saurait ouvrir. */
async function docx(...paragraphes: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
     <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
       <w:body>${paragraphes.join('')}</w:body>
     </w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Texte visible du document produit, runs recollés. */
async function texteDe(contenu: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(contenu);
  const xml = await zip.files['word/document.xml'].async('string');
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
}

describe('Détection des champs', () => {
  it('trouve un champ écrit d’un seul tenant', async () => {
    const champs = await detecterChamps(await docx(paragraphe('Objet : {manifestation}')));
    expect(champs).toEqual(['manifestation']);
  });

  it('trouve un champ que Word a coupé en plusieurs runs', async () => {
    // C'est ce que produit une correction orthographique au milieu d'une balise.
    const champs = await detecterChamps(
      await docx(paragraphe('Livraison le {date', '_livr', 'aison}'))
    );
    expect(champs).toEqual(['date_livraison']);
  });

  it("n'invente pas de champ à cheval sur deux paragraphes", async () => {
    // Recoller tout le document ferait apparaître « fin} … {début » comme un
    // champ, alors qu'une balise ne traverse jamais un paragraphe.
    const champs = await detecterChamps(
      await docx(paragraphe('Total : 30}'), paragraphe('{lieu} — fin'))
    );
    expect(champs).toEqual(['lieu']);
  });

  it('ne compte une liste qu’une fois, ouverture et fermeture confondues', async () => {
    const champs = await detecterChamps(
      await docx(paragraphe('{#materiels}{nom} × {quantite}{/materiels}'))
    );
    expect(champs).toEqual(['materiels', 'nom', 'quantite']);
  });

  it('rend les entités XML sous leur forme lisible', async () => {
    // Word encode l'esperluette : la laisser telle quelle obligerait à recopier
    // « &amp; » dans l'écran de correspondance, où personne ne la reconnaîtrait.
    const champs = await detecterChamps(await docx(paragraphe('{arrêté &amp; plan}')));
    expect(champs).toEqual(['arrêté & plan']);
  });

  it('lit aussi les en-têtes et pieds de page', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', TYPES);
    zip.file('_rels/.rels', RELS);
    zip.file('word/document.xml', `<w:document><w:body>${paragraphe('{lieu}')}</w:body></w:document>`);
    zip.file('word/header1.xml', `<w:hdr>${paragraphe('{manifestation}')}</w:hdr>`);
    zip.file('word/footer1.xml', `<w:ftr>${paragraphe('{date_du_jour}')}</w:ftr>`);

    const champs = await detecterChamps(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(champs.sort()).toEqual(['date_du_jour', 'lieu', 'manifestation']);
  });

  it('trie les champs en français', async () => {
    const champs = await detecterChamps(
      await docx(paragraphe('{zone} {état} {adresse}'))
    );
    expect(champs).toEqual(['adresse', 'état', 'zone']);
  });

  it('ne rend rien pour un document sans champ', async () => {
    expect(await detecterChamps(await docx(paragraphe('Aucun champ ici.')))).toEqual([]);
  });
});

describe('Fichier accepté ou refusé', () => {
  it('accepte un .docx', async () => {
    expect(await estDocxValide(await docx(paragraphe('{lieu}')))).toBe(true);
  });

  it('refuse un fichier qui n’est pas une archive', async () => {
    expect(await estDocxValide(Buffer.from('un vrai texte, pas un docx'))).toBe(false);
  });

  it('refuse une archive sans document Word', async () => {
    const zip = new JSZip();
    zip.file('lisezmoi.txt', 'rien à voir');
    expect(await estDocxValide(await zip.generateAsync({ type: 'nodebuffer' }))).toBe(false);
  });
});

describe('Remplissage', () => {
  it('remplace les champs par leurs valeurs', async () => {
    const produit = await remplirModele(
      await docx(paragraphe('Manifestation : {manifestation}, le {date_debut}')),
      { manifestation: 'Fête de la musique', date_debut: '21/06/2026' }
    );

    const texte = await texteDe(produit);
    expect(texte).toContain('Fête de la musique');
    expect(texte).toContain('21/06/2026');
    expect(texte).not.toContain('{manifestation}');
  });

  it('répète une liste autant de fois qu’elle a de lignes', async () => {
    const produit = await remplirModele(
      await docx(paragraphe('{#materiels}{nom} × {quantite}; {/materiels}')),
      {
        materiels: [
          { nom: 'Chaise', quantite: 50 },
          { nom: 'Table', quantite: 10 },
        ],
      }
    );

    const texte = await texteDe(produit);
    expect(texte).toContain('Chaise');
    expect(texte).toContain('Table');
    expect(texte).toContain('50');
    expect(texte).toContain('10');
  });

  it('remplit un champ que Word avait coupé en plusieurs runs', async () => {
    const produit = await remplirModele(
      await docx(paragraphe('Lieu : {li', 'eu}')),
      { lieu: 'Place du marché' }
    );
    expect(await texteDe(produit)).toContain('Place du marché');
  });

  it('n’imprime jamais une accolade dans le document produit', async () => {
    // Un arrêté municipal portant « {montant} » en toutes lettres serait signé
    // tel quel par quelqu'un qui ne l'a pas relu : c'est le défaut à ne pas
    // laisser passer.
    const champs = ['manifestation', 'montant'];
    const produit = await remplirModele(
      await docx(paragraphe('{manifestation} — {montant}')),
      completerDonneesManquantes({ manifestation: 'Brocante' }, champs)
    );

    const texte = await texteDe(produit);
    expect(texte).toContain('Brocante');
    expect(texte).not.toContain('{montant}');
  });
});

describe('Complément des données', () => {
  it('ajoute une valeur vide pour un champ attendu et absent', () => {
    expect(completerDonneesManquantes({ lieu: 'Salle des fêtes' }, ['lieu', 'montant'])).toEqual({
      lieu: 'Salle des fêtes',
      montant: '',
    });
  });

  it('ne remplace pas une valeur déjà fournie, fût-elle vide ou nulle', () => {
    expect(completerDonneesManquantes({ lieu: '', quantite: 0 }, ['lieu', 'quantite'])).toEqual({
      lieu: '',
      quantite: 0,
    });
  });

  it('laisse intactes les valeurs qu’aucun champ ne réclame', () => {
    expect(completerDonneesManquantes({ materiels: [{ nom: 'Chaise' }] }, [])).toEqual({
      materiels: [{ nom: 'Chaise' }],
    });
  });
});
