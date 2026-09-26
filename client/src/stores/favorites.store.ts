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
  /**
   * Les matériels épinglés avant que les favoris ne rejoignent le compte.
   * Lus une fois par `useReprendreFavorisLocaux` (`lib/accueil.ts`), puis vidés.
   */
  favoris: MaterielMemorise[]
  recents: MaterielMemorise[]

  enregistrerConsultation: (materiel: Omit<MaterielMemorise, 'vuLe'>) => void
  oublier: (id: number) => void
  viderFavoris: () => void
}

/**
 * Matériels récemment consultés, sur cet appareil.
 *
 * Un agent revient chaque jour sur les trois ou quatre mêmes machines. La liste
 * « Activité récente » du tableau de bord était globale — celle du service, pas
 * la sienne. Les consultations restent locales : propres à l'appareil, utiles
 * même sans réseau. Les favoris, eux, vivent désormais sur le compte, pour se
 * retrouver d'un appareil à l'autre.
 */
export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favoris: [],
      recents: [],

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

      viderFavoris: () => set({ favoris: [] }),
    }),
    { name: 'materiels-memorises' }
  )
)
