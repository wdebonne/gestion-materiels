import { useQuery } from '@tanstack/react-query'
import { organisationApi, type PerimetreGestion } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'

/**
 * Ce que le compte courant gère dans l'organisation — bâtiments, salles,
 * services.
 *
 * Lu au serveur plutôt que déduit du rôle : un agent peut gérer l'école sans
 * être superviseur, et c'est précisément ce que le rôle ne dit pas. Même règle
 * que `permissions.ts` : n'afficher que ce que le serveur acceptera.
 *
 * Pas dans le store d'authentification : la réponse de connexion ne le porte
 * pas, et une délégation accordée pendant la session doit se voir sans se
 * reconnecter.
 */

const RIEN: PerimetreGestion = {
  gereOrganisation: false,
  gereLieux: false,
  gereServices: false,
  sitesGeres: [],
  servicesGeres: [],
}

export interface Gestion extends PerimetreGestion {
  chargement: boolean
  /** Gère au moins quelque chose : l'entrée « Organisation » s'affiche. */
  gereQuelqueChose: boolean
  peutGererSite: (siteId: number) => boolean
  peutGererService: (serviceId: number) => boolean
}

export const CLE_GESTION = ['organisation', 'moi'] as const

export function useGestion(): Gestion {
  const connecte = useAuthStore((state) => !!state.user)
  // Le rôle `service` est cloisonné aux manifestations : le serveur refuserait.
  const cloisonne = useAuthStore((state) => state.user?.role === ('service' as string))

  const { data, isLoading } = useQuery({
    queryKey: CLE_GESTION,
    queryFn: async () => {
      const { success: _success, ...perimetre } = (await organisationApi.moi()).data
      return perimetre as PerimetreGestion
    },
    enabled: connecte && !cloisonne,
    staleTime: 60_000,
  })

  const p = data ?? RIEN
  return {
    ...p,
    chargement: isLoading && connecte && !cloisonne,
    gereQuelqueChose:
      p.gereLieux || p.gereServices || p.sitesGeres.length > 0 || p.servicesGeres.length > 0,
    peutGererSite: (siteId) => p.gereLieux || p.sitesGeres.includes(siteId),
    peutGererService: (serviceId) => p.gereServices || p.servicesGeres.includes(serviceId),
  }
}
