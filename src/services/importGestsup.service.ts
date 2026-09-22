import { db } from '../database';
import { statutParDefaut, normaliserCategorie } from './ticketsReferentiel.service';
import { prochaineSequence, versDateTime } from './tickets.service';

/**
 * La reprise de l'historique GestSup.
 *
 * L'enjeu n'est pas de recopier des lignes : c'est que « M. Dupont a déjà
 * signalé le rideau cassé » fonctionne **dès le premier jour**. Un module de
 * demandes sans passé ne prévient aucun doublon, et c'était la moitié de la
 * raison d'être du rattachement au bâtiment.
 *
 * ## Trois règles, et chacune répond à un échec prévisible
 *
 * **Rejouable.** `tickets.reference_externe` porte l'identifiant d'origine
 * (`gestsup:4711`). Relancer une reprise interrompue ne crée pas de doublons,
 * et corriger un fichier puis le reverser met à jour au lieu d'empiler. Sans
 * cela, la première erreur oblige à vider la table à la main — ce que personne
 * n'ose faire sur une base de production.
 *
 * **Un essai à blanc, obligatoire dans l'écran.** L'import rend ce qu'il
 * ferait — créé, mis à jour, non rapproché — sans rien écrire. Découvrir après
 * coup que trois cents demandes ont atterri sur la mauvaise catégorie coûte
 * bien plus cher que de lire un tableau avant.
 *
 * **Ce qui ne se rapproche pas est dit, pas deviné.** Un demandeur introuvable
 * n'est pas remplacé par l'administrateur, et une catégorie inconnue n'est pas
 * rangée dans la première venue : la ligne est reportée telle quelle dans le
 * rapport. Deviner produirait un historique faux, qu'on croirait vrai.
 *
 * ## Le rapprochement des personnes
 *
 * Par adresse d'abord — c'est la seule clé fiable — puis par nom complet
 * normalisé. À défaut, la personne est **créée à l'annuaire avec
 * `can_login = 0`** : c'est exactement ce que la migration 028 a prévu pour le
 * gardien et l'élu, et cela vaut mieux qu'un historique dont l'auteur est
 * « inconnu ». Elle ne reçoit aucun accès.
 */

export interface LigneGestsup {
  /** Identifiant d'origine : c'est lui qui rend l'import rejouable. */
  id: string | number;
  titre: string;
  description?: string | null;
  demandeur_email?: string | null;
  demandeur_nom?: string | null;
  categorie?: string | null;
  statut?: string | null;
  batiment?: string | null;
  technicien_email?: string | null;
  cree_le?: string | null;
  resolu_le?: string | null;
  /** Le fil, si l'export le porte. */
  suivi?: Array<{ auteur?: string | null; corps: string; date?: string | null }>;
}

export interface RapportImport {
  /** Rien n'a été écrit. */
  essaiABlanc: boolean;
  crees: number;
  misAJour: number;
  ignorees: number;
  personnesCreees: string[];
  /** Ce qui n'a pas pu être rapproché, ligne par ligne. */
  nonRapproches: Array<{ ligne: string | number; quoi: string; valeur: string }>;
  erreurs: Array<{ ligne: string | number; message: string }>;
}

/**
 * Une date d'export, ramenée au format que les deux moteurs relisent.
 *
 * GestSup exporte `2026-09-15 17:36:00`. Le confier tel quel à `new Date()`
 * est sans danger, mais le repasser par `toISOString()` le décalerait du fuseau
 * — c'est le défaut que la migration 031 documente. On garde donc la chaîne
 * telle quelle quand elle a déjà la bonne forme.
 */
export function normaliserDate(valeur: unknown): string | null {
  const brut = String(valeur ?? '').trim();
  if (!brut) return null;

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(brut)) {
    return brut.replace('T', ' ').slice(0, 19).padEnd(19, ':00').slice(0, 19);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(brut)) return `${brut} 00:00:00`;

  // Format français, que certains exports produisent.
  const fr = brut.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (fr) {
    const [, j, m, a, h = '00', min = '00'] = fr;
    return `${a}-${m}-${j} ${h}:${min}:00`;
  }
  return null;
}

/** Une correspondance déjà établie, ou `undefined` si elle n'a jamais été vue. */
async function correspondance(domaine: string, valeur: string): Promise<number | null | undefined> {
  const ligne = await db.queryOne(
    'SELECT cible_id FROM ticket_import_correspondances WHERE domaine = ? AND valeur_source = ?',
    [domaine, valeur]
  );
  if (!ligne) return undefined;
  return ligne.cible_id === null || ligne.cible_id === undefined ? null : Number(ligne.cible_id);
}

