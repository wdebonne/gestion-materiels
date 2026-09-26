import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useGestion } from '@/lib/gestion'
import { useMenuPlugins } from '@/lib/modules'
import { useFavoritesStore } from '@/stores/favorites.store'

/**
 * L'accueil de chacun : ses blocs, ses actions rapides, ses favoris.
 *
 * Enregistré sur le compte (`/api/accueil`) : la même personne retrouve son
 * tableau de bord sur son poste et sur son téléphone. Le serveur tient le
 * catalogue et écarte ce qu'il ne connaît pas ; ce fichier décrit comment
 * l'afficher.
 */

// ------------------------------------------------------------------ catalogue

export type IdBloc =
  | 'favoris'
  | 'tickets'
  | 'batiments'
  | 'manifestations'
  | 'reservations'
  | 'parc'
  | 'categories'
  | 'alertes'
  | 'evenements'
  | 'activite'
  | 'vehicules'

export interface DefinitionBloc {
  id: IdBloc
  libelle: string
  description: string
  /** `plein` occupe toute la largeur sur grand écran. */
  largeur: 'moitie' | 'plein'
  /** Le module sans lequel le bloc n'a rien à montrer. */
  module?: string
}

/** Dans l'ordre de la disposition d'origine. */
export const BLOCS: DefinitionBloc[] = [
  { id: 'favoris', libelle: 'Mes favoris', description: 'Ce que vous avez épinglé, et vos raccourcis', largeur: 'plein' },
  { id: 'tickets', libelle: 'Tickets', description: 'Ce qui vous est confié, vos demandes', largeur: 'moitie', module: 'tickets' },
  { id: 'batiments', libelle: 'Bâtiments', description: 'Contrôles, documents à valider, contrats', largeur: 'moitie', module: 'batiments' },
  { id: 'manifestations', libelle: 'Manifestations', description: 'À confirmer, et les prochaines', largeur: 'moitie', module: 'manifestations' },
  { id: 'reservations', libelle: 'Réservations', description: 'À approuver, retours en retard', largeur: 'moitie', module: 'reservations' },
  { id: 'parc', libelle: 'Chiffres du parc', description: 'Catégories, matériels, valeur, alertes', largeur: 'plein' },
  { id: 'categories', libelle: 'Catégories', description: 'Les premières catégories du parc', largeur: 'moitie' },
  { id: 'alertes', libelle: 'Alertes récentes', description: 'Les cinq dernières alertes actives', largeur: 'moitie' },
  { id: 'evenements', libelle: 'Événements à venir', description: 'Le calendrier des sept prochains jours', largeur: 'moitie' },
  { id: 'activite', libelle: 'Activité récente', description: 'Les matériels modifiés dernièrement', largeur: 'moitie' },
  { id: 'vehicules', libelle: 'Véhicules et entretiens', description: 'Carburant, contrôles et entretiens à prévoir', largeur: 'plein' },
]

export type IdAction =
  | 'scanner'
  | 'plein'
  | 'chercher'
  | 'favoris'
  | 'nouvelle-demande'
  | 'mes-tickets'
  | 'reserver'
  | 'nouvelle-manifestation'

export const ACTIONS_ORIGINE: IdAction[] = ['scanner', 'plein', 'chercher', 'favoris']
export const MAX_ACTIONS = 4

// ------------------------------------------------------------------ l'API

export interface BlocDisposition {
  id: string
  visible: boolean
}

export type TypeFavori = 'materiel' | 'batiment' | 'ticket' | 'manifestation' | 'cle' | 'lien'

export interface Favori {
  id: number
  type: TypeFavori
  cibleId: number | null
  /** `null` quand la cible n'est plus accessible. */
  url: string | null
  libelle: string | null
  libellePerso: string | null
  detail: string | null
  disponible: boolean
}

interface ReponseAccueil {
  blocs: BlocDisposition[] | null
  actions: string[] | null
  favorisImportes: boolean
}

