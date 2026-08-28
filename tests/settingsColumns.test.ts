import fs from 'fs';
import path from 'path';

/**
 * Noms de colonnes de la table `settings`.
 *
 * Les routes de synchronisation calendrier interrogeaient `key` et `value`
 * alors que les colonnes s'appellent `setting_key` et `setting_value`. SQLite
 * répondait « no such column », le try/catch de la route renvoyait un 500
 * générique, et configurer une synchronisation Outlook ou CalDAV était
 * impossible — sans que rien n'indique pourquoi.
 *
 * Une erreur de nom de colonne ne se voit ni à la compilation ni à la
 * relecture : le SQL est une chaîne. Ce test la rend visible.
 */

function fichiersTypeScript(dossier: string, trouves: string[] = []): string[] {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) fichiersTypeScript(chemin, trouves);
    else if (entree.name.endsWith('.ts')) trouves.push(chemin);
  }
  return trouves;
}

const RACINE = path.join(__dirname, '..', 'src');

/** Colonnes réellement déclarées pour `settings`, lues dans le schéma. */
function colonnesDeclarees(): string[] {
  const schema = fs.readFileSync(path.join(RACINE, 'database', 'index.ts'), 'utf8');
  const bloc = schema.match(/CREATE TABLE IF NOT EXISTS settings \(([\s\S]*?)\)`/);
  if (!bloc) throw new Error('Table `settings` introuvable dans le schéma');

  return bloc[1]
    .split('\n')
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((c) => /^[a-z_]+$/.test(c));
}

describe('Table settings', () => {
  it('déclare bien `setting_key` et `setting_value`', () => {
    const colonnes = colonnesDeclarees();
    expect(colonnes).toContain('setting_key');
    expect(colonnes).toContain('setting_value');
    // Si le schéma change un jour, c'est ce test qui doit être mis à jour en
    // premier — pas les requêtes découvertes une par une en production.
    expect(colonnes).not.toContain('key');
    expect(colonnes).not.toContain('value');
  });

  it('n’est interrogée nulle part avec `key` ou `value`', () => {
    // Toute requête SQL nommant la table, sur la ligne où elle apparaît.
    const fautifs: string[] = [];

    for (const fichier of fichiersTypeScript(RACINE)) {
      const lignes = fs.readFileSync(fichier, 'utf8').split('\n');
      lignes.forEach((ligne, i) => {
        if (!/(FROM|INTO|UPDATE)\s+settings\b/i.test(ligne)) return;
        if (/\bWHERE\s+key\b|\(\s*key\s*,|\bSET\s+value\s*=/i.test(ligne)) {
          fautifs.push(`${path.relative(RACINE, fichier)}:${i + 1}  ${ligne.trim()}`);
        }
      });
    }

    expect(fautifs).toEqual([]);
  });
});
