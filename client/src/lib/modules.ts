import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

/**
 * Les modules que le menu propose au compte courant.
 *
 * Une seule source pour le menu et le tableau de bord : un module retiré à
 * quelqu'un (Paramètres › Utilisateurs › Droits) disparaît des deux à la fois.
 * Sans cela, l'accueil résumerait des manifestations que le menu ne permet
 * plus d'ouvrir.
 */
export interface ModuleMenu {
  slug: string
  name: string
  icon?: string
  route?: string
}

export function useMenuPlugins() {
  return useQuery({
    queryKey: ['menuPlugins'],
    queryFn: async () => (await api.get<ModuleMenu[]>('/plugins/menu')).data,
  })
}
