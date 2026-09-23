import type { Migration } from './types';

/**
 * L'adresse d'abonnement à l'agenda d'une salle.
 *
 * Les occupations existent depuis la migration 038, et se lisent dans
 * l'application. Le régisseur des salles, l'élu aux associations et l'amicale
 * qui occupe le préau tous les mardis ne s'y connecteront pas pour autant : ils
 * ont déjà un agenda, et c'est là qu'ils regardent. Un agenda qu'il faut aller
 * consulter ailleurs n'est pas consulté.
 *
 * `lieu_jetons` porte donc une URL par abonné, à coller dans Google Agenda,
 * Outlook ou Apple Calendrier. Le flux est en lecture seule : on publie ce que
 * l'application sait, on ne reprend rien de ce que l'abonné écrit chez lui.
 *
 * ## Un jeton par destinataire, et non un par lieu
 *
 * C'est le seul écart avec `cle_jetons`, qui tient un jeton unique par objet —
 * parce qu'il est imprimé sur une étiquette collée sur le trousseau : il n'y a
 * qu'une étiquette, il n'y a qu'un jeton.
 *
 * Ici il y a autant d'abonnés qu'on en invite, et ils ne se valent pas. Retirer
 * l'accès à une association qui n'occupe plus la salle ne doit pas casser
 * l'abonnement du régisseur et de l'élu, qui n'y sont pour rien. Un jeton unique
 * obligerait à le régénérer, donc à prévenir tout le monde de recoller une
 * nouvelle URL — et personne ne le ferait, si bien qu'on ne révoquerait jamais.
 *
 * `label` dit à qui l'URL a été donnée, faute de quoi la liste des abonnés est
 * une colonne de jetons illisibles dont plus personne n'ose retirer aucun.
 *
 * ## Révoqué, et non supprimé
 *
 * `revoked_at` plutôt qu'un `DELETE` : la question « qui avait accès à l'agenda
 * de cette salle en septembre » se pose après coup, et une ligne effacée n'y
 * répond pas. La route publique traite un jeton révoqué comme inconnu — un 404,
 * jamais un 403, parce qu'une URL révoquée doit disparaître et non annoncer
 * qu'elle a existé.
 *
 * `piece_id` nul désigne le bâtiment entier : l'agenda porte alors toutes ses
 * pièces, ce qui est exactement ce que veut le gardien d'une école.
 */
const agendasDeLieu: Migration = {
  id: '039_agendas_de_lieu',
  description: 'Jetons d’abonnement aux agendas de lieu, étiquetés et révocables un par un',

  async up(ctx) {
    const { autoIncrement, horodatageParDefaut } = ctx;

    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS lieu_jetons (
        id INTEGER PRIMARY KEY ${autoIncrement},
        site_id INTEGER NOT NULL,
        piece_id INTEGER,
        token VARCHAR(32) NOT NULL UNIQUE,
        label VARCHAR(255),
        revoked_at DATETIME,
        created_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (site_id) REFERENCES cle_sites(id) ON DELETE CASCADE,
        FOREIGN KEY (piece_id) REFERENCES site_pieces(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );

    /*
     * La lecture la plus fréquente est « à quel lieu correspond ce jeton »,
     * faite à chaque rafraîchissement de chaque abonné — un agenda interroge
     * toutes les quelques heures, et il y a autant d'abonnés que d'URL
     * distribuées. `token` est déjà unique, donc indexé ; c'est l'autre sens,
     * « les abonnés de ce lieu », que l'écran de partage demande et qui mérite
     * le sien.
     */
    await ctx.creerIndex('idx_lieu_jetons_site', 'lieu_jetons', 'site_id');
    await ctx.creerIndex('idx_lieu_jetons_piece', 'lieu_jetons', 'piece_id');
  },
};

export default agendasDeLieu;