export const accueilApi = {
  lire: () => api.get<ReponseAccueil & { success: boolean }>('/accueil'),
  enregistrer: (saisie: { blocs?: BlocDisposition[] | null; actions?: string[] | null }) =>
    api.put<ReponseAccueil & { success: boolean }>('/accueil', saisie),
  favoris: () => api.get<{ success: boolean; favoris: Favori[] }>('/accueil/favoris'),
  ajouter: (saisie: { type: TypeFavori; cibleId?: number; url?: string; libelle?: string }) =>
    api.post<{ success: boolean; id: number; cree: boolean }>('/accueil/favoris', saisie),
  renommer: (id: number, libelle: string | null) => api.patch(`/accueil/favoris/${id}`, { libelle }),
  retirer: (id: number) => api.delete(`/accueil/favoris/${id}`),
  retirerCible: (type: TypeFavori, cibleId: number) => api.delete(`/accueil/favoris/cible/${type}/${cibleId}`),
  reordonner: (ids: number[]) => api.put('/accueil/favoris/ordre', { ids }),
  importer: (ids: number[]) => api.post<{ success: boolean; importes: number }>('/accueil/favoris/import', { ids }),
}

export const CLE_ACCUEIL = ['accueil'] as const
export const CLE_FAVORIS = ['accueil', 'favoris'] as const

// ------------------------------------------------------------------ disposition

export interface BlocAffiche extends DefinitionBloc {
  visible: boolean
  /** Le module est actif pour ce compte : sinon, le bloc n'est ni montré ni proposé. */
  disponible: boolean
}

/**
 * Assemble la disposition enregistrée et le catalogue : un bloc inconnu est
 * ignoré, un bloc apparu depuis s'ajoute à la fin, visible.
 */
export function fusionnerBlocs(enregistres: BlocDisposition[] | null, disponible: (b: DefinitionBloc) => boolean): BlocAffiche[] {
  const parId = new Map(BLOCS.map((b) => [b.id as string, b]))
  const ordre: BlocDisposition[] = enregistres ?? BLOCS.map((b) => ({ id: b.id, visible: true }))
  const vus = new Set<string>()
  const resultat: BlocAffiche[] = []
  for (const { id, visible } of ordre) {
    const def = parId.get(id)
    if (!def || vus.has(id)) continue
    vus.add(id)
    resultat.push({ ...def, visible, disponible: disponible(def) })
  }
  for (const def of BLOCS) {
    if (!vus.has(def.id)) resultat.push({ ...def, visible: true, disponible: disponible(def) })
  }
  return resultat
}

export function useAccueil() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: CLE_ACCUEIL,
    queryFn: async () => (await accueilApi.lire()).data,
    staleTime: 60_000,
  })
  const { data: modules, isSuccess: modulesCharges } = useMenuPlugins()
  const { consulteDesBatiments, chargement: gestionEnCours } = useGestion()

  const moduleActif = (slug: string) => !!modules?.some((m) => m.slug === slug)
  const disponible = (b: DefinitionBloc) => {
    if (!b.module) return true
    // Tant que le menu n'est pas chargé, on s'abstient plutôt que de faire clignoter.
    if (!modulesCharges || !moduleActif(b.module)) return false
    // Même règle que le menu : un bâtiment qu'on ne suit pas n'a rien à signaler.
    if (b.module === 'batiments') return !gestionEnCours && consulteDesBatiments
    return true
  }

  const enregistrer = useMutation({
    mutationFn: async (saisie: { blocs?: BlocDisposition[] | null; actions?: string[] | null }) =>
      (await accueilApi.enregistrer(saisie)).data,
    // Optimiste : la case cochée se voit tout de suite, le serveur confirme ensuite.
    onMutate: async (saisie) => {
      await queryClient.cancelQueries({ queryKey: CLE_ACCUEIL })
      const avant = queryClient.getQueryData<ReponseAccueil>(CLE_ACCUEIL)
      queryClient.setQueryData(CLE_ACCUEIL, { ...(avant ?? { favorisImportes: false }), ...saisie })
      return { avant }
    },
    onError: (_e, _s, contexte) => queryClient.setQueryData(CLE_ACCUEIL, contexte?.avant),
    onSuccess: (reponse) => queryClient.setQueryData(CLE_ACCUEIL, reponse),
  })

  return {
    chargement: isLoading,
    blocs: fusionnerBlocs(data?.blocs ?? null, disponible),
    actions: (data?.actions ?? ACTIONS_ORIGINE) as IdAction[],
    personnalise: !!data && (data.blocs !== null || data.actions !== null),
    favorisImportes: data?.favorisImportes ?? true,
    charge: !!data,
    moduleActif,
    modulesCharges,
    enregistrer: enregistrer.mutate,
  }
}

