import type { ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, CalendarDays, KeyRound, LifeBuoy, Link2, Package, Star, X } from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle, LoadingInline } from '@/components/ui'
import { useFavoris, type Favori, type TypeFavori } from '@/lib/accueil'
import { cn, formatDate } from '@/lib/utils'

export const TYPES_FAVORI: Record<TypeFavori, { libelle: string; icone: ComponentType<{ className?: string }>; couleur: string }> = {
  lien: { libelle: 'Raccourcis', icone: Link2, couleur: 'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' },
  materiel: { libelle: 'Matériels', icone: Package, couleur: 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  batiment: { libelle: 'Bâtiments', icone: Building2, couleur: 'bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
  ticket: { libelle: 'Tickets', icone: LifeBuoy, couleur: 'bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' },
  manifestation: { libelle: 'Manifestations', icone: CalendarDays, couleur: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  cle: { libelle: 'Clés', icone: KeyRound, couleur: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200' },
}

/** Le nom à montrer, y compris pour un favori qui n'est plus accessible. */
export function nomFavori(f: Favori): string {
  if (f.disponible) return f.libelle ?? 'Sans nom'
  return `${TYPES_FAVORI[f.type].libelle.replace(/s$/, '')} n° ${f.cibleId} — plus accessible`
}

/**
 * Ce que la personne a épinglé, sur toutes ses fiches, et ses raccourcis.
 *
 * Groupé par type, dans l'ordre choisi dans « Personnaliser » : les raccourcis
 * d'abord, puisqu'on les a créés exprès pour y revenir.
 */
export function BlocFavoris() {
  const navigate = useNavigate()
  const { favoris, chargement, retirer } = useFavoris()

  const groupes = (Object.keys(TYPES_FAVORI) as TypeFavori[])
    .map((type) => ({ type, favoris: favoris.filter((f) => f.type === type) }))
    .filter((g) => g.favoris.length > 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Star className="h-5 w-5 text-amber-500" />
          Mes favoris
        </CardTitle>
      </CardHeader>
      <CardBody>
        {chargement ? (
          <LoadingInline />
        ) : favoris.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Touchez l'étoile d'une fiche — matériel, bâtiment, ticket, manifestation ou clé — pour l'épingler ici. Pour
            revenir à une page ou à une liste filtrée, ouvrez-la puis choisissez « Ajouter cette page à mes raccourcis »
            dans le menu de votre nom, en haut à droite.
          </p>
        ) : (
          <div className="space-y-4">
            {groupes.map(({ type, favoris: liste }) => {
              const { libelle, icone: Icone, couleur } = TYPES_FAVORI[type]
              return (
                <section key={type}>
                  <h3 className="mb-2 text-xs font-medium uppercase text-gray-600 dark:text-gray-400">{libelle}</h3>
                  <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {liste.map((f) => (
                      <li key={f.id} className="flex items-stretch">
                        <button
                          onClick={() => f.url && navigate(f.url)}
                          disabled={!f.url}
                          className={cn(
                            'flex min-h-[56px] min-w-0 flex-1 items-center gap-3 rounded-l-lg border border-r-0 border-gray-200 px-3 py-2 text-left transition-colors dark:border-gray-700',
                            f.disponible ? 'hover:bg-gray-50 dark:hover:bg-gray-700/50' : 'cursor-default opacity-60'
                          )}
                        >
                          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', couleur)}>
                            <Icone className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-gray-900 dark:text-gray-100">{nomFavori(f)}</span>
                            {f.detail && (
                              <span className="block truncate text-sm text-gray-500 dark:text-gray-400">
                                {type === 'manifestation' ? formatDate(f.detail) : f.detail}
                              </span>
                            )}
                          </span>
                        </button>
                        <button
                          onClick={() => retirer(f.id)}
                          aria-label={`Retirer ${nomFavori(f)} de mes favoris`}
                          title="Retirer de mes favoris"
                          className="flex w-11 shrink-0 items-center justify-center rounded-r-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700/50 dark:hover:text-gray-100"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