async function retenirCorrespondance(
  domaine: string,
  valeur: string,
  cibleId: number | null,
  auteurId: number | null
): Promise<void> {
  const maintenant = versDateTime();
  const existante = await db.queryOne(
    'SELECT id FROM ticket_import_correspondances WHERE domaine = ? AND valeur_source = ?',
    [domaine, valeur]
  );
  if (existante) {
    await db.execute(
      'UPDATE ticket_import_correspondances SET cible_id = ?, updated_at = ? WHERE id = ?',
      [cibleId, maintenant, existante.id]
    );
    return;
  }
  await db.execute(
    `INSERT INTO ticket_import_correspondances (domaine, valeur_source, cible_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [domaine, valeur.slice(0, 190), cibleId, auteurId, maintenant, maintenant]
  );
}

/** Retrouve une catégorie par son nom, à la casse et aux accents près. */
async function categorieParNom(nom: string): Promise<number | null> {
  const ligne = await db.queryOne(
    'SELECT id FROM ticket_categories WHERE name_normalise = ? ORDER BY parent_cle ASC LIMIT 1',
    [normaliserCategorie(nom)]
  );
  return ligne ? Number(ligne.id) : null;
}

async function statutParNom(nom: string): Promise<number | null> {
  const normalise = normaliserCategorie(nom);
  const statuts = await db.query('SELECT id, nom FROM ticket_statuts');
  const trouve = statuts.find((s: any) => normaliserCategorie(s.nom) === normalise);
  return trouve ? Number(trouve.id) : null;
}

async function siteParNom(nom: string): Promise<number | null> {
  const normalise = normaliserCategorie(nom);
  const sites = await db.query('SELECT id, name FROM cle_sites');
  const trouve = sites.find((s: any) => normaliserCategorie(s.name) === normalise);
  return trouve ? Number(trouve.id) : null;
}

/**
 * Retrouve ou crée la personne d'une ligne d'export.
 *
 * Rend `null` si la ligne ne porte ni adresse ni nom : on ne fabrique pas un
 * auteur de toutes pièces.
 */
async function personne(
  email: string | null | undefined,
  nomComplet: string | null | undefined,
  essaiABlanc: boolean,
  creees: string[]
): Promise<number | null> {
  const adresse = String(email ?? '').trim().toLowerCase();
  if (adresse) {
    const parEmail = await db.queryOne('SELECT id FROM users WHERE LOWER(email) = ?', [adresse]);
    if (parEmail) return Number(parEmail.id);
  }

  const nom = String(nomComplet ?? '').trim();
  if (nom) {
    const normalise = normaliserCategorie(nom);
    const comptes = await db.query('SELECT id, first_name, last_name FROM users');
    const trouve = comptes.find(
      (c: any) => normaliserCategorie([c.first_name, c.last_name].filter(Boolean).join(' ')) === normalise
    );
    if (trouve) return Number(trouve.id);
  }

  if (!adresse && !nom) return null;

  // Ni l'un ni l'autre n'a répondu : on inscrit la personne à l'annuaire, sans
  // lui ouvrir d'accès. C'est ce que la migration 028 a prévu, et cela vaut
  // mieux qu'un historique dont l'auteur est « inconnu ».
  const etiquette = nom || adresse;
  creees.push(etiquette);
  if (essaiABlanc) return null;

  const morceaux = nom.split(/\s+/);
  const prenom = morceaux.length > 1 ? morceaux.slice(0, -1).join(' ') : nom;
  const patronyme = morceaux.length > 1 ? morceaux[morceaux.length - 1] : '';

  const resultat = await db.execute(
    `INSERT INTO users (email, first_name, last_name, role, is_active, can_login, created_at, updated_at)
     VALUES (?, ?, ?, 'user', 1, 0, ?, ?)`,
    [adresse || null, prenom || etiquette, patronyme, versDateTime(), versDateTime()]
  );
  return Number(resultat.lastInsertRowid);
}

/**
 * Reprend un export GestSup.
 *
 * `essaiABlanc` est le mode normal de la première passe : rien n'est écrit, et
 * le rapport dit ce qui se passerait.
 */
export async function importerGestsup(
  lignes: LigneGestsup[],
  options: { essaiABlanc?: boolean; auteurId: number }
): Promise<RapportImport> {
  const essaiABlanc = options.essaiABlanc !== false;
  const rapport: RapportImport = {
    essaiABlanc,
    crees: 0,
    misAJour: 0,
    ignorees: 0,
    personnesCreees: [],
    nonRapproches: [],
    erreurs: [],
  };

  const defaut = await statutParDefaut();

  for (const ligne of lignes) {
    try {
      const titre = String(ligne.titre ?? '').trim();
      if (!ligne.id || !titre) {
        rapport.ignorees += 1;
        rapport.erreurs.push({ ligne: ligne.id ?? '?', message: 'Identifiant ou titre manquant' });
        continue;
      }

      const referenceExterne = `gestsup:${ligne.id}`;

      // --- rapprochements, chacun signalé quand il échoue

      let categorieId: number | null = null;
      if (ligne.categorie) {
        const retenue = await correspondance('categorie', ligne.categorie);
        categorieId = retenue !== undefined ? retenue : await categorieParNom(ligne.categorie);
        if (categorieId === null) {
          rapport.nonRapproches.push({ ligne: ligne.id, quoi: 'catégorie', valeur: ligne.categorie });
        } else if (retenue === undefined && !essaiABlanc) {
          await retenirCorrespondance('categorie', ligne.categorie, categorieId, options.auteurId);
        }
      }

      let siteId: number | null = null;
      if (ligne.batiment) {
        const retenu = await correspondance('site', ligne.batiment);
        siteId = retenu !== undefined ? retenu : await siteParNom(ligne.batiment);
        if (siteId === null) {
          rapport.nonRapproches.push({ ligne: ligne.id, quoi: 'bâtiment', valeur: ligne.batiment });
        } else if (retenu === undefined && !essaiABlanc) {
          await retenirCorrespondance('site', ligne.batiment, siteId, options.auteurId);
        }
      }

      let statutId = defaut?.id ?? null;
      if (ligne.statut) {
        const retenu = await correspondance('statut', ligne.statut);
        const trouve = retenu !== undefined ? retenu : await statutParNom(ligne.statut);
        if (trouve === null) {
          rapport.nonRapproches.push({ ligne: ligne.id, quoi: 'état', valeur: ligne.statut });
        } else {
          statutId = trouve;
          if (retenu === undefined && !essaiABlanc) {
            await retenirCorrespondance('statut', ligne.statut, trouve, options.auteurId);
          }
        }
      }

      if (statutId === null) {
        rapport.ignorees += 1;
        rapport.erreurs.push({ ligne: ligne.id, message: "Aucun état ne peut être attribué" });
        continue;
      }

      const demandeurId = await personne(
        ligne.demandeur_email,
        ligne.demandeur_nom,
        essaiABlanc,
        rapport.personnesCreees
      );
      if (demandeurId === null && !essaiABlanc) {
        rapport.ignorees += 1;
        rapport.erreurs.push({ ligne: ligne.id, message: 'Demandeur introuvable et non créable' });
        continue;
      }

      const technicienId = ligne.technicien_email
        ? await personne(ligne.technicien_email, null, essaiABlanc, rapport.personnesCreees)
        : null;

      const creeLe = normaliserDate(ligne.cree_le) ?? versDateTime();
      const resoluLe = normaliserDate(ligne.resolu_le);

      const existant = await db.queryOne('SELECT id FROM tickets WHERE reference_externe = ?', [
        referenceExterne,
      ]);

      if (essaiABlanc) {
        if (existant) rapport.misAJour += 1;
        else rapport.crees += 1;
        continue;
      }

      if (existant) {
        await db.execute(
          `UPDATE tickets SET titre = ?, description = ?, categorie_id = ?, site_id = ?,
                              statut_id = ?, technicien_id = ?, resolu_at = ?, ferme_at = ?, updated_at = ?
            WHERE id = ?`,
          [
            titre,
            ligne.description ?? null,
            categorieId,
            siteId,
            statutId,
            technicienId,
            resoluLe,
            resoluLe,
            versDateTime(),
            existant.id,
          ]
        );
        rapport.misAJour += 1;
        continue;
      }

      const resultat = await db.execute(
        `INSERT INTO tickets
           (titre, description, demandeur_id, site_id, categorie_id, statut_id, technicien_id,
            visibilite_site, priorite, origine, reference_externe, resolu_at, ferme_at,
            created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'normale', 'import', ?, ?, ?, ?, ?, ?)`,
        [
          titre,
          ligne.description ?? null,
          demandeurId,
          siteId,
          categorieId,
          statutId,
          technicienId,
          referenceExterne,
          resoluLe,
          resoluLe,
          options.auteurId,
          creeLe,
          creeLe,
        ]
      );

      const id = Number(resultat.lastInsertRowid);
      // La référence reprend le numéro d'origine : c'est celui que les agents
      // connaissent, et qu'ils citent encore dans leurs courriels.
      await db.execute('UPDATE tickets SET reference = ? WHERE id = ?', [
        `G-${ligne.id}`,
        id,
      ]);

      await db.execute(
        `INSERT INTO ticket_history (ticket_id, user_id, action, sequence, nouvelle_valeur, created_at)
         VALUES (?, ?, 'import', ?, ?, ?)`,
        [id, options.auteurId, await prochaineSequence(id), `Repris de GestSup (${ligne.id})`, creeLe]
      );

      for (const message of ligne.suivi ?? []) {
        const corps = String(message.corps ?? '').trim();
        if (!corps) continue;
        const auteurMessage = await personne(null, message.auteur, false, rapport.personnesCreees);
        await db.execute(
          `INSERT INTO ticket_messages (ticket_id, user_id, body, is_interne, sequence, created_at, updated_at)
           VALUES (?, ?, ?, 0, ?, ?, ?)`,
          [
            id,
            auteurMessage,
            corps,
            await prochaineSequence(id),
            normaliserDate(message.date) ?? creeLe,
            versDateTime(),
          ]
        );
      }

      rapport.crees += 1;
    } catch (erreur: any) {
      rapport.ignorees += 1;
      rapport.erreurs.push({ ligne: ligne.id ?? '?', message: erreur?.message ?? String(erreur) });
    }
  }

  rapport.personnesCreees = [...new Set(rapport.personnesCreees)];
  return rapport;
}
