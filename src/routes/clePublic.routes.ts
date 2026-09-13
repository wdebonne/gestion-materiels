import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../database';
import { getJwtSecret } from '../config/secrets';
import type { JwtPayload } from '../middleware/auth.middleware';
import { getAccessibleCategoryIds } from '../middleware/auth.middleware';
import { compositionDuTrousseau, detenteurActuel, objetDuJeton } from '../services/cles.service';

/**
 * La page que trouve celui qui ramasse un trousseau.
 *
 * Monté **avant** `/api/cles`, comme le dépôt d'une demande de manifestation
 * l'est avant `/api/manifestations` : c'est la seule route du module qui
 * n'exige pas de compte, et elle ne doit pas se retrouver derrière
 * `authenticateToken`.
 *
 * Elle répond à deux publics avec la même adresse, et c'est tout son intérêt :
 *
 *   **un inconnu** — le passant qui a trouvé le trousseau sur un trottoir — lit
 *   un message que l'administrateur rédige, du genre « Clé de la ville de
 *   Pavilly, merci de la rapporter à la mairie ou à la police municipale ». Il
 *   n'apprend ni à qui elle appartient, ni ce qu'elle ouvre : ce serait
 *   indiquer à qui vient de trouver une clé quelle porte aller essayer.
 *
 *   **un agent connecté et habilité** voit en plus le détenteur et la
 *   composition. C'est ce qui rend l'étiquette utile au quotidien, et pas
 *   seulement en cas de perte.
 *
 * Le jeton d'authentification est donc lu en *optionnel* : absent ou périmé, il
 * dégrade vers la vue anonyme sans jamais produire un 401. Une page publique qui
 * répondrait « non autorisé » aurait manqué sa seule raison d'être.
 */

const router = Router();

/** Réglages lus par la page publique, avec leurs valeurs de repli. */
const REGLAGES_PUBLICS = {
  cle_public_titre: 'Trousseau de clés',
  cle_public_message:
    'Clé de la ville de Pavilly. Merci de rapporter ce trousseau à la mairie ou à la police municipale.',
  cle_public_contact: '',
} as const;

/**
 * Base de l'URL imprimée sur les étiquettes.
 *
 * Réglable parce qu'elle décide de la densité du QR code : sur une étiquette
 * Avery L6008 de dix millimètres de haut, `pavilly.fr/t/A7K9M2` reste lisible
 * là où l'adresse complète du serveur ne le serait pas. À défaut, on retombe
 * sur l'hôte courant, qui marche toujours même s'il est plus long.
 */
export async function urlPubliqueDe(req: Request, jeton: string): Promise<string> {
  const reglage = await db.queryOne<{ setting_value: string }>(
    "SELECT setting_value FROM settings WHERE setting_key = 'cle_public_base_url'"
  );

  const base = String(reglage?.setting_value || '').trim().replace(/\/+$/, '');
  if (base) {
    return /^https?:\/\//i.test(base) ? `${base}/${jeton}` : `https://${base}/${jeton}`;
  }

  const racine = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  return `${racine.replace(/\/+$/, '')}/t/${jeton}`;
}

/**
 * Identifie l'appelant s'il présente un jeton valide, sans jamais refuser.
 *
 * Reprend les vérifications de `authenticateToken` — compte actif, version de
 * session à jour — parce qu'un jeton révoqué ne doit pas plus ouvrir cette page
 * qu'une autre. La différence tient au traitement de l'échec : ici il ne coupe
 * pas la requête, il retire seulement les informations réservées.
 */
async function identifierSiPossible(req: Request): Promise<JwtPayload | null> {
  const entete = req.headers['authorization'];
  const jeton = entete && entete.split(' ')[1];
  if (!jeton) return null;

  try {
    const decode = jwt.verify(jeton, getJwtSecret()) as JwtPayload;

    const compte = await db.queryOne(
      'SELECT id, role, is_active, token_version FROM users WHERE id = ?',
      [decode.userId]
    );

    if (!compte || !compte.is_active) return null;
    if ((decode.tv ?? 0) !== (compte.token_version ?? 0)) return null;

    return { ...decode, role: compte.role };
  } catch {
    return null;
  }
}

/** Le compte peut-il voir la catégorie de ce matériel ? */
async function peutVoirLeDetail(compte: JwtPayload, materiel: any): Promise<boolean> {
  const accessibles = await getAccessibleCategoryIds(compte.userId, compte.role);
  if (accessibles === null) return true;
  if (accessibles.length === 0) return false;

  if (materiel.category_id && accessibles.includes(materiel.category_id)) return true;

  if (materiel.subcategory_id) {
    const sous = await db.queryOne<{ category_id: number }>(
      'SELECT category_id FROM subcategories WHERE id = ?',
      [materiel.subcategory_id]
    );
    if (sous && accessibles.includes(sous.category_id)) return true;
  }

  return false;
}

router.get('/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const reglages = await db.query<{ setting_key: string; setting_value: string }>(
      `SELECT setting_key, setting_value FROM settings
        WHERE setting_key IN ('cle_public_titre', 'cle_public_message', 'cle_public_contact',
                              'site_name', 'site_logo')`
    );

    const lu = new Map(reglages.map((r) => [r.setting_key, r.setting_value]));
    const publique = {
      titre: lu.get('cle_public_titre') || REGLAGES_PUBLICS.cle_public_titre,
      message: lu.get('cle_public_message') || REGLAGES_PUBLICS.cle_public_message,
      contact: lu.get('cle_public_contact') || REGLAGES_PUBLICS.cle_public_contact,
      commune: lu.get('site_name') || '',
      logo: lu.get('site_logo') || '',
    };

    const materiel = await objetDuJeton(req.params.token);

    // Un jeton inconnu renvoie la même page que les autres, sans détail. Un 404
    // distinguerait les jetons valides des invalides et permettrait de les
    // deviner par essais successifs — l'énumération que le jeton opaque existe
    // précisément pour empêcher.
    if (!materiel) {
      res.json({ success: true, data: { ...publique, connu: false } });
      return;
    }

    const compte = await identifierSiPossible(req);
    if (!compte || !(await peutVoirLeDetail(compte, materiel))) {
      res.json({ success: true, data: { ...publique, connu: true } });
      return;
    }

    const [detenteur, composition] = await Promise.all([
      detenteurActuel(materiel.id),
      compositionDuTrousseau(materiel.id),
    ]);

    res.json({
      success: true,
      data: {
        ...publique,
        connu: true,
        detaille: true,
        materiel: {
          id: materiel.id,
          nom: materiel.name,
          inventaire: materiel.reference || '',
          image: materiel.image || '',
        },
        detenteur,
        composition,
      },
    });
  } catch (error) {
    console.error('Erreur page publique clé:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
