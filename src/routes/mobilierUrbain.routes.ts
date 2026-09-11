import { Router, Response } from 'express';
import { db } from '../database';
import {
  authenticateToken,
  AuthRequest,
  requireFieldWrite,
  requireSupervisor,
} from '../middleware/auth.middleware';
import { logService } from '../services/log.service';
import { filtreObjets, REFUS_PORTEE } from '../middleware/objectScope';
import { lireDisponibilite, versColonne } from '../services/disponibiliteParc.service';
import {
  arbrePosable,
  expressionPosable,
  jointuresPosable,
  objetsDeLaCategorie as objetsPosablesDeLaCategorie,
  rechercherObjetsPosables,
  REFUS_POSE,
} from '../services/materielVoiePublique.service';
import { expressionNature } from '../services/lotParc.service';
import {
  aujourdhui,
  COLONNES_EXEMPLAIRE,
  ETATS,
  exemplaireComplet,
  JOINTURES_EXEMPLAIRE,
  libelleParDefaut,
  lirePosition,
  prochainNumero,
  rafraichirEcheances,
  REFUS_POSITION,
  SOURCES_POSITION,
  STATUTS,
  termeValide,
  TYPES_INTERVENTION,
} from '../services/mobilierUrbain.service';
import {
  historiques,
  lireImplantations,
  SOURCES,
  type FiltresImplantations,
  type Implantation,
} from '../services/implantations.service';
import { FONDS } from '../services/captureCarte.service';
import { dateOuNull, fusionner, nombreOuNull } from '../utils/valeursSql';

/**
 * La cartographie : où est posé le matériel du parc, et dans quel état.
 *
 * Deux fils tendus d'un bout à l'autre de ce fichier.
 *
 * **Un modèle au parc, des exemplaires sur le terrain.** Toutes les routes qui
 * écrivent vérifient donc deux choses avant d'accepter — que le compte a le
 * droit de voir ce matériel (`objectScope`), et que l'administrateur a ouvert ce
 * matériel à la pose (`materielVoiePublique`). La seconde n'est pas une redite
 * de la première : l'une dit qui regarde, l'autre dit ce que le module propose.
 *
 * **On lit partout, on écrit là où ça vit.** Les routes de lecture — liste,
 * carte, export, « où est ce matériel ? » — couvrent la voie publique **et**
 * les espaces verts, parce qu'un banc est un banc et qu'on ne veut pas chercher
 * deux fois. Les routes d'écriture ne touchent que la voie publique : un arbre
 * se modifie dans la fiche de son espace vert, où l'on voit son plan, ses
 * voisins, ses coûts et ses saisons.
 */

const router = Router();

// ======================== RÉFÉRENTIELS ========================

/**
 * GET /referentiels - Le vocabulaire du module, publié par le serveur.
 *
 * Recopié côté client, il divergerait au premier ajout : un statut connu de
 * l'écran mais refusé par la base donnerait un enregistrement qui « ne prend
 * pas » sans dire pourquoi.
 */
router.get('/referentiels', authenticateToken, async (_req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    data: {
      statuts: STATUTS,
      etats: ETATS,
      sources: SOURCES,
      sources_position: SOURCES_POSITION,
      types_intervention: TYPES_INTERVENTION,
    },
  });
});

/**
 * GET /fonds - Les fonds de carte, les mêmes que pour le plan d'un espace vert.
 *
 * Republiés ici plutôt qu'empruntés à `/green-spaces/plan/fonds` : la
 * cartographie n'a aucune raison d'appeler le module des espaces verts, et le
 * jour où l'un des deux gagnera un fond, l'autre n'aura rien à modifier.
 */
router.get('/fonds', authenticateToken, async (_req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    data: FONDS.map((f) => ({
      cle: f.cle,
      libelle: f.libelle,
      court: f.court,
      description: f.description,
      modele: f.modele,
      attribution: f.attribution,
      zoomMax: f.zoomMax,
    })),
  });
});

// ======================== RÉGLAGE DU CATALOGUE ========================
//
// Déclarées **avant** `GET /:id` : Express prend la première route qui
// correspond, et `/materiel-voie-publique` serait sinon lu comme l'identifiant
// d'un exemplaire.

