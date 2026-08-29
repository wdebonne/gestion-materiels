import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, X, Package, Star, Clock, QrCode } from 'lucide-react'
import api from '@/lib/api'
import { useFavoritesStore } from '@/stores/favorites.store'

interface GlobalSearchProps {
  ouvert: boolean
  onFermer: () => void
}

interface Resultat {
  id: number
  name: string
  reference?: string
  categoryName?: string
  status?: string
}

/**
 * Recherche globale.
 *
 * L'application comptait 19 champs de recherche locaux, chacun limité à sa
 * page : pour retrouver une tondeuse, il fallait déjà savoir dans quelle
 * catégorie elle se trouvait. Ici on interroge `GET /api/objects?search=`, qui
 * cherche déjà dans le nom, la référence, le numéro de série et les champs
 * personnalisés.
 */
export default function GlobalSearch({ ouvert, onFermer }: GlobalSearchProps) {
  const navigate = useNavigate()
  const champRef = useRef<HTMLInputElement>(null)
  const [saisie, setSaisie] = useState('')
  const [recherche, setRecherche] = useState('')

  const { favoris, recents } = useFavoritesStore()

  // Anti-rebond : on n'interroge le serveur qu'une fois la frappe stabilisée.
  useEffect(() => {
    const minuteur = setTimeout(() => setRecherche(saisie.trim()), 300)
    return () => clearTimeout(minuteur)
  }, [saisie])

  useEffect(() => {
    if (ouvert) {
      setSaisie('')
      setRecherche('')
      // Laisser le temps à la feuille de s'afficher avant de donner le focus.
      const minuteur = setTimeout(() => champRef.current?.focus(), 50)
      return () => clearTimeout(minuteur)
    }
  }, [ouvert])

  useEffect(() => {
    if (!ouvert) return
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFermer()
    }
    document.addEventListener('keydown', surTouche)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', surTouche)
      document.body.style.overflow = ''
    }
  }, [ouvert, onFermer])

  const { data, isFetching } = useQuery({
    queryKey: ['recherche-globale', recherche],
    queryFn: async () => {
      const params = new URLSearchParams({ search: recherche, limit: '20' })
      const reponse = await api.get(`/objects?${params}`)
      return reponse.data.objects as Resultat[]
    },
    enabled: ouvert && recherche.length >= 2,
  })

  if (!ouvert) return null

  const resultats = data ?? []
  const rechercheEnCours = recherche.length >= 2

  const ouvrirMateriel = (id: number) => {
    onFermer()
    navigate(`/objects/${id}`)
  }

  const Ligne = ({
    id,
    nom,
    detail,
    icone,
  }: {
    id: number
    nom: string
    detail?: string
    icone: React.ReactNode
  }) => (
    <button
      key={id}
      onClick={() => ouvrirMateriel(id)}
      className="flex min-h-[56px] w-full items-center gap-3 rounded-lg px-3 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
    >
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
        {icone}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-gray-900 dark:text-gray-100">{nom}</span>
        {detail && (
          <span className="block truncate text-sm text-gray-600 dark:text-gray-400">{detail}</span>
        )}
      </span>
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-900 sm:items-center sm:justify-start sm:bg-black/50 sm:pt-20">
      <div className="flex h-full w-full flex-col sm:h-auto sm:max-h-[70vh] sm:max-w-xl sm:rounded-2xl sm:bg-white sm:shadow-2xl sm:dark:bg-gray-800">
        {/* Barre de saisie */}
        <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
          <Search className="h-5 w-5 flex-shrink-0 text-gray-500 dark:text-gray-400" />
          <input
            ref={champRef}
            type="search"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            placeholder="Nom, référence, numéro de série…"
            aria-label="Rechercher un matériel"
            className="min-h-[44px] flex-1 border-0 bg-transparent text-gray-900 outline-none placeholder:text-gray-500 dark:text-gray-100 dark:placeholder:text-gray-400"
          />
          <button
            onClick={onFermer}
            aria-label="Fermer la recherche"
            title="Fermer"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Résultats */}
        <div className="flex-1 overflow-y-auto p-2">
          {rechercheEnCours ? (
            <>
              {isFetching && (
                <p className="px-3 py-4 text-gray-600 dark:text-gray-400">Recherche…</p>
              )}
              {!isFetching && resultats.length === 0 && (
                <div className="px-3 py-8 text-center">
                  <p className="font-medium text-gray-900 dark:text-gray-100">Aucun résultat</p>
                  <p className="mt-1 text-gray-600 dark:text-gray-400">
                    Essayez le numéro de série, ou scannez l'étiquette du matériel.
                  </p>
                  <button
                    onClick={() => {
                      onFermer()
                      navigate('/scan')
                    }}
                    className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-300 px-4 font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    <QrCode className="h-5 w-5" />
                    Scanner une étiquette
                  </button>
                </div>
              )}
              {resultats.map((r) => (
                <Ligne
                  key={r.id}
                  id={r.id}
                  nom={r.name}
                  detail={[r.reference, r.categoryName].filter(Boolean).join(' • ')}
                  icone={<Package className="h-5 w-5" />}
                />
              ))}
            </>
          ) : (
            <>
              {favoris.length > 0 && (
                <section className="mb-2">
                  <h2 className="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                    Mes matériels
                  </h2>
                  {favoris.map((f) => (
                    <Ligne
                      key={f.id}
                      id={f.id}
                      nom={f.name}
                      detail={[f.reference, f.categoryName].filter(Boolean).join(' • ')}
                      icone={<Star className="h-5 w-5 text-amber-500" />}
                    />
                  ))}
                </section>
              )}

              {recents.length > 0 && (
                <section>
                  <h2 className="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                    Consultés récemment
                  </h2>
                  {recents.map((r) => (
                    <Ligne
                      key={r.id}
                      id={r.id}
                      nom={r.name}
                      detail={[r.reference, r.categoryName].filter(Boolean).join(' • ')}
                      icone={<Clock className="h-5 w-5" />}
                    />
                  ))}
                </section>
              )}

              {favoris.length === 0 && recents.length === 0 && (
                <p className="px-3 py-8 text-center text-gray-600 dark:text-gray-400">
                  Tapez au moins deux caractères pour chercher un matériel.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
