import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface MaterielMemorise {
  id: number
  name: string
  reference?: string
  categoryName?: string
  /** Horodatage de la dernière consultation. */
  vuLe: number
}

const MAX_RECENTS = 8

interface FavoritesState {
  favoris: MaterielMemorise[]
  recents: MaterielMemorise[]

  basculerFavori: (materiel: Omit<MaterielMemorise, 'vuLe'>) => void
  estFavori: (id: number) => boolean
  enregistrerConsultation: (materiel: Omit<MaterielMemorise, 'vuLe'>) => void
  oublier: (id: number) => void
}

/**
 * Matériels épinglés et récemment consultés.
 *
 * Un agent revient chaque jour sur les trois ou quatre mêmes machines. La liste
 * « Activité récente » du tableau de bord était globale — celle du service, pas
 * la sienne. On mémorise donc localement, par appareil : aucune API, aucune
 * table, et l'information reste utile même sans réseau.
 */
export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favoris: [],
      recents: [],

      basculerFavori: (materiel) => {
        const { favoris } = get()
        const dejaPresent = favoris.some((f) => f.id === materiel.id)

        set({
          favoris: dejaPresent
            ? favoris.filter((f) => f.id !== materiel.id)
            : [...favoris, { ...materiel, vuLe: Date.now() }],
        })
      },

      estFavori: (id) => get().favoris.some((f) => f.id === id),

      enregistrerConsultation: (materiel) => {
        const autres = get().recents.filter((r) => r.id !== materiel.id)
        set({
          recents: [{ ...materiel, vuLe: Date.now() }, ...autres].slice(0, MAX_RECENTS),
        })
      },

      oublier: (id) =>
        set((etat) => ({
          favoris: etat.favoris.filter((f) => f.id !== id),
          recents: etat.recents.filter((r) => r.id !== id),
        })),
    }),
    { name: 'materiels-memorises' }
  )
)