/** GET /materiel-voie-publique/tree - Catégories et sous-catégories réglées. */
router.get('/materiel-voie-publique/tree', authenticateToken, requireSupervisor, async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, data: await arbrePosable() });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** GET /materiel-voie-publique/objects - Matériels d'une catégorie et leur réglage. */
router.get('/materiel-voie-publique/objects', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { category_id } = req.query;
    if (!category_id) {
      return res.status(400).json({ success: false, message: 'Catégorie requise' });
    }
    const objets = await objetsPosablesDeLaCategorie(req, String(category_id));
    if (objets === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }
    res.json({ success: true, data: objets });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** GET /materiel-voie-publique/search - Chercher un matériel dans tout le parc. */
router.get('/materiel-voie-publique/search', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const objets = await rechercherObjetsPosables(req, String(req.query.q || ''));
    if (objets === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }
    res.json({ success: true, data: objets });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /materiel-voie-publique/:niveau/:id - Régler un niveau.
 *
 * Une catégorie ne peut pas hériter : c'est elle la valeur de référence, et lui
 * permettre `null` laisserait la résolution sans point de départ.
 */
router.put('/materiel-voie-publique/:niveau/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const TABLES: Record<string, string> = {
      category: 'categories',
      subcategory: 'subcategories',
      object: 'objects',
    };
    const table = TABLES[req.params.niveau];
    if (!table) {
      return res.status(400).json({
        success: false,
        message: 'Niveau inconnu (attendu : category, subcategory ou object)',
      });
    }

    const valeur = lireDisponibilite(req.body.available);
    if (table === 'categories' && valeur === null) {
      return res.status(400).json({
        success: false,
        message: "Une catégorie ne peut pas hériter : c'est elle qui donne le ton",
      });
    }

    const resultat = await db.execute(
      `UPDATE ${table} SET available_for_public_space = ? WHERE id = ?`,
      [versColonne(valeur), req.params.id]
    );
    if (resultat.changes === 0) {
      return res.status(404).json({ success: false, message: 'Élément non trouvé' });
    }

    await logService.info(
      'other',
      `Disponibilité voie publique modifiée (${req.params.niveau} ${req.params.id})`,
      { available: valeur },
      { userId: req.user?.userId }
    );

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== CATALOGUE DE POSE ========================

/**
 * GET /catalogue - Les modèles qu'on peut poser, avec ce qui l'a déjà été.
 *
 * Le décompte n'est pas décoratif : c'est lui qui dit qu'on va poser le banc
 * n° 24 et non un vingt-quatrième banc anonyme. Il compte **les deux
 * gisements** — un banc déjà posé trois fois dans un parc et vingt fois sur les
 * trottoirs a bien été implanté vingt-trois fois —, mais seule la part voirie
 * entre dans la numérotation, qui n'a de sens que là où elle est appliquée.
 */
router.get('/catalogue', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const portee = await filtreObjets(req, 'o');
    if (portee === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }

    const terme = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const params: any[] = [...portee.params];
    let recherche = '';
    if (terme) {
      recherche = ' AND (o.name LIKE ? OR o.reference LIKE ? OR pc.name LIKE ? OR psc.name LIKE ?)';
      const motif = `%${terme}%`;
      params.push(motif, motif, motif, motif);
    }

    // Une prestation — une vacation d'agent, un raccordement — n'a pas de
    // place sur un trottoir : elle est écartée d'office, comme pour les espaces
    // verts, et sans que l'administrateur ait à la décocher une par une.
    const modeles = await db.query(
      `SELECT o.id, o.name, o.reference, o.image, o.unit_cost, o.purchase_price,
              o.material_type,
              COALESCE(o.category_id, psc.category_id) as category_id,
              pc.name as category_name,
              o.subcategory_id, psc.name as subcategory_name,
              (SELECT COUNT(*) FROM street_furniture sf WHERE sf.object_id = o.id) as poses,
              (SELECT COUNT(*) FROM green_space_elements gse WHERE gse.object_id = o.id) as implantations
       FROM objects o
       ${jointuresPosable()}
       WHERE ${expressionPosable()} = 1
         AND ${expressionNature()} <> 'prestation'${recherche}${portee.sql}`,
      params
    );

    modeles.sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), 'fr'));
    res.json({ success: true, data: modeles });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== SYNTHÈSES ========================

/**
 * GET /stats - De quoi titrer l'écran, les deux gisements confondus.
 *
 * Comptées sur la liste normalisée et non en SQL : deux requêtes portant la
 * même question sur deux schémas divergeraient, et le bandeau annoncerait un
 * total que la carte en dessous ne montrerait pas.
 */
