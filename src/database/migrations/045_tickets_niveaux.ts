import type { ContexteMigration, Migration } from './types';

/**
 * Ce qu'une personne fait d'une catégorie de demandes : la demander, y
 * intervenir, ou la superviser.
 *
 * « Le grand responsable du service technique voit tout le technique ; celui
 * qui gère les interventions dans les bâtiments ne voit pas les espaces verts ;
 * un référent ne voit que ce qui lui est attribué ; l'informatique n'a pas à
 * voir la maintenance, et inversement. » Le service ne savait pas le dire : le
 * responsable des bâtiments est membre du service technique, et
 * `service_id IN (mes services)` lui ouvrait les espaces verts avec.
 *
 * `user_ticket_categories` disait déjà « ce qu'une personne a le droit de
 * demander », une ligne par catégorie racine. Elle reçoit `niveau` :
 *
 *   `demandeur`              demande dans cette catégorie, voit ses demandes
 *   `intervenant`            le référent : n'intervient que sur ce qu'on lui confie
 *   `intervenant_categorie`  intervient sur toutes les demandes de la catégorie
 *   `superviseur`            tout cela, plus valider ce que ses agents clôturent
 *
 * Chaque niveau comprend le précédent : qui intervient peut aussi demander.
 * Les sous-catégories suivent leur racine, comme pour le droit de demander.
 *
 * ## Le rattrapage ne retire rien
 *
 * Qui voyait les demandes d'une catégorie par son service continue de les voir :
 * un membre du service routé par la catégorie — ou par l'une de ses
 * sous-catégories — devient `intervenant_categorie`, son responsable
 * (`is_manager`) `superviseur`. Une ligne existante n'est que montée, jamais
 * descendue, et garde son `materiel_autorise` : rejouer la migration ne change
 * rien.
 *
 * Deux effets sont assumés, et c'est à l'administrateur d'affiner ensuite dans
 * l'écran des utilisateurs :
 *   - ces personnes voient désormais la catégorie dans leur formulaire de
 *     demande, puisque tout niveau comprend le droit de demander ;
 *   - un membre d'un service que seule une sous-catégorie route reçoit toute la
 *     racine, puisque le niveau porte sur la racine.
 */
const NIVEAUX = ['demandeur', 'intervenant', 'intervenant_categorie', 'superviseur'];

const ticketsNiveaux: Migration = {
  id: '045_tickets_niveaux',
  description: 'Niveau par catégorie de demande : demandeur, intervenant, intervenant de la catégorie, superviseur',

  async up(ctx) {
    const colonnes = await colonnesDe(ctx, 'user_ticket_categories');
    if (colonnes.size === 0) return;

    if (!colonnes.has('niveau')) {
      await ctx.executer(
        `ALTER TABLE user_ticket_categories ADD COLUMN niveau VARCHAR(30) NOT NULL DEFAULT 'demandeur'`
      );
    }
    await ctx.creerIndex('idx_user_tcat_niveau', 'user_ticket_categories', 'user_id, niveau');

    if ((await colonnesDe(ctx, 'service_members')).size === 0) return;

    // Les services que chaque racine route, par elle-même ou par ses filles.
    const categories = await ctx.interroger<{ id: number; parent_id: number | null; service_id: number | null }>(
      'SELECT id, parent_id, service_id FROM ticket_categories'
    );
    const racineDe = new Map<number, number>();
    for (const c of categories) racineDe.set(Number(c.id), c.parent_id ? Number(c.parent_id) : Number(c.id));

    const servicesParRacine = new Map<number, Set<number>>();
    for (const c of categories) {
      if (!c.service_id) continue;
      const racine = racineDe.get(Number(c.id))!;
      if (!servicesParRacine.has(racine)) servicesParRacine.set(racine, new Set());
      servicesParRacine.get(racine)!.add(Number(c.service_id));
    }
    if (servicesParRacine.size === 0) return;

    const membres = await ctx.interroger<{ service_id: number; user_id: number; is_manager: any }>(
      'SELECT service_id, user_id, is_manager FROM service_members'
    );

    // Le niveau visé par personne et par racine : le plus haut qu'un de ses
    // services lui vaut.
    const vises = new Map<string, { userId: number; racine: number; niveau: string }>();
    for (const [racine, services] of servicesParRacine) {
      for (const m of membres) {
        if (!services.has(Number(m.service_id))) continue;
        const niveau = Number(m.is_manager) ? 'superviseur' : 'intervenant_categorie';
        const cle = `${m.user_id}:${racine}`;
        const deja = vises.get(cle);
        if (!deja || NIVEAUX.indexOf(niveau) > NIVEAUX.indexOf(deja.niveau)) {
          vises.set(cle, { userId: Number(m.user_id), racine, niveau });
        }
      }
    }

    for (const { userId, racine, niveau } of vises.values()) {
      const [ligne] = await ctx.interroger<{ id: number; niveau: string | null }>(
        'SELECT id, niveau FROM user_ticket_categories WHERE user_id = ? AND ticket_categorie_id = ?',
        [userId, racine]
      );
      if (!ligne) {
        await ctx.executer(
          'INSERT INTO user_ticket_categories (user_id, ticket_categorie_id, niveau) VALUES (?, ?, ?)',
          [userId, racine, niveau]
        );
      } else if (NIVEAUX.indexOf(niveau) > NIVEAUX.indexOf(ligne.niveau ?? 'demandeur')) {
        await ctx.executer('UPDATE user_ticket_categories SET niveau = ? WHERE id = ?', [niveau, ligne.id]);
      }
    }
  },
};

/**
 * Colonnes existantes d'une table, dans les deux dialectes supportés.
 * Recopié plutôt que partagé : une migration décrit l'état du code au jour où
 * elle a été écrite.
 */
async function colonnesDe(ctx: ContexteMigration, table: string): Promise<Set<string>> {
  if (ctx.dialecte === 'sqlite') {
    const lignes = await ctx.interroger<{ name: string }>(`PRAGMA table_info(${table})`);
    return new Set(lignes.map((l) => l.name));
  }

  const lignes = await ctx.interroger<{ COLUMN_NAME?: string; column_name?: string }>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return new Set(lignes.map((l) => (l.COLUMN_NAME ?? l.column_name)!).filter(Boolean));
}

export default ticketsNiveaux;