// ------------------------------------------------------------------ favoris

/** `actif: false` diffère la lecture : la recherche globale, montée partout, n'en a besoin qu'ouverte. */
export function useFavoris({ actif = true }: { actif?: boolean } = {}) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: CLE_FAVORIS,
    queryFn: async () => (await accueilApi.favoris()).data.favoris,
    staleTime: 30_000,
    enabled: actif,
  })
  const rafraichir = () => queryClient.invalidateQueries({ queryKey: CLE_FAVORIS })

  const retirer = useMutation({
    mutationFn: (id: number) => accueilApi.retirer(id),
    onMutate: (id) => {
      queryClient.setQueryData<Favori[]>(CLE_FAVORIS, (liste) => liste?.filter((f) => f.id !== id))
    },
    onSettled: rafraichir,
  })
  const reordonner = useMutation({
    mutationFn: (ids: number[]) => accueilApi.reordonner(ids),
    onMutate: (ids) => {
      queryClient.setQueryData<Favori[]>(CLE_FAVORIS, (liste) =>
        liste ? [...liste].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)) : liste
      )
    },
    onSettled: rafraichir,
  })
  const renommer = useMutation({
    mutationFn: ({ id, libelle }: { id: number; libelle: string | null }) => accueilApi.renommer(id, libelle),
    onSettled: rafraichir,
  })
  const ajouter = useMutation({
    mutationFn: (saisie: Parameters<typeof accueilApi.ajouter>[0]) => accueilApi.ajouter(saisie),
    onSettled: rafraichir,
  })
  const retirerCible = useMutation({
    mutationFn: ({ type, cibleId }: { type: TypeFavori; cibleId: number }) => accueilApi.retirerCible(type, cibleId),
    onMutate: ({ type, cibleId }) => {
      queryClient.setQueryData<Favori[]>(CLE_FAVORIS, (liste) =>
        liste?.filter((f) => !(f.type === type && f.cibleId === cibleId))
      )
    },
    onSettled: rafraichir,
  })

  const favoris = data ?? []
  return {
    favoris,
    chargement: isLoading,
    estFavori: (type: TypeFavori, cibleId: number) => favoris.some((f) => f.type === type && f.cibleId === cibleId),
    ajouter: ajouter.mutateAsync,
    retirer: retirer.mutate,
    retirerCible: retirerCible.mutate,
    renommer: renommer.mutate,
    reordonner: reordonner.mutate,
  }
}

/**
 * Reprend une fois, sur le compte, les matériels épinglés dans ce navigateur.
 *
 * L'envoi a lieu même sans favori local : c'est lui qui pose le drapeau, et un
 * autre appareil qui en garderait ne les ferait pas revenir plus tard.
 */
export function useReprendreFavorisLocaux(actif: boolean) {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: CLE_ACCUEIL,
    queryFn: async () => (await accueilApi.lire()).data,
    enabled: actif,
    staleTime: 60_000,
  })
  const envoye = useRef(false)

  useEffect(() => {
    if (!actif || !data || data.favorisImportes || envoye.current) return
    envoye.current = true
    const ids = useFavoritesStore.getState().favoris.map((f) => f.id)
    accueilApi
      .importer(ids)
      .then(() => {
        useFavoritesStore.getState().viderFavoris()
        queryClient.invalidateQueries({ queryKey: CLE_ACCUEIL })
        queryClient.invalidateQueries({ queryKey: CLE_FAVORIS })
      })
      .catch(() => {
        // On retentera à la prochaine ouverture : rien n'a été vidé.
        envoye.current = false
      })
  }, [actif, data, queryClient])
}