router.get('/stats', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const lignes = await lireImplantations(req, { limit: '20000' });
    if (lignes === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }

    const jour = aujourdhui();
    const echeance = (l: Implantation) =>
      l.next_intervention_date ? String(l.next_intervention_date).slice(0, 10) : null;

    res.json({
      success: true,
      data: {
        total: lignes.length,
        voirie: lignes.filter((l) => l.source === 'voirie').length,
        espaces_verts: lignes.filter((l) => l.source === 'espace_vert').length,
        modeles: new Set(lignes.map((l) => l.object_id).filter((id) => id !== null)).size,
        rues: new Set(lignes.map((l) => l.street).filter(Boolean)).size,
        a_revoir: lignes.filter(
          (l) => l.condition_state === 'mauvais' || l.condition_state === 'remplacer'
        ).length,
        en_retard: lignes.filter((l) => {
          const date = echeance(l);
          return date !== null && date < jour;
        }).length,
        // Ce que la carte ne peut pas montrer, et qu'il vaut mieux annoncer que
        // laisser deviner : des éléments d'espaces verts sans plan capturé ni
        // position relevée.
        sans_position: lignes.filter((l) => l.precision_position === 'inconnue').length,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /facettes - Ce qu'il y a vraiment à filtrer.
 *
 * Les rues et les secteurs sont du texte libre : proposer la liste de ce qui a
 * déjà été saisi est le seul moyen d'éviter que « rue de la Gare », « Rue de la
 * gare » et « r. de la Gare » désignent trois rues différentes. Les modèles,
 * les catégories et les espaces verts sont rendus avec leur effectif, pour que
 * le filtre annonce ce qu'il va trouver.
 */
router.get('/facettes', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const lignes = await lireImplantations(req, { limit: '20000' });
    if (lignes === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }

    const compter = <T>(
      valeurs: Array<T | null>,
      cle: (valeur: T) => string
    ): Map<string, { valeur: T; cnt: number }> => {
      const vus = new Map<string, { valeur: T; cnt: number }>();
      for (const valeur of valeurs) {
        if (valeur === null || valeur === undefined) continue;
        const k = cle(valeur);
        const deja = vus.get(k);
        if (deja) deja.cnt += 1;
        else vus.set(k, { valeur, cnt: 1 });
      }
      return vus;
    };

    const texte = (valeurs: Array<string>) =>
      [...compter(valeurs.filter(Boolean), (v) => v).values()]
        .map(({ valeur, cnt }) => ({ valeur, cnt }))
        .sort((a, b) => a.valeur.localeCompare(b.valeur, 'fr'));

    const paire = (
      valeurs: Array<{ id: number; nom: string; reference?: string | null }>
    ) =>
      [...compter(valeurs, (v) => String(v.id)).values()]
        .map(({ valeur, cnt }) => ({ ...valeur, cnt }))
        .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

    res.json({
      success: true,
      data: {
        rues: texte(lignes.map((l) => l.street)),
        secteurs: texte(lignes.map((l) => l.sector)),
        modeles: paire(
          lignes
            .filter((l) => l.object_id !== null)
            .map((l) => ({
              id: l.object_id!,
              nom: l.object_name ?? 'Sans nom',
              reference: l.object_reference,
            }))
        ),
        categories: paire(
          lignes
            .filter((l) => l.category_id !== null)
            .map((l) => ({ id: l.category_id!, nom: l.category_name ?? 'Sans nom' }))
        ),
        espaces_verts: paire(
          lignes
            .filter((l) => l.green_space_id !== null)
            .map((l) => ({ id: l.green_space_id!, nom: l.lieu }))
        ),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== LISTE, EXPORT ========================

/**
 * GET / - Les implantations, tous gisements confondus.
 *
 * Voie publique **et** espaces verts. `source=voirie` ou `source=espace_vert`
 * restreint, et c'est le seul moyen de ne voir qu'un des deux : le défaut est
 * de tout montrer, parce que c'est la question qu'on se pose.
 */
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const lignes = await lireImplantations(req, req.query as FiltresImplantations);
    if (lignes === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }
    res.json({ success: true, data: lignes, total: lignes.length });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /export - Les mêmes lignes, avec de quoi composer un document.
 *
 * L'export PDF est fabriqué dans le navigateur, parce qu'il doit contenir la
 * carte telle qu'elle est affichée. Mais il ne doit pas se contenter de ce que
 * la carte a chargé : `avec_interventions` rapatrie l'historique des deux
 * gisements — les interventions de voirie et les entretiens d'espaces verts
 * rattachés à l'élément —, qu'aucun écran n'affiche pour mille points à la fois
 * et qui fait tout l'intérêt d'un document d'entretien.
 */
router.get('/export', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const filtres = { ...(req.query as FiltresImplantations) };
    filtres.limit = String(req.query.limit ?? 5000);

    const lignes = await lireImplantations(req, filtres);
    if (lignes === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }

    if (
      (req.query.avec_interventions === '1' || req.query.avec_interventions === 'true') &&
      lignes.length > 0
    ) {
      await historiques(lignes);
    }

    res.json({ success: true, data: lignes, total: lignes.length });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /objets/:objectId - Toutes les implantations d'un modèle, où qu'elles soient.
 *
 * C'est la route qui répond à la question de départ : « j'ai créé un banc dans
 * les catégories, où sont les vingt-trois bancs posés ? ». Et la réponse ne
 * s'arrête pas au trottoir : trois d'entre eux sont peut-être dans le parc
 * municipal, et les chercher ailleurs est exactement ce qu'on veut éviter.
 */
router.get('/objets/:objectId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const lignes = await lireImplantations(req, {
      object_id: req.params.objectId,
      // Un modèle retiré du terrain compte dans son inventaire : la fiche du
      // parc doit pouvoir dire « vingt posés, trois déposés ».
      avec_deposes: '1',
      limit: '5000',
    });
    if (lignes === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }
    res.json({ success: true, data: lignes, total: lignes.length });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== UN ÉLÉMENT D'ESPACE VERT ========================

/**
 * GET /element/:elementId - Un élément d'espace vert, vu depuis la carte.
 *
 * En lecture seule, et c'est délibéré : la fiche de l'espace vert sait des
 * choses que la carte ignore — le plan, les zones, les surfaces, les coûts
 * figés, les saisons, l'historique des remplacements. Proposer ici un second
 * formulaire de modification ferait deux vérités pour la même ligne. La carte
 * montre, nomme, et renvoie là où ça se modifie.
 *
 * Déclarée avant `GET /:id` : `/element` serait sinon lu comme un identifiant.
 */
router.get('/element/:elementId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const lignes = await lireImplantations(req, {
      source: 'espace_vert',
      avec_deposes: '1',
      limit: '20000',
    });
    if (lignes === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }

    const element = lignes.find((l) => l.id === Number(req.params.elementId));
    if (!element) {
      return res.status(404).json({ success: false, message: 'Élément non trouvé' });
    }

    await historiques([element]);
    res.json({ success: true, data: element });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== UN EXEMPLAIRE DE VOIRIE ========================

/**
 * L'exemplaire demandé, si le compte a le droit de le voir.
 *
 * Rend `null` quand il n'existe pas **ou** quand sa catégorie est fermée au
 * compte : les deux cas se répondent pareil, sans quoi la différence entre
 * « inexistant » et « interdit » révélerait l'existence de ce qu'on cache.
 */
async function exemplaireAutorise(req: AuthRequest, itemId: string): Promise<any | null> {
  const portee = await filtreObjets(req, 'o');
  if (portee === null) return null;

  return db.queryOne(
    `SELECT ${COLONNES_EXEMPLAIRE}
     FROM street_furniture sf
     ${JOINTURES_EXEMPLAIRE}
     WHERE sf.id = ?${portee.sql}`,
    [itemId, ...portee.params]
  );
}

/** GET /:id - Un exemplaire de voirie, son contenu et son historique. */
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const exemplaire = await exemplaireAutorise(req, req.params.id);
    if (!exemplaire) {
      return res.status(404).json({ success: false, message: 'Mobilier non trouvé' });
    }

    const interventions = await db.query(
      `SELECT i.*, CONCAT_WS(' ', u.first_name, u.last_name) as auteur
       FROM street_furniture_interventions i
       LEFT JOIN users u ON u.id = i.user_id
       WHERE i.item_id = ?
       ORDER BY i.performed_on DESC, i.id DESC`,
      [req.params.id]
    );

    // Ce que porte une jardinière. Vide pour un banc, et c'est très bien : la
    // question ne se pose que là où la réponse existe.
    const contenu = await db.query(
      `SELECT ${COLONNES_EXEMPLAIRE}
       FROM street_furniture sf
       ${JOINTURES_EXEMPLAIRE}
       WHERE sf.parent_id = ?
       ORDER BY o.name, sf.numero`,
      [req.params.id]
    );

    res.json({ success: true, data: { ...exemplaire, interventions, contenu } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST / - Poser un exemplaire.
 *
 * Le geste que tout le module sert. Il tient en deux données obligatoires — un
 * modèle et une position — parce que c'est tout ce qu'un agent a sous la main
 * devant un candélabre. Le reste se complète depuis la fiche, plus tard, au
 * bureau.
 *
 * `parent_id` pose **dans** un contenant : douze géraniums dans la jardinière
 * du parking. Le contenu prend alors la position de son contenant — il est là
 * où il est, et lui demander un point à lui n'aurait aucun sens.
 */
router.post('/', authenticateToken, requireFieldWrite, async (req: AuthRequest, res: Response) => {
  try {
    const objectId = Number(req.body.object_id);
    if (!Number.isFinite(objectId) || objectId <= 0) {
      return res.status(400).json({ success: false, message: 'Matériel du parc requis' });
    }

    const portee = await filtreObjets(req, 'o');
    if (portee === null) {
      return res.status(403).json({ success: false, message: REFUS_PORTEE });
    }

    // Le contenant se vérifie avant la position : c'est lui qui la donne.
    let contenant: any = null;
    if (req.body.parent_id !== undefined && req.body.parent_id !== null && req.body.parent_id !== '') {
      contenant = await exemplaireAutorise(req, String(req.body.parent_id));
      if (!contenant) {
        return res.status(404).json({ success: false, message: 'Contenant non trouvé' });
      }
      // Un seul niveau : une jardinière porte des fleurs, une fleur ne porte
      // rien. Autoriser la chaîne obligerait à gérer des cycles et des
      // profondeurs pour un besoin que personne n'a exprimé.
      if (contenant.parent_id) {
        return res.status(400).json({
          success: false,
          message: `« ${contenant.label} » est déjà dans un contenant : on ne pose pas dans ce qui est posé`,
        });
      }
    }

    const position = contenant
      ? lirePosition(contenant.latitude, contenant.longitude)
      : lirePosition(req.body.latitude, req.body.longitude);
    if (!position) {
      return res.status(400).json({ success: false, message: REFUS_POSITION });
    }

    const modele = await db.queryOne(
      `SELECT o.id, o.name, o.reference, o.image,
              ${expressionPosable()} as posable,
              ${expressionNature()} as nature
       FROM objects o
       ${jointuresPosable()}
       WHERE o.id = ?${portee.sql}`,
      [objectId, ...portee.params]
    );
    if (!modele) {
      return res.status(404).json({ success: false, message: 'Matériel du parc non trouvé' });
    }
    // Le réglage l'emporte sur une sélection périmée : un onglet resté ouvert
    // depuis qu'un administrateur a fermé la catégorie proposerait encore le
    // matériel, et l'écran ne dirait pas pourquoi la pose échoue.
    if (!modele.posable) {
      return res.status(400).json({ success: false, message: REFUS_POSE });
    }
    if (modele.nature === 'prestation') {
      return res.status(400).json({
        success: false,
        message: `« ${modele.name} » est une prestation : elle ne se pose pas sur la voie publique`,
      });
    }

    const numero = await prochainNumero(objectId);
    const maintenant = new Date().toISOString();
    const libelle =
      typeof req.body.label === 'string' && req.body.label.trim()
        ? req.body.label.trim()
        : libelleParDefaut(modele.name, numero);

    // Un exemplaire identifié est posé une fois : ce banc-là, pas trois. Une
    // quantité n'a de sens que dans un contenant — douze géraniums dans un bac.
    const quantite = contenant
      ? Math.max(1, Math.floor(Number(req.body.quantity) || 1))
      : 1;

    const resultat = await db.execute(
      `INSERT INTO street_furniture (
         object_id, parent_id, numero, quantity, label, code, latitude, longitude,
         position_source, position_accuracy, address, street, sector,
         status, condition_state, installed_on, notes, image, custom_fields,
         created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        objectId,
        contenant ? contenant.id : null,
        numero,
        quantite,
        libelle,
        texte(req.body.code),
        position.latitude,
        position.longitude,
        contenant
          ? contenant.position_source
          : termeValide(SOURCES_POSITION, req.body.position_source, 'carte'),
        contenant ? contenant.position_accuracy : nombreOuNull(req.body.position_accuracy),
        // Le contenu hérite de l'adresse de son contenant : la jardinière est
        // rue de la Gare, ses fleurs aussi, et la retaper douze fois serait
        // douze occasions de la taper différemment.
        contenant ? contenant.address : texte(req.body.address),
        contenant ? contenant.street : texte(req.body.street),
        contenant ? contenant.sector : texte(req.body.sector),
        termeValide(STATUTS, req.body.status, 'en_service'),
        termeValide(ETATS, req.body.condition_state, 'bon'),
        dateOuNull(req.body.installed_on),
        texte(req.body.notes),
        texte(req.body.image) || modele.image || '',
        req.body.custom_fields ? JSON.stringify(req.body.custom_fields) : '{}',
        req.user!.userId,
        maintenant,
        maintenant,
      ]
    );

    await logService.info(
      'other',
      `Mobilier posé : ${libelle} (modèle ${modele.name})`,
      { itemId: resultat.lastInsertRowid, objectId, parentId: contenant?.id ?? null },
      { userId: req.user!.userId }
    );

    res.status(201).json({ success: true, data: await exemplaireComplet(resultat.lastInsertRowid) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /:id - Modifier un exemplaire, déplacement compris.
 *
 * Le modèle n'est **pas** modifiable ici : changer le rattachement ferait d'un
 * banc un candélabre en gardant son numéro, ses interventions et sa plaque. Un
 * mobilier qui change de nature est un mobilier déposé et un autre posé, et
 * c'est ce que raconte l'historique.
 */
router.put('/:id', authenticateToken, requireFieldWrite, async (req: AuthRequest, res: Response) => {
  try {
    const existant = await exemplaireAutorise(req, req.params.id);
    if (!existant) {
      return res.status(404).json({ success: false, message: 'Mobilier non trouvé' });
    }

    // Une position n'est remplacée que si elle est envoyée entière et valide :
    // accepter une latitude seule déplacerait le mobilier sur le méridien.
    let latitude = Number(existant.latitude);
    let longitude = Number(existant.longitude);
    const deplacement =
      req.body.latitude !== undefined || req.body.longitude !== undefined;
    if (deplacement) {
      if (existant.parent_id) {
        return res.status(400).json({
          success: false,
          message:
            'Ce mobilier est dans un contenant : il suit sa jardinière. Déplacez le contenant.',
        });
      }
      const position = lirePosition(req.body.latitude, req.body.longitude);
      if (!position) {
        return res.status(400).json({ success: false, message: REFUS_POSITION });
      }
      latitude = position.latitude;
      longitude = position.longitude;
    }

    await db.execute(
      `UPDATE street_furniture SET
         label = ?, code = ?, quantity = ?, latitude = ?, longitude = ?,
         position_source = ?, position_accuracy = ?,
         address = ?, street = ?, sector = ?,
         status = ?, condition_state = ?, installed_on = ?,
         notes = ?, image = ?, custom_fields = ?, updated_at = ?
       WHERE id = ?`,
      [
        fusionner(texteOuNull(req.body.label), existant.label) || existant.label,
        fusionner(texteOuNull(req.body.code), existant.code) ?? '',
        req.body.quantity !== undefined
          ? Math.max(1, Math.floor(Number(req.body.quantity) || 1))
          : (existant.quantity ?? 1),
        latitude,
        longitude,
        deplacement
          ? termeValide(SOURCES_POSITION, req.body.position_source, 'carte')
          : existant.position_source,
        deplacement ? nombreOuNull(req.body.position_accuracy) : existant.position_accuracy,
        fusionner(texteOuNull(req.body.address), existant.address) ?? '',
        fusionner(texteOuNull(req.body.street), existant.street) ?? '',
        fusionner(texteOuNull(req.body.sector), existant.sector) ?? '',
        req.body.status !== undefined
          ? termeValide(STATUTS, req.body.status, existant.status)
          : existant.status,
        req.body.condition_state !== undefined
          ? termeValide(ETATS, req.body.condition_state, existant.condition_state)
          : existant.condition_state,
        req.body.installed_on !== undefined
          ? dateOuNull(req.body.installed_on)
          : existant.installed_on,
        fusionner(texteOuNull(req.body.notes), existant.notes) ?? '',
        fusionner(texteOuNull(req.body.image), existant.image) ?? '',
        req.body.custom_fields !== undefined
          ? JSON.stringify(req.body.custom_fields ?? {})
          : existant.custom_fields,
        new Date().toISOString(),
        req.params.id,
      ]
    );

    /*
      Le contenu suit son contenant.

      Une jardinière déplacée de trois mètres emmène ses fleurs : les laisser
      sur l'ancien point ferait douze géraniums plantés au milieu de la
      chaussée. L'adresse suit pour la même raison — c'est la même adresse.
    */
    if (deplacement || req.body.address !== undefined || req.body.street !== undefined) {
      await db.execute(
        `UPDATE street_furniture SET
           latitude = ?, longitude = ?, position_source = ?, position_accuracy = ?,
           address = (SELECT address FROM street_furniture WHERE id = ?),
           street = (SELECT street FROM street_furniture WHERE id = ?),
           sector = (SELECT sector FROM street_furniture WHERE id = ?),
           updated_at = ?
         WHERE parent_id = ?`,
        [
          latitude,
          longitude,
          deplacement
            ? termeValide(SOURCES_POSITION, req.body.position_source, 'carte')
            : existant.position_source,
          deplacement ? nombreOuNull(req.body.position_accuracy) : existant.position_accuracy,
          req.params.id,
          req.params.id,
          req.params.id,
          new Date().toISOString(),
          req.params.id,
        ]
      );
    }

    res.json({ success: true, data: await exemplaireComplet(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /:id - Retirer un exemplaire de l'inventaire.
 *
 * Réservé au superviseur, et rarement le bon geste : un mobilier retiré du
 * terrain se passe en « Déposé », ce qui le sort de la carte sans effacer son
 * historique. La suppression est là pour les erreurs de saisie — un point posé
 * deux fois, un clic à côté.
 */
router.delete('/:id', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const existant = await exemplaireAutorise(req, req.params.id);
    if (!existant) {
      return res.status(404).json({ success: false, message: 'Mobilier non trouvé' });
    }

    // Ce que la cascade emporte se dit avant, pas après : une jardinière
    // supprimée emmène ses plantations, et l'écran doit pouvoir l'annoncer.
    const contenu = await db.queryOne(
      'SELECT COUNT(*) as cnt FROM street_furniture WHERE parent_id = ?',
      [req.params.id]
    );

    await db.execute('DELETE FROM street_furniture WHERE id = ?', [req.params.id]);

    await logService.warning(
      'other',
      `Mobilier supprimé : ${existant.label}`,
      { itemId: existant.id, objectId: existant.object_id, contenu: Number(contenu?.cnt ?? 0) },
      { userId: req.user!.userId }
    );

    res.json({
      success: true,
      message: 'Mobilier supprimé',
      contenu_supprime: Number(contenu?.cnt ?? 0),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== INTERVENTIONS ========================

/**
 * POST /:id/interventions - Consigner ce qui a été fait sur cet exemplaire.
 *
 * « Le banc 23 a été repeint » : la phrase entière tient ici, et nulle part
 * ailleurs. L'état et la date de dernière intervention de l'exemplaire suivent
 * automatiquement — les laisser à la main garantirait qu'ils divergent.
 */
router.post('/:id/interventions', authenticateToken, requireFieldWrite, async (req: AuthRequest, res: Response) => {
  try {
    const exemplaire = await exemplaireAutorise(req, req.params.id);
    if (!exemplaire) {
      return res.status(404).json({ success: false, message: 'Mobilier non trouvé' });
    }

    const resultat = await db.execute(
      `INSERT INTO street_furniture_interventions (
         item_id, intervention_type, performed_on, next_date,
         description, cost, performed_by, user_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id,
        termeValide(TYPES_INTERVENTION, req.body.intervention_type, 'entretien'),
        dateOuNull(req.body.performed_on) ?? aujourdhui(),
        dateOuNull(req.body.next_date),
        texte(req.body.description),
        nombreOuNull(req.body.cost),
        texte(req.body.performed_by),
        req.user!.userId,
        new Date().toISOString(),
      ]
    );

    // L'intervention dit souvent l'état dans lequel elle laisse le mobilier :
    // un banc repeint est « bon », et le retaper ensuite sur la fiche est un
    // geste que personne ne fait.
    if (req.body.condition_state !== undefined) {
      await db.execute('UPDATE street_furniture SET condition_state = ? WHERE id = ?', [
        termeValide(ETATS, req.body.condition_state, exemplaire.condition_state),
        req.params.id,
      ]);
    }
    if (req.body.status !== undefined) {
      await db.execute('UPDATE street_furniture SET status = ? WHERE id = ?', [
        termeValide(STATUTS, req.body.status, exemplaire.status),
        req.params.id,
      ]);
    }

    await rafraichirEcheances(req.params.id);

    await logService.info(
      'other',
      `Intervention sur ${exemplaire.label}`,
      { itemId: exemplaire.id, type: req.body.intervention_type },
      { userId: req.user!.userId }
    );

    const intervention = await db.queryOne(
      `SELECT i.*, CONCAT_WS(' ', u.first_name, u.last_name) as auteur
       FROM street_furniture_interventions i
       LEFT JOIN users u ON u.id = i.user_id
       WHERE i.id = ?`,
      [resultat.lastInsertRowid]
    );

    res.status(201).json({
      success: true,
      data: { intervention, mobilier: await exemplaireComplet(req.params.id) },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** L'intervention demandée, si le compte a le droit de voir son mobilier. */
async function interventionAutorisee(req: AuthRequest, interventionId: string): Promise<any | null> {
  const ligne = await db.queryOne(
    'SELECT * FROM street_furniture_interventions WHERE id = ?',
    [interventionId]
  );
  if (!ligne) return null;
  const exemplaire = await exemplaireAutorise(req, String(ligne.item_id));
  return exemplaire ? ligne : null;
}

/** PUT /interventions/:interventionId - Corriger une intervention. */
router.put('/interventions/:interventionId', authenticateToken, requireFieldWrite, async (req: AuthRequest, res: Response) => {
  try {
    const existante = await interventionAutorisee(req, req.params.interventionId);
    if (!existante) {
      return res.status(404).json({ success: false, message: 'Intervention non trouvée' });
    }

    await db.execute(
      `UPDATE street_furniture_interventions SET
         intervention_type = ?, performed_on = ?, next_date = ?,
         description = ?, cost = ?, performed_by = ?
       WHERE id = ?`,
      [
        req.body.intervention_type !== undefined
          ? termeValide(TYPES_INTERVENTION, req.body.intervention_type, existante.intervention_type)
          : existante.intervention_type,
        req.body.performed_on !== undefined
          ? dateOuNull(req.body.performed_on)
          : existante.performed_on,
        req.body.next_date !== undefined ? dateOuNull(req.body.next_date) : existante.next_date,
        fusionner(texteOuNull(req.body.description), existante.description) ?? '',
        req.body.cost !== undefined ? nombreOuNull(req.body.cost) : existante.cost,
        fusionner(texteOuNull(req.body.performed_by), existante.performed_by) ?? '',
        req.params.interventionId,
      ]
    );

    await rafraichirEcheances(existante.item_id);

    res.json({ success: true, data: await exemplaireComplet(existante.item_id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** DELETE /interventions/:interventionId - Retirer une intervention saisie par erreur. */
router.delete('/interventions/:interventionId', authenticateToken, requireSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const existante = await interventionAutorisee(req, req.params.interventionId);
    if (!existante) {
      return res.status(404).json({ success: false, message: 'Intervention non trouvée' });
    }

    await db.execute('DELETE FROM street_furniture_interventions WHERE id = ?', [
      req.params.interventionId,
    ]);
    await rafraichirEcheances(existante.item_id);

    res.json({ success: true, data: await exemplaireComplet(existante.item_id) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Une chaîne propre — ce qui arrive d'une API n'est pas toujours du texte. */
function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur.trim() : '';
}

/**
 * La chaîne reçue, ou `null` quand le champ n'a pas été envoyé.
 *
 * `fusionner` distingue « absent » de « vidé » : sans cette nuance, une
 * modification partielle — celle que fait un formulaire de terrain qui n'envoie
 * que ce qu'il affiche — effacerait tout ce qu'elle ne mentionne pas.
 */
function texteOuNull(valeur: unknown): string | null {
  if (valeur === undefined) return null;
  return typeof valeur === 'string' ? valeur.trim() : '';
}

export default router;
