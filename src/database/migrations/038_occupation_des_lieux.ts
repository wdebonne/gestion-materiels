import type { Migration } from './types';

/**
 * Qui occupe quel lieu, et quand.
 *
 * La question ne se posait nulle part. `manifestations.location` est du texte
 * libre, et le formulaire de demande envoie ses salles en une phrase — « Mairie
 * : Salle des mariages ; Maison Pour Tous : Le hall » — conservée telle quelle
 * dans `intake_details` depuis la migration 029. On savait donc ce qui avait été
 * demandé, et jamais ce qui était pris.
 *
 * Le résultat tenait de l'agenda mural : la salle des mariages était réservée le
 * 28 septembre de 16h à 18h dans la tête du régisseur, et la deuxième demande
 * pour le même créneau se découvrait au téléphone, ou le jour même.
 *
 * ## Un créneau, et non une réservation de matériel
 *
 * `reservations` existe déjà et ne convient pas : elle porte un `object_id`, et
 * une salle n'est pas un matériel du parc. La ranger là obligerait à inventer un
 * `objects` par salle, qui entrerait dans l'inventaire, dans l'amortissement et
 * dans les exports comptables.
 *
 * ## `site_id` est renseigné même quand `piece_id` l'est
 *
 * C'est une dénormalisation, et elle est délibérée — la même que
 * `visibilite_site` à côté de `site_id` dans la migration 032, pour la même
 * raison. La question qui compte est hiérarchique : « qu'est-ce qui touche ce
 * bâtiment sur ce créneau », parce que réserver la mairie entière doit heurter
 * la salle des mariages. Elle se lit alors d'un seul index, sans jointure sur
 * `site_pieces`. Le service tient la cohérence des deux colonnes.
 *
 * ## `annule` ne bloque pas, `demande` avertit
 *
 * Trois statuts, et non deux. Une demande déposée mais pas encore arbitrée doit
 * se voir sans interdire : c'est au superviseur de trancher entre deux
 * associations, et un refus automatique ferait perdre la seconde demande. C'est
 * exactement le traitement que `reservation.routes.ts` réserve déjà à `pending`,
 * qu'elle signale à l'écran sans le compter parmi les `STATUTS_BLOQUANTS`.
 *
 * ## Les bornes sont exclusives — voir `occupationLieux.service.ts`
 *
 * `debut` et `fin` sont des `DATETIME`, et le chevauchement s'écrit
 * `debut < ? AND fin > ?`, à l'inverse de `reservations`. Une salle libérée à
 * 18h00 est reprise à 18h00 ; un matériel n'est pas rendu et repris dans la même
 * seconde. Le raisonnement complet est dans le service, avec la règle.
 */
const occupationDesLieux: Migration = {
  id: '038_occupation_des_lieux',
  description: 'Créneaux d’occupation des bâtiments et des pièces, liés ou non à une manifestation',

  async up(ctx) {
    const { autoIncrement, texteLong, horodatageParDefaut } = ctx;

    /*
     * `titre` est recopié plutôt que lu par jointure sur la manifestation.
     * L'agenda d'une salle doit rester lisible quand l'occupation n'a pas de
     * manifestation derrière — un mariage, une réunion de conseil, un chantier —
     * et c'est le cas le plus courant du régisseur.
     *
     * `manifestation_id` en CASCADE : une manifestation supprimée emporte les
     * créneaux qu'elle seule justifiait. Une occupation saisie à la main n'en a
     * pas, et survit à tout.
     */
    await ctx.executer(
      `CREATE TABLE IF NOT EXISTS lieu_occupations (
        id INTEGER PRIMARY KEY ${autoIncrement},
        site_id INTEGER NOT NULL,
        piece_id INTEGER,
        manifestation_id INTEGER,
        titre VARCHAR(255) NOT NULL,
        debut DATETIME NOT NULL,
        fin DATETIME NOT NULL,
        statut VARCHAR(20) NOT NULL DEFAULT 'confirme',
        demandeur VARCHAR(255),
        notes ${texteLong},
        created_by INTEGER,
        created_at DATETIME ${horodatageParDefaut},
        updated_at DATETIME ${horodatageParDefaut},
        FOREIGN KEY (site_id) REFERENCES cle_sites(id) ON DELETE CASCADE,
        FOREIGN KEY (piece_id) REFERENCES site_pieces(id) ON DELETE CASCADE,
        FOREIGN KEY (manifestation_id) REFERENCES manifestations(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`
    );

    /*
     * Les deux index portent le créneau avec le lieu. La recherche de conflit
     * est toujours « ce lieu, entre ces deux instants » : un index sur le seul
     * identifiant obligerait à relire toutes les occupations passées du
     * bâtiment pour en écarter 99 %.
     */
    await ctx.creerIndex('idx_lieu_occ_site', 'lieu_occupations', 'site_id, debut, fin');
    await ctx.creerIndex('idx_lieu_occ_piece', 'lieu_occupations', 'piece_id, debut, fin');
    await ctx.creerIndex('idx_lieu_occ_manif', 'lieu_occupations', 'manifestation_id');
  },
};

export default occupationDesLieux;
