import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { GROUP_TYPES, type TypeGroupe } from '@/lib/espacesVerts'

/**
 * Les types de groupes tels que la commune les a réglés.
 *
 * L'onglet Éléments lisait la table, le plan annoté lisait une constante en dur,
 * et un type créé par l'admin s'affichait donc correctement d'un côté, sans
 * libellé ni couleur de l'autre — la zone dessinée devenait grise et anonyme sur
 * le plan et dans le PDF. Une seule lecture, partagée par react-query.
 */
export function useTypesGroupes() {
  const { data = [] } = useQuery<TypeGroupe[]>({
    queryKey: ['green-space-group-types'],
    queryFn: () => api.get('/green-spaces/group-types').then((r) => r.data.data),
  })

  const actifs = (data as any[]).filter((t) => !t.disabled)
  // La constante ne sert que tant que la table est vide : sinon un type
  // désactivé par la commune ressusciterait par le repli.
  const types: TypeGroupe[] = actifs.length > 0 ? actifs : GROUP_TYPES

  /** Ce que dit un type, ou le repli « Autre » plutôt qu'une pastille grise. */
  const typeGroupe = (valeur?: string | null): TypeGroupe =>
    types.find((t) => t.value === valeur) ??
    GROUP_TYPES.find((t) => t.value === valeur) ??
    GROUP_TYPES[GROUP_TYPES.length - 1]

  return { types, typeGroupe }
}
