import type { QueryClient } from '@tanstack/react-query'

/**
 * Tout ce que le module Bâtiments garde en cache commence par `['batiments']`.
 *
 * Valider un rapport change l'échéance d'un suivi, donc la liste des bâtiments,
 * leurs compteurs, la file « À valider » et les documents : plutôt que
 * d'énumérer les écrans concernés — et d'en oublier un —, on les rafraîchit
 * tous d'un coup.
 */
export function invaliderBatiments(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ['batiments'] })
}
