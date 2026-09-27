import { useInfiniteQuery } from '@tanstack/react-query'
import api from '@/lib/api'

interface Options {
  categoryId?: number
  subcategoryId?: number
  search?: string
  enabled?: boolean
  /** Taille de page. 20 correspond au défaut du serveur. */
  parPage?: number
  /** Montrer aussi les matériels sortis de l'inventaire, masqués par défaut. */
  inclureSortis?: boolean
}

interface Page {
  objects: any[]
  pagination?: { page: number; limit: number; total: number; totalPages: number }
}

/**
 * Liste paginée de matériels.
 *
 * Le serveur paginait depuis toujours (`limit` à 20 par défaut, avec un bloc
 * `pagination` dans la réponse) mais le client ne l'exploitait pas : au-delà
 * du vingtième matériel, les suivants étaient simplement invisibles. Un
 * correctif provisoire avait porté la limite à 500, ce qui déplace le problème
 * sans le régler et charge inutilement de gros parcs.
 */
export function usePaginatedObjects({
  categoryId,
  subcategoryId,
  search,
  enabled = true,
  parPage = 20,
  inclureSortis = false,
}: Options) {
  const requete = useInfiniteQuery<Page>({
    queryKey: ['objects', { categoryId, subcategoryId, search, parPage, inclureSortis }],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams()
      if (categoryId !== undefined) params.append('categoryId', String(categoryId))
      if (subcategoryId !== undefined) params.append('subcategoryId', String(subcategoryId))
      if (search) params.append('search', search)
      if (inclureSortis) params.append('inclureSortis', '1')
      params.append('page', String(pageParam))
      params.append('limit', String(parPage))

      const reponse = await api.get(`/objects?${params}`)
      return reponse.data as Page
    },
    getNextPageParam: (derniere) => {
      const p = derniere.pagination
      if (!p) return undefined
      return p.page < p.totalPages ? p.page + 1 : undefined
    },
    enabled,
  })

  const objets = requete.data?.pages.flatMap((p) => p.objects ?? []) ?? []
  const total = requete.data?.pages[0]?.pagination?.total ?? objets.length

  return {
    objets,
    total,
    /** Reste-t-il des matériels non chargés ? */
    resteAPager: requete.hasNextPage ?? false,
    chargerSuite: requete.fetchNextPage,
    chargementSuite: requete.isFetchingNextPage,
    isLoading: requete.isLoading,
    error: requete.error,
  }
}
