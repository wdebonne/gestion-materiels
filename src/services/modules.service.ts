import { db } from '../database';

/**
 * Le module est-il actif, et ouvert à ce compte ? Même règle que le menu :
 * droit individuel, sinon droit du rôle, sinon ouvert.
 *
 * Né dans le Suivi des coûts, qui chiffre chaque module selon qu'il est ouvert ;
 * la passerelle comptable en a besoin aussi, pour garder ses routes et choisir
 * les destinataires de son mail. Une seule règle, lue au même endroit que le
 * menu, sinon un compte verrait une entrée qui lui refuse l'accès.
 */
export async function moduleOuvert(appelant: { userId: number; role: string }, slug: string): Promise<boolean> {
  const plugin = await db.queryOne('SELECT id, is_active FROM plugins WHERE slug = ?', [slug]).catch(() => null);
  if (!plugin || !Number(plugin.is_active)) return false;
  if (appelant.role === 'admin') return true;
  const individuel = await db.queryOne(
    'SELECT can_access FROM user_plugin_permissions WHERE user_id = ? AND plugin_id = ?',
    [appelant.userId, plugin.id]
  );
  if (individuel) return Boolean(Number(individuel.can_access));
  const duRole = await db.queryOne('SELECT can_access FROM plugin_permissions WHERE role = ? AND plugin_id = ?', [
    appelant.role,
    plugin.id,
  ]);
  if (duRole) return Boolean(Number(duRole.can_access));
  return true;
}
