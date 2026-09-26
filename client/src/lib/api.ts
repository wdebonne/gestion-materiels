import axios from 'axios'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/stores/auth.store'
import { getErrorMessage, isNetworkError } from '@/lib/errors'
import { offlineQueue, estDifferable } from '@/lib/offlineQueue'

const API_URL = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Intercepteur pour ajouter le token
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

/** Décrit une saisie en attente dans les termes de l'agent, pas de l'API. */
function decrireSaisie(url: string): string {
  if (/\/fuel$/.test(url)) return 'Plein de carburant'
  if (/\/compteurs$/.test(url)) return 'Relevé de compteur'
  if (/\/technical-control$/.test(url)) return 'Contrôle technique'
  if (/green-spaces\/\d+\/maintenances$/.test(url)) return "Entretien d'espace vert"
  if (/\/maintenance$/.test(url)) return 'Entretien'
  return 'Saisie'
}

/**
 * Signale une session expirée SANS recharger la page ni effacer l'utilisateur :
 * l'application affiche une modale de reconnexion par-dessus l'écran courant,
 * ce qui évite de perdre un formulaire en cours de saisie.
 */
function handleExpiredSession() {
  const { isAuthenticated, setSessionExpired } = useAuthStore.getState()

  // Au démarrage (token périmé en localStorage), l'utilisateur n'est pas encore
  // authentifié : `checkAuth` gère le cas, inutile d'afficher la modale.
  if (isAuthenticated) {
    setSessionExpired(true)
  } else {
    useAuthStore.getState().logout()
  }
}

/**
 * Le message d'un 429, avec l'attente que le serveur annonce.
 *
 * `RateLimit-Reset` donne le nombre de secondes avant que le compteur ne
 * reparte ; sans lui, on ne promet pas de durée.
 */
export function messageTropDeRequetes(entetes: Record<string, unknown> | undefined): string {
  const secondes = Number(entetes?.['ratelimit-reset'])
  if (!Number.isFinite(secondes) || secondes <= 0) {
    return 'Trop de requêtes en peu de temps. Patientez quelques minutes, votre session reste ouverte.'
  }
  const minutes = Math.max(1, Math.ceil(secondes / 60))
  return `Trop de requêtes en peu de temps. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''} — votre session reste ouverte.`
}

/**
 * Routes dont un 401 ne décrit pas une session à récupérer.
 *
 * Sans cette exclusion, un 401 sur `/auth/logout` appelait `handleExpiredSession`,
 * qui appelait `logout()`, qui rappelait `/auth/logout` : une dizaine de
 * requêtes en cascade, jusqu'au 429 du limiteur. Comme celui-ci couvre tout
 * `/api/auth` à 10 requêtes par quart d'heure, se déconnecter — ou simplement
 * se tromper de mot de passe — interdisait de se reconnecter pendant 15 minutes.
 */
const ROUTES_SANS_REPRISE_DE_SESSION = [
  '/auth/logout',
  '/auth/refresh',
  '/auth/login',
  // Les cérémonies WebAuthn répondent 401 quand la signature est refusée. Ce
  // 401 ne décrit pas une session à récupérer : c'est le résultat même de la
  // tentative de connexion, et vouloir la rafraîchir ferait tomber l'écran de
  // connexion dans la cascade que ces exclusions existent pour éviter.
  '/auth/passkey/login',
  '/auth/passkey/2fa',
]

function estUneRouteDAuthentification(url: string): boolean {
  return ROUTES_SANS_REPRISE_DE_SESSION.some((route) => url.includes(route))
}

// Intercepteur pour gérer les erreurs
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // Si erreur 401 et pas déjà tenté de refresh
    if (
      error.response?.status === 401 &&
      !originalRequest?._retry &&
      !estUneRouteDAuthentification(originalRequest?.url ?? '')
    ) {
      originalRequest._retry = true

      const refreshToken = useAuthStore.getState().refreshToken
      if (refreshToken) {
        try {
          const response = await axios.post(`${API_URL}/auth/refresh`, { refreshToken })
          const { accessToken, refreshToken: newRefreshToken } = response.data

          useAuthStore.getState().setTokens(accessToken, newRefreshToken)
          originalRequest.headers.Authorization = `Bearer ${accessToken}`

          return api(originalRequest)
        } catch (refreshError) {
          handleExpiredSession()
          return Promise.reject(refreshError)
        }
      } else {
        handleExpiredSession()
      }
    }

    // 403 : le serveur refuse l'action. Sans ce message, l'utilisateur remplit
    // un formulaire, appuie sur « Ajouter », et rien ne se passe.
    if (error.response?.status === 403) {
      toast.error(getErrorMessage(error))
    }

    // 429 : le limiteur de débit. Sans message, l'écran restait vide ou à
    // moitié chargé, et rien ne disait qu'il suffisait d'attendre.
    // L'écran de connexion affiche lui-même le refus du limiteur d'authentification.
    if (error.response?.status === 429 && !estUneRouteDAuthentification(originalRequest?.url ?? '')) {
      toast.error(messageTropDeRequetes(error.response.headers), { id: 'trop-de-requetes' })
    }

    // Aucune réponse : le réseau est coupé. C'est le cas le plus fréquent
    // en extérieur, et il était jusqu'ici totalement silencieux.
    if (isNetworkError(error)) {
      const url: string = originalRequest?.url ?? ''
      const methode: string = originalRequest?.method ?? ''

      // Relevé de terrain sur une URL explicitement autorisée : on le conserve
      // pour l'envoyer au retour du réseau, et on laisse l'écran avancer.
      if (estDifferable(url, methode)) {
        const saisie = await offlineQueue.enqueue({
          url,
          method: methode.toUpperCase() as 'POST' | 'PUT' | 'PATCH',
          body: originalRequest.data ? JSON.parse(originalRequest.data) : undefined,
          label: decrireSaisie(url),
          userId: useAuthStore.getState().user?.id,
        })

        toast.success('Saisie conservée. Elle partira au retour du réseau.', {
          id: 'file-hors-ligne',
        })
        window.dispatchEvent(new CustomEvent('file-hors-ligne:changement'))

        // On résout au lieu de rejeter : le formulaire se ferme, et le
        // bandeau permanent rappelle que l'envoi reste à faire.
        return { data: { success: true, queued: true, id: saisie.id }, status: 202 }
      }

      toast.error(getErrorMessage(error), { id: 'network-offline' })
    }

    return Promise.reject(error)
  }
)

export default api

// Types
/**
 * Un compte, ou une personne qui n'en a pas.
 *
 * `users` est l'annuaire unique de l'application : on y saisit aussi bien
 * l'agent qui s'y connecte que le gardien à qui on remet un trousseau. C'est
 * `canLogin` qui les sépare, et de là vient que `email` puisse manquer — une
 * personne sans compte n'en a pas besoin, et lui en inventer une produirait un
 * faux affiché partout.
 */
export interface User {
  id: number
  email: string | null
  firstName?: string
  lastName?: string
  role: 'admin' | 'supervisor' | 'agent' | 'user' | 'service'
  avatar?: string
  isActive: boolean
  /** Faux pour une fiche d'annuaire : elle est désignable, jamais connectée. */
  canLogin: boolean
  createdAt: string
  lastLogin?: string
}

export interface Category {
  id: number
  name: string
  slug: string
  description?: string
  image?: string
  hasSubcategories: boolean
  sortOrder: number
  /** Cette catégorie ne contient que des prestations. Elle donne le ton à ses sous-catégories. */
  isPrestation?: boolean
  /** Son matériel est proposé dans les manifestations. Jamais nul : c'est la valeur de référence. */
  availableForManifestations?: boolean
  objectCount?: number
  subcategoryCount?: number
  createdAt: string
  updatedAt: string
}

export interface Subcategory {
  id: number
  categoryId: number
  name: string
  slug: string
  image?: string
  sortOrder: number
  /**
   * Trois états : `true` prestation, `false` matériel, `null` hérite de la
   * catégorie. C'est ce qui permet de marquer « Technique › Prestation » sans
   * toucher à « Technique › Mobilier ».
   */
  isPrestation?: boolean | null
  /** Trois états, comme `isPrestation` : `null` hérite de la catégorie. */
  availableForManifestations?: boolean | null
  objectCount?: number
  createdAt: string
  updatedAt: string
}

export interface GestionObject {
  id: number
  categoryId?: number
  categoryName?: string
  categorySlug?: string
  subcategoryId?: number
  subcategoryName?: string
  subcategorySlug?: string
  name: string
  description?: string
  image?: string
  reference?: string
  /**
   * Le numéro d'inventaire de la collectivité, distinct du numéro comptable.
   *
   * La comptabilité numérote ce qu'elle a amorti, les services numérotent ce
   * qu'ils manipulent : tenir les deux fait du rapprochement une jointure
   * plutôt qu'un après-midi de recopie.
   */
  inventaireInterne?: string | null
  serialNumber?: string
  purchaseDate?: string
  purchasePrice?: number
  status: 'active' | 'inactive' | 'maintenance' | 'out_of_service'
  location?: string
  notes?: string
  customFields?: Record<string, any>
  /** Choix propre au matériel ; `null` = il hérite de sa branche. */
  isPrestation?: boolean | null
  /** Résultat effectif après héritage : ce qui s'applique vraiment. */
  prestation?: boolean
  /**
   * Les trois natures qu'un matériel du parc peut prendre.
   *
   * `unique` un exemplaire identifié — un véhicule, qui ne peut pas être à deux
   * endroits. `lot` une quantité — cinquante chaises, que deux manifestations se
   * partagent. `prestation` un acte, sans stock ni exemplaire.
   */
  nature?: 'unique' | 'lot' | 'prestation'
  materialType?: 'unique' | 'lot'
  /** Quantité détenue, pour un lot seulement. */
  quantityTotal?: number
  /** Stock d'un lot, sur sa fiche de parc. */
  quantityLent?: number
  quantityReservedFuture?: number
  quantityAvailable?: number
  /**
   * Ce que vaut une unité, pour chiffrer une manifestation : le prix d'une
   * chaise, le coût d'une vacation, la valeur de remplacement d'un exemplaire.
   */
  unitCost?: number
  /** Choix propre au matériel ; `null` = il hérite de sa branche. */
  availableForManifestations?: boolean | null
  /** Résultat effectif après héritage : ce qui s'applique vraiment. */
  pretable?: boolean
  createdAt: string
  updatedAt: string
  plugins?: Plugin[]
  pluginData?: Record<string, any[]>
  alerts?: Alert[]
}

export interface Plugin {
  id: number
  name: string
  slug: string
  version: string
  description?: string
  author?: string
  icon?: string
  isActive: boolean
  isSystem: boolean
  config: Record<string, any>
  associations?: PluginAssociation[]
  createdAt: string
  updatedAt: string
}

export interface PluginAssociation {
  id: number
  categoryId?: number
  categoryName?: string
  subcategoryId?: number
  subcategoryName?: string
}

export interface CalendarEvent {
  id: number
  title: string
  description?: string
  eventType: string
  start: string
  end?: string
  allDay: boolean
  objectId?: number
  objectName?: string
  pluginReference?: string
  pluginReferenceId?: number
  color: string
  reminderBefore?: number
  createdAt: string
}

export interface Alert {
  id: number
  title: string
  message?: string
  alertType: string
  severity: 'info' | 'warning' | 'critical'
  objectId?: number
  objectName?: string
  pluginReference?: string
  pluginReferenceId?: number
  isRead: boolean
  isDismissed: boolean
  dueDate?: string
  createdAt: string
}

export interface EmailTemplate {
  id: number
  name: string
  subject: string
  body: string
  variables: string[]
  description?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface SmtpConfig {
  id?: number
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  fromEmail: string
  fromName: string
  isActive: boolean
}

export interface Backup {
  id: number
  filename: string
  fileSize: number
  backupType: 'manual' | 'auto' | 'securite'
  status: string
  notes?: string
  createdAt: string
}

export interface FuelEntry {
  id: number
  objectId: number
  fuelType: string
  quantity: number
  unitPrice?: number
  totalPrice?: number
  mileage?: number
  station?: string
  entryDate: string
  notes?: string
  createdAt: string
}

export interface TechnicalControl {
  id: number
  objectId: number
  controlDate: string
  expiryDate: string
  mileage?: number
  result?: string
  centerName?: string
  cost?: number
  document?: string
  notes?: string
  createdAt: string
}

export interface Maintenance {
  id: number
  objectId: number
  maintenanceType: string
  maintenanceDate: string
  nextDate?: string
  mileage?: number
  nextMileage?: number
  cost?: number
  provider?: string
  document?: string
  notes?: string
  addToCalendar: boolean
  createdAt: string
}

// ======================== MANIFESTATIONS ========================

export interface ManifestationStockItem {
  id: number
  name: string
  description: string
  category: string
  quantity_total: number
  unit: string
  etat: string
  lieu: string
  stock_type: string
  price: number
  category_id: number | null
  subcategory_id: number | null
  /** Une prestation se demande et se réalise ; elle ne se stocke pas. */
  is_prestation?: number
  category_name?: string
  category_slug?: string
  subcategory_name?: string
  /** Nul pour une prestation, qui n'a pas de disponibilité. */
  quantity_available: number
  quantity_lent: number
  quantity_reserved_future: number
  /** Renseignés seulement quand une période est demandée. */
  engage_previsionnel?: number
  engage_reel?: number
  disponible_previsionnel?: number
  disponible_reel?: number
  created_at: string
  updated_at: string
}

/** Un service réduit à ce qu'il faut pour l'afficher et le filtrer. */
export interface ServiceBref {
  id: number
  name: string
  slug: string
}

/**
 * Une ligne du catalogue : ce que la collectivité peut prêter, d'où que ça vienne.
 *
 * Deux tables portent ce qu'on prête — le stock des manifestations pour les quantités anonymes,
 * le parc pour les exemplaires, les lots et les prestations déclarées par branche. L'écran, lui,
 * n'a pas à connaître cette frontière : `source` dit seulement d'où vient la ligne, pour savoir
 * où aller la modifier.
 */
export interface ArticleCatalogue {
  /** Référence stable et sans collision entre les deux tables : `stock:7`, `parc:12`. */
  ref: string
  source: 'stock' | 'parc'
  id: number
  name: string
  category: string
  category_id: number | null
  unit: string
  is_prestation: boolean
  /** Une quantité anonyme, un exemplaire identifié, ou un acte : les trois se comptent autrement. */
  nature: 'prestation' | 'lot' | 'unique'
  /** `null` pour une prestation : elle ne se stocke pas. */
  quantity_total: number | null
  /** `null` veut dire « sans limite », et non « zéro ». */
  quantity_available: number | null
  /** Physiquement dehors sur la période. */
  quantity_out: number
  /** Promis sur la période sans être sorti. */
  quantity_engaged: number
  /** Services dont le périmètre couvre cet article ; vide s'il n'est rattaché à rien. */
  services: ServiceBref[]
}

/** Où en est une ligne de sortie : partie, revenue, ou encore à partir. */
export type EtatSortie = 'dehors' | 'rendu' | 'prevue'

/**
 * Un article dehors — ou qui va sortir — sur une manifestation donnée.
 *
 * Une ligne par article **et par manifestation** : cinquante chaises dehors en trois endroits
 * sont trois déplacements, pas un.
 */
export interface LigneSortie {
  ref: string
  source: 'stock' | 'parc'
  id: number
  name: string
  category: string
  category_id: number | null
  is_prestation: boolean
  services: ServiceBref[]
  manifestation_id: number
  manifestation: string
  status: string
  debut: string
  fin: string
  quantite_demandee: number
  quantite_sortie: number
  quantite_rendue: number
  quantite_dehors: number
  etat: EtatSortie
}

/** Article demandé au-delà de ce qui restera disponible sur la période. */
export interface ConflitStock {
  stock_id: number
  stock_name: string
  demande: number
  disponible: number
  manquant: number
}

export interface ManifestationMaterial {
  id?: number
  stock_id: number
  stock_name?: string
  unit?: string
  stock_category?: string
  quantity_requested: number
  quantity_delivered: number
  quantity_recovered: number
  /** Casse, perte ou vol constaté au retour : diminue le stock physique. */
  quantity_lost?: number
  loss_reason?: string | null
  unit_value: number
  notes: string
  stock_total?: number
  /** Vient de l'article : une prestation n'a ni disponibilité ni casse. */
  is_prestation?: number
}

export interface Manifestation {
  id: number
  title: string
  date_start: string
  date_end: string
  start_time: string
  end_time: string
  expected_people: number
  contact_name: string
  contact_phone: string
  contact_email: string
  delivery_address: string
  delivery_date: string
  recovery_date: string
  notes_interior: string
  notes_exterior: string
  status: string
  created_by: number
  created_by_name: string
  archived_at: string
  created_at: string
  updated_at: string
  materials: ManifestationMaterial[]
  /** Matériels uniques du parc : un véhicule, un vidéoprojecteur identifié. */
  objects?: ObjetManifestation[]
  /** Lignes reçues d'un formulaire qu'aucun article du stock n'a permis de rattacher. */
  intake_unmatched?: string | null
  /** Réponses du formulaire qu'aucune colonne ne porte, telles qu'elles sont arrivées. */
  intake_details?: string | null
  /** Décompte des coûts, joint au détail. */
  cout?: CoutManifestation
}

/**
 * Une réponse du formulaire qu'aucune colonne ne porte.
 *
 * Elle voyage avec son intitulé et sa section : l'écran qui l'affiche n'a rien
 * à connaître du catalogue de réception, et une demande reçue l'an dernier se
 * relit telle qu'elle a été posée.
 */
export interface DetailDemande {
  cle: string
  libelle: string
  section: string
  valeur: string
}

export interface ManifestationStats {
  total: number
  /** Demandes reçues d'un formulaire, en attente de confirmation. */
  pending: number
  upcoming: number
  delivered: number
  archived: number
  stockItems: number
}

export interface ManifestationFilters {
  status?: string
  search?: string
  archived?: boolean
  date_from?: string
  date_to?: string
}

export interface ManifestationFormData {
  title: string
  date_start: string
  date_end?: string
  start_time?: string
  end_time?: string
  expected_people?: number
  contact_name?: string
  contact_phone?: string
  contact_email?: string
  delivery_address?: string
  delivery_date?: string
  recovery_date?: string
  notes_interior?: string
  notes_exterior?: string
  materials?: Omit<ManifestationMaterial, 'id' | 'stock_name' | 'unit' | 'stock_category' | 'stock_total'>[]
  /** Matériels uniques demandés, par identifiant de fiche parc. */
  objects?: Array<{ object_id: number; notes?: string | null; quantity?: number }>
}

export interface StockFormData {
  name: string
  /** Raccordement électrique, débit de boissons, personnel : pas de stock. */
  is_prestation?: boolean
  description?: string
  category?: string
  quantity_total: number
  unit?: string
  etat?: string
  lieu?: string
  stock_type?: string
  price?: number
  category_id?: number | null
  subcategory_id?: number | null
}

/**
 * Ce qui part et ce qui rentre aujourd'hui.
 *
 * Le miroir exact de `src/services/tourneeManifestation.service.ts` : les deux
 * gisements de matériel y sont déjà réunis et chaque ligne dit ce qu'il lui
 * reste à faire. L'écran n'a donc rien à recalculer — c'est le serveur qui
 * tranche, et lui seul, pour que la règle ne se dédouble pas.
 */
export type PhaseTournee = 'livraison' | 'recuperation'

/** `fait` veut dire « tout saisi », pas « clos » : le statut suit après. */
export type EtatArret = 'a_faire' | 'commence' | 'fait'

/** Un nombre, un oui ou non, un acte réalisé : trois saisies différentes. */
export type NatureLigne = 'quantite' | 'exemplaire' | 'prestation'

export interface LigneTournee {
  /** Référence de la ligne : `stock:41`, `parc:12`. */
  ref: string
  source: 'stock' | 'parc'
  ligne_id: number
  nom: string
  /** Numéro d'inventaire ou de série, pour reconnaître l'exemplaire sur place. */
  repere: string
  unite: string
  nature: NatureLigne
  demande: number
  livre: number
  rendu: number
  perdu: number
  etat_retour: string | null
  /** Ce qu'il reste à faire sur la phase en cours. */
  reste: number
}

export interface ArretTournee {
  manifestation_id: number
  titre: string
  statut: string
  phase: PhaseTournee
  jour: string
  /** Jours de retard ; 0 quand l'arrêt est à l'heure ou à venir. */
  retard: number
  lieu: string
  contact_nom: string
  contact_tel: string
  heure_debut: string
  heure_fin: string
  consignes: string
  lignes: LigneTournee[]
  reste: number
  fait: number
  etat: EtatArret
}

export interface Tournee {
  jour: string
  jusqu_au: string
  livraisons: ArretTournee[]
  recuperations: ArretTournee[]
}

// --- API Manifestations ---

export const manifestationApi = {
  // Manifestations CRUD
  getAll: (filters?: ManifestationFilters) => {
    const p = new URLSearchParams()
    if (filters?.status) p.append('status', filters.status)
    if (filters?.search) p.append('search', filters.search)
    if (filters?.archived) p.append('archived', 'true')
    if (filters?.date_from) p.append('date_from', filters.date_from)
    if (filters?.date_to) p.append('date_to', filters.date_to)
    return api.get<{ success: boolean; data: Manifestation[] }>(`/manifestations?${p.toString()}`)
  },
  getById: (id: number) =>
    api.get<{ success: boolean; data: Manifestation }>(`/manifestations/${id}`),
  create: (data: ManifestationFormData) =>
    api.post<{
      success: boolean
      data: Manifestation
      conflits: ConflitStock[]
      conflits_objets: IndisponibiliteObjet[]
    }>('/manifestations', data),
  update: (id: number, data: ManifestationFormData) =>
    api.put<{ success: boolean; conflits: ConflitStock[]; conflits_objets: IndisponibiliteObjet[] }>(
      `/manifestations/${id}`,
      data
    ),
  delete: (id: number) =>
    api.delete<{ success: boolean }>(`/manifestations/${id}`),
  // Le serveur accepte un commentaire de transition et le consigne dans
  // l'historique ; l'appel le laissait tomber, si bien qu'aucune validation ni
  // annulation ne pouvait être motivée.
  updateStatus: (id: number, status: string, comment?: string) =>
    api.put<{ success: boolean }>(`/manifestations/${id}/status`, { status, comment }),
  updateMaterials: (id: number, materials: Partial<ManifestationMaterial>[]) =>
    api.put<{ success: boolean }>(`/manifestations/${id}/materials`, { materials }),

  /**
   * `jusqu_au` prépare la veille pour le lendemain ; les retards remontent
   * toujours. `manifestation` réduit la tournée à un seul dossier, sans
   * condition de date : c'est la saisie ouverte depuis la liste.
   */
  getTournee: (filtres?: { jusqu_au?: string; manifestation?: number }) => {
    const p = new URLSearchParams()
    if (filtres?.jusqu_au) p.append('jusqu_au', filtres.jusqu_au)
    if (filtres?.manifestation) p.append('manifestation', String(filtres.manifestation))
    return api.get<{ success: boolean; data: Tournee }>(`/manifestations/tournee?${p.toString()}`)
  },

  // Stats
  getStats: () =>
    api.get<{ success: boolean; data: ManifestationStats }>('/manifestations/stats/summary'),

  // Stock
  // Une période fait apparaître le prévisionnel et le réel à cette date, ce que
  // demande « aurai-je 200 chaises le 14 juillet ? ».
  getStock: (periode?: { date_from: string; date_to?: string }) => {
    const p = periode
      ? `?date_from=${periode.date_from}&date_to=${periode.date_to || periode.date_from}`
      : ''
    return api.get<{ success: boolean; data: ManifestationStockItem[] }>(`/manifestations/stock${p}`)
  },
  getStockCategories: () =>
    api.get<{ success: boolean; data: string[] }>('/manifestations/stock/categories'),
  getStockEtats: () =>
    api.get<{ success: boolean; data: string[] }>('/manifestations/stock/etats'),
  getStockLieux: () =>
    api.get<{ success: boolean; data: string[] }>('/manifestations/stock/lieux'),
  getStockTypes: () =>
    api.get<{ success: boolean; data: string[] }>('/manifestations/stock/types'),
  getStockAvailability: (date?: string, dateFin?: string) => {
    const p = new URLSearchParams()
    if (date) p.append('date_from', date)
    if (dateFin || date) p.append('date_to', dateFin || date!)
    const requete = p.toString() ? `?${p.toString()}` : ''
    return api.get<{ success: boolean; data: ManifestationStockItem[]; periode?: { debut: string; fin: string } }>(
      `/manifestations/stock/availability${requete}`
    )
  },
  // Catalogue : le stock et le parc réunis, ce que l'onglet « Stock matériel » montre
  // réellement. `getStock` ne connaît que `manifestation_stock`, vide dans une collectivité qui
  // tient tout son matériel prêtable dans le parc.
  getCatalogue: (params?: { date_from?: string; date_to?: string; service?: string; kind?: string }) => {
    const p = new URLSearchParams()
    if (params?.date_from) p.append('date_from', params.date_from)
    if (params?.date_to) p.append('date_to', params.date_to)
    if (params?.service) p.append('service', params.service)
    if (params?.kind) p.append('kind', params.kind)
    const requete = p.toString() ? `?${p.toString()}` : ''
    return api.get<{ success: boolean; data: ArticleCatalogue[]; periode?: { debut: string; fin: string } }>(
      `/manifestations/catalogue${requete}`
    )
  },

  // Sorties : où est le matériel, et ce qui part. Sans dates, le jour même.
  getSorties: (params?: { date_from?: string; date_to?: string; service?: string; kind?: string; search?: string }) => {
    const p = new URLSearchParams()
    if (params?.date_from) p.append('date_from', params.date_from)
    if (params?.date_to) p.append('date_to', params.date_to)
    if (params?.service) p.append('service', params.service)
    if (params?.kind) p.append('kind', params.kind)
    if (params?.search) p.append('search', params.search)
    const requete = p.toString() ? `?${p.toString()}` : ''
    return api.get<{ success: boolean; data: LigneSortie[]; periode?: { debut: string; fin: string } }>(
      `/manifestations/sorties${requete}`
    )
  },

  createStock: (data: StockFormData) =>
    api.post<{ success: boolean; data: ManifestationStockItem }>('/manifestations/stock', data),
  updateStock: (id: number, data: StockFormData) =>
    api.put<{ success: boolean; data: ManifestationStockItem }>(`/manifestations/stock/${id}`, data),
  deleteStock: (id: number) =>
    api.delete<{ success: boolean }>(`/manifestations/stock/${id}`),

  // Alias : « tables » doit trouver « Table 180 cm » sans qu'on rebaptise le stock.
  getAliases: (stockId: number) =>
    api.get<{ success: boolean; data: StockAlias[] }>(`/manifestations/stock/${stockId}/aliases`),
  addAlias: (stockId: number, alias: string) =>
    api.post<{ success: boolean; data: StockAlias }>(`/manifestations/stock/${stockId}/aliases`, { alias }),
  deleteAlias: (aliasId: number) =>
    api.delete<{ success: boolean }>(`/manifestations/stock/aliases/${aliasId}`),
}

// ======================== RÉCEPTION DES DEMANDES ========================

export interface StockAlias {
  id: number
  stock_id: number
  alias: string
}

export interface IntakeSource {
  id: number
  name: string
  slug: string
  is_active: number
  has_secret: boolean
  field_mapping: string | null
  material_mapping: string | null
  last_received_at: string | null
  last_status: string | null
  created_at: string
  updated_at: string
}

export interface IntakeRequest {
  id: number
  source_id: number | null
  source_name: string | null
  external_id: string | null
  payload: string
  signature_ok: number
  status: 'accepted' | 'rejected' | 'duplicate'
  manifestation_id: number | null
  manifestation_title: string | null
  error: string | null
  received_at: string
}

export interface ChampIntake {
  champ: string
  libelle: string
  /** Regroupement d'affichage : Manifestation, Demandeur, Lieux, Matériel… */
  section: string
  obligatoire: boolean
  type: string
  /** Colonne de la manifestation qui reçoit la valeur ; absente : un détail. */
  colonne?: string
  /** Nom sous lequel un modèle de document affiche la valeur. */
  cleModele: string
  exemple: string
  alias: string[]
}

/**
 * Chemins réglés pour un champ.
 *
 * Plusieurs sont acceptés, et le premier qui porte une valeur l'emporte : un
 * formulaire pose la même question sous plusieurs intitulés — un par pôle, un
 * par qualité de demandeur — et n'en remplit qu'un.
 */
export type CorrespondanceIntake = Record<string, string | string[]>

export const intakeApi = {
  getSources: () =>
    api.get<{ success: boolean; data: IntakeSource[] }>('/manifestations/intake/sources/list'),
  // Les chemins proposés sont ceux réellement vus dans la dernière demande :
  // un champ de saisie libre laisserait passer la moindre faute de frappe.
  getChamps: (id: number) =>
    api.get<{
      success: boolean
      data: {
        champs: ChampIntake[]
        chemins: string[]
        correspondance: CorrespondanceIntake
        origine: 'imposee' | 'detectee'
        derniere_demande: unknown
      }
    }>(`/manifestations/intake/sources/${id}/champs`),
  createSource: (data: { name: string; slug: string }) =>
    api.post<{ success: boolean; data: { id: number; name: string; slug: string; secret: string } }>(
      '/manifestations/intake/sources',
      data
    ),
  updateSource: (
    id: number,
    data: {
      name: string
      field_mapping?: CorrespondanceIntake | null
      material_mapping?: Record<string, string> | null
      is_active?: boolean
    }
  ) => api.put<{ success: boolean }>(`/manifestations/intake/sources/${id}`, data),
  regenerateSecret: (id: number) =>
    api.post<{ success: boolean; data: { secret: string } }>(`/manifestations/intake/sources/${id}/secret`, {}),
  deleteSource: (id: number) =>
    api.delete<{ success: boolean }>(`/manifestations/intake/sources/${id}`),
  getRequests: (filtres?: { status?: string; source_id?: number }) => {
    const p = new URLSearchParams()
    if (filtres?.status) p.append('status', filtres.status)
    if (filtres?.source_id) p.append('source_id', String(filtres.source_id))
    const requete = p.toString() ? `?${p.toString()}` : ''
    return api.get<{ success: boolean; data: IntakeRequest[] }>(`/manifestations/intake/requests${requete}`)
  },
}


// ======================== SERVICES ET APPROBATIONS ========================

export interface Service {
  id: number
  name: string
  slug: string
  email: string | null
  description: string | null
  is_observer: number
  /** Service qui pilote toutes les manifestations et prononce la validation finale. */
  is_coordinator: number
  is_active: number
  notify_new_request: number
  notify_status_change: number
  notify_material_change: number
  notify_message: number
  members_count?: number
  categories_count?: number
  categories?: Array<{ id: number; name: string }>
  members?: Array<{
    id: number
    email: string
    first_name: string
    last_name: string
    role: string
    is_manager: number
  }>
  is_manager?: number
}

export type StatutApprobation = 'pending' | 'approved' | 'rejected' | 'not_concerned'

export interface Approbation {
  id: number
  manifestation_id: number
  service_id: number | null
  service_name: string | null
  user_id: number | null
  user_name: string | null
  kind: 'approbation' | 'information'
  status: StatutApprobation
  requested_at: string
  decided_by: number | null
  decided_by_name: string | null
  decided_at: string | null
  comment: string | null
  delivery_date: string | null
  recovery_date: string | null
}

export interface MessageManifestation {
  id: number
  manifestation_id: number
  user_id: number | null
  author_name: string | null
  service_name: string | null
  body: string
  created_at: string
}

export interface Suiveur {
  id: number
  user_id: number | null
  user_name: string | null
  user_email: string | null
  service_id: number | null
  service_name: string | null
}

export const serviceApi = {
  getAll: () => api.get<{ success: boolean; data: Service[] }>('/services'),
  getMine: () => api.get<{ success: boolean; data: Service[] }>('/services/mine'),
  getById: (id: number) => api.get<{ success: boolean; data: Service }>(`/services/${id}`),
  create: (data: {
    name: string
    email?: string
    description?: string
    is_observer?: boolean
    is_coordinator?: boolean
  }) => api.post<{ success: boolean; data: Service }>('/services', data),
  update: (id: number, data: Partial<Service> & { name: string }) =>
    api.put<{ success: boolean; data: Service }>(`/services/${id}`, data),
  remove: (id: number) =>
    api.delete<{ success: boolean; desactive?: boolean; message?: string }>(`/services/${id}`),
  setCategories: (id: number, category_ids: number[]) =>
    api.put<{ success: boolean; data: Service }>(`/services/${id}/categories`, { category_ids }),
  addMember: (id: number, user_id: number, is_manager = false) =>
    api.post<{ success: boolean; data: Service }>(`/services/${id}/members`, { user_id, is_manager }),
  removeMember: (id: number, userId: number) =>
    api.delete<{ success: boolean; data: Service }>(`/services/${id}/members/${userId}`),
}

export const suiviApi = {
  getApprovals: (manifestationId: number) =>
    api.get<{ success: boolean; data: Approbation[] }>(`/manifestations/${manifestationId}/approvals`),
  requestApproval: (
    manifestationId: number,
    data: { service_id?: number; user_id?: number; kind?: 'approbation' | 'information'; comment?: string }
  ) => api.post<{ success: boolean; data: Approbation[] }>(`/manifestations/${manifestationId}/approvals`, data),
  decide: (
    manifestationId: number,
    approvalId: number,
    data: { status: StatutApprobation; comment?: string; delivery_date?: string; recovery_date?: string }
  ) =>
    api.put<{ success: boolean; data: Approbation[] }>(
      `/manifestations/${manifestationId}/approvals/${approvalId}`,
      data
    ),

  getMessages: (manifestationId: number) =>
    api.get<{ success: boolean; data: MessageManifestation[] }>(`/manifestations/${manifestationId}/messages`),
  postMessage: (manifestationId: number, body: string) =>
    api.post<{ success: boolean }>(`/manifestations/${manifestationId}/messages`, { body }),

  getWatchers: (manifestationId: number) =>
    api.get<{ success: boolean; data: Suiveur[] }>(`/manifestations/${manifestationId}/watchers`),
  addWatcher: (manifestationId: number, data: { user_id?: number; service_id?: number }) =>
    api.post<{ success: boolean }>(`/manifestations/${manifestationId}/watchers`, data),
  removeWatcher: (manifestationId: number, watcherId: number) =>
    api.delete<{ success: boolean }>(`/manifestations/${manifestationId}/watchers/${watcherId}`),
}


// ======================== EXPORT DES MANIFESTATIONS ========================

export interface ChampExportManifestation {
  champ: string
  libelle: string
  largeur: number
}

export interface ColonneProfil {
  champ: string
  entete?: string
}

export interface FiltresExportProfil {
  status?: string
  date_from?: string
  date_to?: string
  archived?: boolean
}

export interface ProfilExport {
  id: number
  name: string
  columns: ColonneProfil[]
  filters: FiltresExportProfil
  destination: 'download' | 'webdav'
  remote_path: string | null
  is_active: number
  auto_export: number
  last_export_at: string | null
  last_status: string | null
  last_error: string | null
}

export interface ConfigNextcloud {
  url: string
  username: string
  folder: string
  configured: boolean
}

export const exportManifestationApi = {
  getFields: () =>
    api.get<{ success: boolean; data: ChampExportManifestation[] }>('/manifestations/export/fields'),
  getProfiles: () =>
    api.get<{ success: boolean; data: ProfilExport[] }>('/manifestations/export/profiles'),
  createProfile: (data: Partial<ProfilExport> & { name: string }) =>
    api.post<{ success: boolean; data: { id: number } }>('/manifestations/export/profiles', data),
  updateProfile: (id: number, data: Partial<ProfilExport> & { name: string }) =>
    api.put<{ success: boolean }>(`/manifestations/export/profiles/${id}`, data),
  deleteProfile: (id: number) =>
    api.delete<{ success: boolean }>(`/manifestations/export/profiles/${id}`),
  /** Dépose sur Nextcloud, ou télécharge selon la destination du profil. */
  run: (id: number) =>
    api.post<{ success: boolean; data?: { chemin: string; lignes: number }; message?: string }>(
      `/manifestations/export/profiles/${id}/run`,
      {}
    ),
  /** URL de téléchargement direct, avec ou sans profil. */
  downloadUrl: (profileId?: number) =>
    `/manifestations/export${profileId ? `?profile=${profileId}` : ''}`,
}

/** Une ligne de l'explorateur : un fichier, ou un dossier où descendre. */
export interface EntreeNextcloud {
  nom: string
  /** Chemin relatif à la racine WebDAV, sans barre initiale. */
  chemin: string
  dossier: boolean
  taille?: number
  modifie?: string
  typeMime?: string
}

/**
 * Connexion au Nextcloud de la commune.
 *
 * Réglée sous `/manifestations/export` tant que seul le suivi s'y déposait ;
 * elle sert depuis aux modèles de document, et ne dépend plus d'un module.
 */
export const nextcloudApi = {
  getConfig: () => api.get<{ success: boolean; data: ConfigNextcloud }>('/nextcloud'),
  saveConfig: (data: { url: string; username: string; password?: string; folder?: string }) =>
    api.put<{ success: boolean; data: { url: string; folder: string } }>('/nextcloud', data),
  /** Dépose réellement un fichier témoin, puis le retire. */
  test: (data: { url?: string; username?: string; password?: string; folder?: string }) =>
    api.post<{ success: boolean; message: string; data?: { url: string } }>('/nextcloud/test', data),
  browse: (chemin: string) =>
    api.get<{ success: boolean; data: { chemin: string; entrees: EntreeNextcloud[] } }>(
      `/nextcloud/browse?path=${encodeURIComponent(chemin)}`
    ),
  /** Convertit un document témoin, et dit quel chemin bureautique a répondu. */
  testerPdf: () =>
    api.post<{ success: boolean; message: string; data?: { methode: string; octets: number } }>(
      '/nextcloud/test-pdf',
      {}
    ),
  /** Passe par l'instance axios : le jeton voyage en en-tête, pas dans l'URL. */
  downloadUrl: (chemin: string) => `/nextcloud/download?path=${encodeURIComponent(chemin)}`,
}


// ======================== MATÉRIEL UNIQUE DU PARC ========================

/** Ce qui retient un matériel du parc sur une période. */
export interface IndisponibiliteObjet {
  object_id: number
  object_name: string
  origine: 'manifestation' | 'reservation'
  detail: string
  debut: string
  fin: string
}

export interface ObjetParc {
  id: number
  name: string
  reference: string | null
  serial_number: string | null
  status: string
  category_id: number | null
  category_name: string | null
  disponible: boolean
  indisponibilites: IndisponibiliteObjet[]
  /** Une prestation n'immobilise rien : elle est toujours disponible. */
  is_prestation?: number | boolean
  /** Exemplaire identifié, lot avec quantité, ou prestation. */
  nature?: 'unique' | 'lot' | 'prestation'
  /** Renseignés pour un lot : ce qu'on détient, et ce qui reste sur la période. */
  quantity_total?: number
  disponible_previsionnel?: number
}

export type EtatRetour = 'intact' | 'abime' | 'perdu'

/** Matériel unique rattaché à une manifestation. */

/** Une ligne du décompte d'une manifestation. */
export interface LigneCout {
  libelle: string
  nature: 'prestation' | 'lot' | 'unique' | 'stock'
  quantite: number
  cout_unitaire: number
  total: number
  /** Ce qui fonde la ligne, en clair : un montant ne doit jamais être opaque. */
  motif: string
}

/**
 * Ce qu'une manifestation coûte.
 *
 * Deux natures, jamais confondues : ce qu'on **déploie** — des agents, un
 * raccordement — et ce qui ne **revient pas** — dix chaises prêtées, neuf
 * rendues. On ne négocie pas une casse comme on budgète une vacation.
 */
export interface CoutManifestation {
  prestations: LigneCout[]
  pertes: LigneCout[]
  total_prestations: number
  total_pertes: number
  total: number
  /** `false` tant que la manifestation n'est pas récupérée : le manque n'est pas encore une perte. */
  definitif: boolean
  en_attente_de_retour: LigneCout[]
}

export interface ObjetManifestation {
  id: number
  manifestation_id: number
  object_id: number
  object_name: string
  reference: string | null
  serial_number: string | null
  category_name: string | null
  /** Toujours 1 pour un exemplaire ; le nombre demandé pour une prestation. */
  quantity: number
  quantity_delivered: number
  quantity_returned: number
  return_state: EtatRetour | null
  notes: string | null
  /**
   * Une prestation tenue dans le parc — raccordement électrique, personnel.
   * Elle n'immobilise rien et ne se constate pas au retour : elle est demandée,
   * puis réalisée.
   */
  is_prestation?: number | boolean
  /** Exemplaire identifié, lot avec quantité, ou prestation. */
  nature?: 'unique' | 'lot' | 'prestation'
  /** Quantité détenue au parc, pour un lot. */
  quantity_total?: number
}

export const objetManifestationApi = {
  /** Parc consultable sur une période, chaque ligne disant ce qui la retient. */
  rechercher: (params: { q?: string; date_from?: string; date_to?: string; exclude?: number }) => {
    const p = new URLSearchParams()
    if (params.q) p.append('q', params.q)
    if (params.date_from) p.append('date_from', params.date_from)
    if (params.date_to) p.append('date_to', params.date_to)
    if (params.exclude) p.append('exclude', String(params.exclude))
    return api.get<{ success: boolean; data: ObjetParc[] }>(
      `/manifestations/objects/search?${p.toString()}`
    )
  },
  lister: (manifestationId: number) =>
    api.get<{ success: boolean; data: ObjetManifestation[] }>(`/manifestations/${manifestationId}/objects`),
  remplacer: (manifestationId: number, objects: Array<{ object_id: number; notes?: string | null }>) =>
    api.put<{ success: boolean; data: ObjetManifestation[]; conflits: IndisponibiliteObjet[] }>(
      `/manifestations/${manifestationId}/objects`,
      { objects }
    ),
  suivre: (
    manifestationId: number,
    itemId: number,
    data: {
      /** Un exemplaire se coche… */
      delivered?: boolean
      returned?: boolean
      /** …un lot se compte. Le nombre l'emporte sur la case. */
      delivered_quantity?: number
      returned_quantity?: number
      /** Vide efface le constat : on s'est trompé de ligne. */
      return_state?: EtatRetour | ''
      notes?: string
    }
  ) =>
    api.put<{ success: boolean; data: ObjetManifestation[] }>(
      `/manifestations/${manifestationId}/objects/${itemId}`,
      data
    ),
}

// ======================== NOTIFICATIONS ========================

export interface EvenementNotification {
  evenement: string
  libelle: string
  description: string
  /** Engage son destinataire : ne peut pas être coupé individuellement. */
  engageant: boolean
  rolesParDefaut: string[]
  servicesParDefaut: boolean
}

export interface PreferenceNotification extends EvenementNotification {
  /** `null` quand aucun choix explicite n'a été fait : le défaut s'applique. */
  choix: boolean | null
  actif: boolean
}

export interface ReglageEvenement {
  roles: string[]
  services: boolean
}

export const notificationApi = {
  getEvents: () =>
    api.get<{
      success: boolean
      data: { events: EvenementNotification[]; roles: Array<{ role: string; label: string }> }
    }>('/notifications/events'),
  getDefaults: () =>
    api.get<{ success: boolean; data: Record<string, ReglageEvenement> }>('/notifications/defaults'),
  saveDefaults: (defaults: Record<string, ReglageEvenement>) =>
    api.put<{ success: boolean; data: Record<string, ReglageEvenement> }>('/notifications/defaults', {
      defaults,
    }),
  getPreferences: () =>
    api.get<{ success: boolean; data: PreferenceNotification[] }>('/notifications/preferences'),
  savePreference: (event: string, enabled: boolean) =>
    api.put<{ success: boolean }>('/notifications/preferences', { event, enabled }),
}


// ======================== DÉLÉGATIONS ET FIN DE VIE DES COMPTES ========================

export interface Delegation {
  id: number
  service_id: number
  delegate_user_id: number
  delegate_name: string
  delegate_email: string
  granted_by_name: string | null
  start_date: string | null
  end_date: string | null
  created_at: string
}

export const delegationApi = {
  lister: (serviceId: number) =>
    api.get<{ success: boolean; data: Delegation[] }>(`/services/${serviceId}/delegations`),
  accorder: (
    serviceId: number,
    data: { delegate_user_id: number; start_date?: string; end_date?: string }
  ) => api.post<{ success: boolean; data: Delegation[] }>(`/services/${serviceId}/delegations`, data),
  revoquer: (serviceId: number, delegationId: number) =>
    api.delete<{ success: boolean; data: Delegation[] }>(
      `/services/${serviceId}/delegations/${delegationId}`
    ),
  /** Désigner ou retirer le responsable d'un service. */
  definirResponsable: (serviceId: number, userId: number, is_manager: boolean) =>
    api.put<{ success: boolean; data: Service }>(`/services/${serviceId}/members/${userId}`, {
      is_manager,
    }),
}

/** Ce qu'un compte laisserait derrière lui s'il était supprimé. */
export interface TracesCompte {
  manifestations_creees: number
  historique: number
  decisions: number
  messages: number
  services: number
  /** Clés et trousseaux remis à son nom, rendus ou non. */
  cles: number
  reservations: number
  total: number
}

export const compteApi = {
  getTraces: (userId: number) =>
    api.get<{ success: boolean; data: { traces: TracesCompte; anonymized_at: string | null } }>(
      `/users/${userId}/traces`
    ),
  /** Retire l'identité, conserve les liens. Irréversible. */
  anonymiser: (userId: number) =>
    api.post<{ success: boolean; message: string }>(`/users/${userId}/anonymize`, {}),
}

// ======================== MATÉRIEL PRÊTABLE ========================

/** Trois états : 1 prêtable, 0 exclu, null hérite du niveau au-dessus. */
export type Disponibilite = 1 | 0 | null

export interface SousCategoriePretable {
  id: number
  category_id: number
  name: string
  available_for_manifestations: Disponibilite
  objets: number
}

export interface CategoriePretable {
  id: number
  name: string
  /** Une catégorie ne peut pas hériter : c'est elle la valeur de référence. */
  available_for_manifestations: 1 | 0
  objets_directs: number
  subcategories: SousCategoriePretable[]
}

export interface ObjetPretable {
  id: number
  name: string
  reference: string | null
  serial_number: string | null
  subcategory_id: number | null
  subcategory_name: string | null
  /** Le choix fait sur ce matériel : `null` = il hérite. */
  available_for_manifestations: Disponibilite
  /** Ce qui s'applique réellement, une fois la résolution faite. */
  pretable: number
}

/** Un matériel trouvé par la recherche, avec la branche où le ranger. */
export interface ObjetPretableTrouve extends ObjetPretable {
  /** `null` pour un matériel qui n'est rattaché à aucune catégorie. */
  category_id: number | null
  category_name: string | null
}

export const materielPretableApi = {
  getTree: () =>
    api.get<{ success: boolean; data: CategoriePretable[] }>('/manifestations/availability/tree'),
  getObjects: (categoryId: number) =>
    api.get<{ success: boolean; data: ObjetPretable[] }>(
      `/manifestations/availability/objects?category_id=${categoryId}`
    ),
  rechercher: (terme: string) =>
    api.get<{ success: boolean; data: ObjetPretableTrouve[] }>(
      `/manifestations/availability/search?q=${encodeURIComponent(terme)}`
    ),
  regler: (niveau: 'category' | 'subcategory' | 'object', id: number, available: Disponibilite) =>
    api.put<{ success: boolean }>(`/manifestations/availability/${niveau}/${id}`, { available }),
}

/**
 * Quel matériel du parc peut être implanté dans un espace vert.
 *
 * Même règle et mêmes formes que le prêt, sur une autre colonne : le gazon et
 * l'enrobé se posent, les barrières Vauban et les radars pédagogiques non. Les
 * lignes portent `available_for_green_spaces` (le choix fait à ce niveau) et
 * `implantable` (ce qui s'applique une fois la résolution faite).
 */
export const materielImplantableApi = {
  getTree: () =>
    api.get<{ success: boolean; data: CategorieReglee[] }>('/green-spaces/materiel-implantable/tree'),
  getObjects: (categoryId: number) =>
    api.get<{ success: boolean; data: ObjetRegle[] }>(
      `/green-spaces/materiel-implantable/objects?category_id=${categoryId}`
    ),
  rechercher: (terme: string) =>
    api.get<{ success: boolean; data: ObjetRegleTrouve[] }>(
      `/green-spaces/materiel-implantable/search?q=${encodeURIComponent(terme)}`
    ),
  regler: (niveau: 'category' | 'subcategory' | 'object', id: number, available: Disponibilite) =>
    api.put<{ success: boolean }>(`/green-spaces/materiel-implantable/${niveau}/${id}`, { available }),
}

/**
 * Les mêmes lignes, vues sans savoir de quel module il s'agit.
 *
 * L'écran de réglage est le même pour le prêt et pour l'implantation ; seule la
 * colonne change de nom. Ces types-ci le disent : le réglage et le résultat
 * effectif se lisent par leur clé, que l'appelant fournit.
 */
export interface SousCategorieReglee {
  id: number
  category_id: number
  name: string
  objets: number
  [colonne: string]: any
}

export interface CategorieReglee {
  id: number
  name: string
  objets_directs: number
  subcategories: SousCategorieReglee[]
  [colonne: string]: any
}

export interface ObjetRegle {
  id: number
  name: string
  reference: string | null
  serial_number: string | null
  subcategory_id: number | null
  subcategory_name: string | null
  [colonne: string]: any
}

export interface ObjetRegleTrouve extends ObjetRegle {
  /** `null` pour un matériel qui n'est rattaché à aucune catégorie. */
  category_id: number | null
  category_name: string | null
}

/** Les quatre appels d'un écran de réglage, quel que soit le module. */
export interface ApiReglageParc {
  getTree(): Promise<{ data: { data: CategorieReglee[] } }>
  getObjects(categoryId: number): Promise<{ data: { data: ObjetRegle[] } }>
  rechercher(terme: string): Promise<{ data: { data: ObjetRegleTrouve[] } }>
  regler(
    niveau: 'category' | 'subcategory' | 'object',
    id: number,
    available: Disponibilite
  ): Promise<unknown>
}

// ======================== PIÈCES JOINTES ========================

export interface TypeDocument {
  id: number
  value: string
  label: string
  is_default: number
  disabled: number
}

export interface DocumentManifestation {
  id: number
  manifestation_id: number
  name: string
  doc_type: string
  doc_type_label: string | null
  description: string | null
  file_path: string
  mime_type: string | null
  size: number | null
  /** Article concerné, facultatif. Porté par l'article et non par la ligne. */
  stock_id: number | null
  stock_name: string | null
  object_id: number | null
  object_name: string | null
  /** Service auquel cette pièce est destinée, quand elle a été produite pour lui. */
  service_id: number | null
  service_name: string | null
  /** Produite par l'application à partir du modèle du service. */
  generated_from_template: number | boolean
  uploaded_by_name: string | null
  created_at: string
}

export interface DocumentAJoindre {
  name: string
  doc_type?: string
  description?: string
  file_path: string
  mime_type?: string
  size?: number
  stock_id?: number | null
  object_id?: number | null
}

/** Enregistre une réponse binaire sous le nom de fichier voulu. */
function enregistrerFichier(donnees: BlobPart, nomFichier: string) {
  const url = window.URL.createObjectURL(new Blob([donnees]))
  const lien = document.createElement('a')
  lien.href = url
  lien.setAttribute('download', nomFichier)
  document.body.appendChild(lien)
  lien.click()
  lien.remove()
  window.URL.revokeObjectURL(url)
}

/**
 * Phrase d'erreur d'une réponse demandée en binaire.
 *
 * Quand le serveur refuse un téléchargement, axios rend quand même un `Blob` :
 * lire `data.message` y donne `undefined`, et l'écran affiche « erreur inconnue »
 * là où le serveur disait précisément quoi corriger — qu'aucune application ne
 * sache convertir, par exemple.
 */
async function messageDuBlob(erreur: any, defaut: string): Promise<string> {
  const donnees = erreur?.response?.data

  if (donnees instanceof Blob) {
    try {
      const json = JSON.parse(await donnees.text())
      if (json?.message) return String(json.message)
    } catch {
      /* le corps n'était pas du JSON */
    }
  }

  return donnees?.message ?? erreur?.message ?? defaut
}

export const documentManifestationApi = {
  /** `q` filtre sur le libellé et la description. */
  lister: (manifestationId: number, q?: string) =>
    api.get<{ success: boolean; data: DocumentManifestation[] }>(
      `/manifestations/${manifestationId}/documents${q ? `?q=${encodeURIComponent(q)}` : ''}`
    ),
  joindre: (manifestationId: number, data: DocumentAJoindre) =>
    api.post<{ success: boolean; data: DocumentManifestation[] }>(
      `/manifestations/${manifestationId}/documents`,
      data
    ),
  modifier: (docId: number, data: Partial<DocumentAJoindre>) =>
    api.put<{ success: boolean; data: DocumentManifestation[] }>(
      `/manifestations/documents/${docId}`,
      data
    ),
  retirer: (docId: number) =>
    api.delete<{ success: boolean; data: DocumentManifestation[] }>(
      `/manifestations/documents/${docId}`
    ),

  /**
   * Refait les documents pré-remplis des services concernés.
   *
   * La production est automatique à la réception et à chaque changement de
   * matériel : ce geste sert au modèle corrigé après coup, et au Nextcloud qui
   * était injoignable quand la demande est arrivée.
   */
  regenerer: (manifestationId: number) =>
    api.post<{
      success: boolean
      message: string
      data: {
        resultats: Array<{
          service_id: number
          service_name: string
          success: boolean
          error?: string
        }>
        documents: DocumentManifestation[]
      }
    }>(`/manifestations/${manifestationId}/documents/generate`, {}),

  /**
   * Convertit une pièce `.docx` en PDF, sans l'ajouter à la manifestation.
   *
   * Le format est réglé sur le modèle du service ; ce geste sert au document
   * qu'on fait signer aujourd'hui, sans changer le réglage ni tout regénérer —
   * ce qui écraserait les retouches déjà faites.
   */
  telechargerPdf: async (docId: number, nom: string) => {
    try {
      const reponse = await api.post(
        `/manifestations/documents/${docId}/pdf`,
        {},
        { responseType: 'blob' }
      )
      enregistrerFichier(reponse.data, `${nom || 'document'}.pdf`)
    } catch (erreur: any) {
      throw new Error(await messageDuBlob(erreur, "La conversion en PDF n'a pas abouti"))
    }
  },


  getTypes: (tous = false) =>
    api.get<{ success: boolean; data: TypeDocument[] }>(
      `/manifestations/doc-types${tous ? '?tous=true' : ''}`
    ),
  creerType: (label: string) =>
    api.post<{ success: boolean; data: TypeDocument[] }>('/manifestations/doc-types', { label }),
  modifierType: (id: number, data: { label: string; disabled?: boolean }) =>
    api.put<{ success: boolean; data: TypeDocument[] }>(`/manifestations/doc-types/${id}`, data),
  supprimerType: (id: number) =>
    api.delete<{ success: boolean; data: TypeDocument[] }>(`/manifestations/doc-types/${id}`),
}

// ======================== MODÈLES DE DOCUMENT PAR SERVICE ========================
//
// Une demande reçue par formulaire concerne plusieurs services, mais chacun n'a
// besoin que de sa part. Le modèle est un `.docx` ordinaire, écrit dans Word,
// où les valeurs à remplir s'écrivent entre accolades.

export interface ValeurModele {
  cle: string
  libelle: string
  exemple: string
  /** Section d'origine, pour proposer les valeurs par groupes. */
  section?: string
  /** Une liste se répète dans le modèle : `{#materiels}…{/materiels}`. */
  liste?: boolean
}

/**
 * Ce qu'un modèle rend : le document à retoucher, celui à faire signer, ou les
 * deux. Le PDF demande une conversion par le Nextcloud de la commune.
 */
export type FormatModele = 'docx' | 'pdf' | 'docx+pdf'

export interface ModeleService {
  id: number
  service_id: number
  name: string
  source: 'upload' | 'nextcloud'
  file_path: string | null
  remote_path: string | null
  detected_fields: string[]
  field_mapping: Record<string, string>
  is_active: boolean
  output_format: FormatModele
  last_error: string | null
  updated_at: string
}

export const modeleServiceApi = {
  /** Valeurs offertes au réglage, catalogue tenu côté serveur. */
  getValeurs: () =>
    api.get<{ success: boolean; data: ValeurModele[] }>('/services/template-values'),

  get: (serviceId: number) =>
    api.get<{ success: boolean; data: { modele: ModeleService | null; valeurs: ValeurModele[] } }>(
      `/services/${serviceId}/template`
    ),

  /** Rattache un modèle, téléversé ou tenu dans Nextcloud. */
  rattacher: (
    serviceId: number,
    data: {
      name: string
      source: 'upload' | 'nextcloud'
      file_path?: string
      remote_path?: string
      output_format?: FormatModele
    }
  ) => api.post<{ success: boolean; data: ModeleService }>(`/services/${serviceId}/template`, data),

  enregistrer: (
    serviceId: number,
    data: {
      name?: string
      field_mapping?: Record<string, string>
      is_active?: boolean
      output_format?: FormatModele
    }
  ) => api.put<{ success: boolean; data: ModeleService }>(`/services/${serviceId}/template`, data),

  /** Relit les champs : utile après avoir corrigé le modèle dans Nextcloud. */
  redetecter: (serviceId: number) =>
    api.post<{ success: boolean; data: ModeleService }>(`/services/${serviceId}/template/detect`, {}),

  retirer: (serviceId: number) =>
    api.delete<{ success: boolean }>(`/services/${serviceId}/template`),

  /** Modèles `.docx` rangés dans un dossier Nextcloud. */
  listerNextcloud: (chemin?: string) =>
    api.get<{
      success: boolean
      data: { dossier: string; fichiers: Array<{ nom: string; chemin: string }> }
    }>(`/services/nextcloud-templates${chemin ? `?path=${encodeURIComponent(chemin)}` : ''}`),

  /**
   * Télécharge un aperçu rempli.
   *
   * Sans manifestation, un jeu d'exemple sert de démonstration : on vérifie son
   * modèle avant qu'une vraie demande arrive, seul moment où la correction est
   * encore sans conséquence.
   */
  apercu: async (
    serviceId: number,
    nom: string,
    manifestationId?: number,
    format?: FormatModele
  ) => {
    const corps: Record<string, unknown> = {}
    if (manifestationId) corps.manifestation_id = manifestationId
    if (format) corps.format = format

    try {
      const reponse = await api.post(`/services/${serviceId}/template/preview`, corps, {
        responseType: 'blob',
      })
      // Le PDF demande une conversion par le Nextcloud : l'extension doit suivre
      // ce qui a été demandé, sinon le fichier s'ouvre sur une erreur.
      const extension = format === 'pdf' || format === 'docx+pdf' ? 'pdf' : 'docx'
      enregistrerFichier(reponse.data, `${nom || 'apercu'}.${extension}`)
    } catch (erreur: any) {
      throw new Error(await messageDuBlob(erreur, "L'aperçu n'a pas pu être produit"))
    }
  },
}

/** Compte rendu d'un essai de réception, qui ne crée jamais rien. */
export interface EssaiIntake {
  source: { id: number; name: string; slug: string } | null
  origine_correspondance: 'imposee' | 'detectee'
  correspondance: CorrespondanceIntake
  chemins: string[]
  champs_disponibles: ChampIntake[]
  extrait: Record<string, unknown>
  manquants: Array<{ cle: string; libelle: string }>
  recevable: boolean
  materiels: {
    apparies: Array<{
      libelle: string
      quantite: number
      stock_id: number
      stock_name: string
      is_prestation: boolean
    }>
    non_apparies: Array<{ libelle: string; quantite: number }>
  }
  services: Array<{
    id: number
    name: string
    email: string | null
    is_coordinator: boolean
    modele: { name: string; source: string; champs: number; last_error: string | null } | null
  }>
  valeurs_modele: ValeurModele[]
}

export const essaiIntakeApi = {
  /** Champs qu'une demande peut porter, sans avoir créé la moindre source. */
  getChamps: () =>
    api.get<{ success: boolean; data: ChampIntake[] }>('/manifestations/intake/champs'),

  /** Essaie une charge utile **à blanc** : rien n'est créé, personne n'est prévenu. */
  essayer: (payload: unknown, sourceId?: number) =>
    api.post<{ success: boolean; data: EssaiIntake }>('/manifestations/intake/sources/test', {
      payload,
      source_id: sourceId,
    }),
}

// ======================== IMPLANTATIONS ========================

/**
 * Une implantation, d'où qu'elle vienne.
 *
 * Un banc scellé sur un trottoir et un banc posé dans un parc sont le même
 * banc : ils se cherchent avec les mêmes mots et s'entretiennent de la même
 * façon. La carte, la liste et l'export les lisent donc sous cette forme
 * unique, que le serveur compose depuis `street_furniture` et
 * `green_space_elements`.
 *
 * `source` dit d'où vient la ligne — c'est ce qui décide où l'on va quand on
 * l'ouvre : la fiche de la carte pour la voirie, celle de l'espace vert pour
 * un parc.
 */
export interface Implantation {
  /** Clé unique tous gisements confondus : `voirie-12`, `espace_vert-45`. */
  cle: string
  source: 'voirie' | 'espace_vert'
  id: number
  object_id: number | null
  /** Le rang dans son modèle. Nul côté espaces verts, qui ne numérote pas. */
  numero: number | null
  label: string
  code: string
  quantity: number
  latitude: number | null
  longitude: number | null
  /** À quel point on sait où c'est : la carte ne doit pas faire passer une
   *  position de repli pour un relevé. */
  precision_position: 'exacte' | 'plan' | 'espace' | 'inconnue'
  address: string
  street: string
  sector: string
  /** « Voie publique », ou le nom du parc. */
  lieu: string
  green_space_id: number | null
  /** Le contenant : une jardinière de trottoir, un massif d'espace vert. */
  contenant: string
  status: string
  condition_state: string
  installed_on: string | null
  last_intervention_date: string | null
  next_intervention_date: string | null
  notes: string
  image: string
  object_name: string | null
  object_reference: string | null
  category_id: number | null
  category_name: string | null
  subcategory_id: number | null
  subcategory_name: string | null
  /** Rendu par le seul filtre « autour de moi ». */
  distance_m?: number
  /** Rendu par le détail et par l'export qui les demande. */
  interventions?: InterventionMobilier[]
}

// ======================== MOBILIER DE VOIE PUBLIQUE ========================

/**
 * Un exemplaire posé sur la voie publique.
 *
 * Le modèle voyage avec lui — `object_name`, `category_name` — parce que la
 * carte affiche des points et non des jointures : sans ces colonnes, mille
 * marqueurs seraient anonymes ou demanderaient mille requêtes.
 */
export interface MobilierUrbain {
  id: number
  object_id: number
  /** Le rang de cet exemplaire dans son modèle : le « 23 » de « Banc 23 ». */
  numero: number
  label: string
  /** Le numéro d'inventaire de la commune, gravé sur le mobilier. Souvent vide. */
  code: string
  /** Le contenant : une jardinière porte ses plantations. */
  parent_id: number | null
  quantity: number
  latitude: number
  longitude: number
  position_source: string
  position_accuracy: number | null
  address: string
  street: string
  sector: string
  status: string
  condition_state: string
  installed_on: string | null
  last_intervention_date: string | null
  next_intervention_date: string | null
  notes: string
  image: string
  custom_fields: string
  created_at: string
  updated_at: string
  object_name: string | null
  object_reference: string | null
  object_image: string | null
  category_id: number | null
  category_name: string | null
  subcategory_id: number | null
  subcategory_name: string | null
  /** Rendu par le seul filtre « autour de moi ». */
  distance_m?: number
  /** Rendu par le détail, et par l'export qui la demande. */
  interventions?: InterventionMobilier[]
  /** Ce que porte ce mobilier : les plantations d'une jardinière. */
  contenu?: MobilierUrbain[]
}

/**
 * Un entretien, rapporté à l'implantation qui l'a reçu.
 *
 * Les deux gisements y sont mêlés : une reprise de peinture sur un banc de
 * trottoir et une sur un banc du square racontent la même campagne, et les
 * séparer obligerait à les recoller de tête.
 */
export interface EntretienImplantation {
  id: number
  intervention_type: string
  performed_on: string | null
  next_date: string | null
  description: string
  cost: number | null
  performed_by: string
  auteur?: string | null
  implantation_cle: string
  implantation_label: string
  implantation_source: 'voirie' | 'espace_vert'
  implantation_lieu: string
  implantation_street: string
  green_space_id: number | null
  object_id: number | null
}

export interface InterventionMobilier {
  id: number
  item_id: number
  intervention_type: string
  performed_on: string | null
  next_date: string | null
  description: string
  cost: number | null
  performed_by: string
  user_id: number | null
  auteur: string | null
  created_at: string
}

/** Un modèle du parc qu'on peut poser, et ce qui l'a déjà été. */
export interface ModelePosable {
  id: number
  name: string
  reference: string | null
  image: string | null
  unit_cost: number | null
  purchase_price: number | null
  material_type: string
  category_id: number | null
  category_name: string | null
  subcategory_id: number | null
  subcategory_name: string | null
  /** Exemplaires déjà posés sur la voie publique : le prochain prend ce numéro plus un. */
  poses: number
  /** Exemplaires du même modèle déjà implantés dans un espace vert. */
  implantations: number
}

/** Ce qu'une recherche peut demander. Tout est facultatif, et tout se combine. */
export interface FiltresMobilier {
  /*
    L'index libre n'est pas une facilité : ces filtres partent tels quels dans
    une chaîne de requête, et c'est lui qui autorise à les parcourir sans
    réécrire la liste des clés à chaque ajout d'un critère.
  */
  [critere: string]: string | undefined
  q?: string
  /** `voirie`, `espace_vert`, ou vide pour les deux — le défaut. */
  source?: string
  green_space_id?: string
  category_id?: string
  subcategory_id?: string
  object_id?: string
  status?: string
  condition_state?: string
  street?: string
  sector?: string
  bbox?: string
  pose_du?: string
  pose_au?: string
  en_retard?: string
  echeance_avant?: string
  jamais_entretenu?: string
  avec_deposes?: string
  /** « Autour de moi » : centre et rayon en mètres. */
  lat?: string
  lng?: string
  rayon?: string
  limit?: string
}

/** Les valeurs déjà saisies, pour que les filtres proposent au lieu de deviner. */
export interface FacettesMobilier {
  rues: Array<{ valeur: string; cnt: number }>
  secteurs: Array<{ valeur: string; cnt: number }>
  modeles: Array<{ id: number; nom: string; reference: string | null; cnt: number }>
  categories: Array<{ id: number; nom: string; cnt: number }>
  /** Les parcs qui portent au moins une implantation. */
  espaces_verts: Array<{ id: number; nom: string; cnt: number }>
}

export interface StatsMobilier {
  total: number
  voirie: number
  espaces_verts: number
  modeles: number
  rues: number
  a_revoir: number
  en_retard: number
  /** Ce que la carte ne peut pas montrer : mieux vaut l'annoncer que le taire. */
  sans_position: number
}

/** Un fond de carte publié par le serveur, jamais recopié côté client. */
export interface FondCarto {
  cle: string
  libelle: string
  court: string
  description: string
  modele: string
  attribution: string
  zoomMax: number
}

/** Les filtres, tels qu'une chaîne de requête les attend. */
const enParametres = (filtres: Record<string, unknown>): string => {
  const params = new URLSearchParams()
  for (const [clef, valeur] of Object.entries(filtres)) {
    if (valeur === undefined || valeur === null || valeur === '') continue
    params.set(clef, String(valeur))
  }
  const chaine = params.toString()
  return chaine ? `?${chaine}` : ''
}

export const mobilierUrbainApi = {
  lister: (filtres: FiltresMobilier = {}) =>
    api.get<{ success: boolean; data: Implantation[]; total: number }>(
      `/mobilier-urbain${enParametres(filtres)}`
    ),

  /** Les mêmes lignes, avec l'historique quand le document en a besoin. */
  exporter: (filtres: FiltresMobilier & { avec_interventions?: string } = {}) =>
    api.get<{ success: boolean; data: Implantation[]; total: number }>(
      `/mobilier-urbain/export${enParametres(filtres)}`
    ),

  detail: (id: number) =>
    api.get<{ success: boolean; data: MobilierUrbain }>(`/mobilier-urbain/${id}`),

  /**
   * Toutes les implantations d'un modèle : « où sont mes vingt-trois bancs ? ».
   *
   * Les deux gisements confondus — trois d'entre eux sont peut-être dans le
   * parc municipal, et c'est exactement ce qu'on ne veut pas aller chercher
   * ailleurs.
   */
  parModele: (objectId: number) =>
    api.get<{ success: boolean; data: Implantation[]; total: number }>(
      `/mobilier-urbain/objets/${objectId}`
    ),

  /**
   * Tout ce qui a été fait sur les exemplaires d'un modèle, remis dans l'ordre.
   *
   * « Quels bancs ont été repeints cette année ? » — une question qui ne se lit
   * ni dans l'onglet Entretiens du parc, qui parle du matériel comme d'un bien
   * unique, ni exemplaire par exemplaire, ce qui demanderait d'ouvrir
   * vingt-trois fiches.
   */
  entretiensDuModele: (objectId: number) =>
    api.get<{ success: boolean; data: EntretienImplantation[]; total: number }>(
      `/mobilier-urbain/objets/${objectId}/entretiens`
    ),

  /** Un élément d'espace vert, vu depuis la carte : en lecture, sauf l'entretien. */
  detailElement: (elementId: number) =>
    api.get<{ success: boolean; data: Implantation }>(`/mobilier-urbain/element/${elementId}`),

  /**
   * Consigner un entretien sur un élément d'espace vert, depuis la carte.
   *
   * La seule écriture que la cartographie s'autorise sur un parc, et c'est le
   * geste de terrain : noter devant le banc du square qu'il vient d'être
   * repeint. L'entretien est rangé là où le module des espaces verts le range,
   * et apparaît donc aussi dans l'onglet Entretien du parc.
   */
  ajouterEntretienElement: (elementId: number, corps: Record<string, unknown>) =>
    api.post<{ success: boolean; data: unknown }>(
      `/mobilier-urbain/element/${elementId}/interventions`,
      corps
    ),

  /**
   * Les natures d'entretien que la commune a configurées pour ses espaces verts.
   *
   * Celles du module des espaces verts, et non les onze du mobilier de voirie :
   * l'entretien part dans leur table, et y inscrire un type qu'ils ne
   * connaissent pas casserait leurs propres libellés et leurs filtres.
   */
  typesEntretienEspaceVert: () =>
    api.get<{
      success: boolean
      data: Array<{ id: number; value: string; label: string; icon: string; disabled: number }>
    }>('/green-spaces/custom-maintenance-types'),

  catalogue: (q?: string) =>
    api.get<{ success: boolean; data: ModelePosable[] }>(
      `/mobilier-urbain/catalogue${q ? `?q=${encodeURIComponent(q)}` : ''}`
    ),

  facettes: () =>
    api.get<{ success: boolean; data: FacettesMobilier }>('/mobilier-urbain/facettes'),

  stats: () => api.get<{ success: boolean; data: StatsMobilier }>('/mobilier-urbain/stats'),

  fonds: () => api.get<{ success: boolean; data: FondCarto[] }>('/mobilier-urbain/fonds'),

  poser: (corps: Record<string, unknown>) =>
    api.post<{ success: boolean; data: MobilierUrbain }>('/mobilier-urbain', corps),

  modifier: (id: number, corps: Record<string, unknown>) =>
    api.put<{ success: boolean; data: MobilierUrbain }>(`/mobilier-urbain/${id}`, corps),

  supprimer: (id: number) => api.delete<{ success: boolean }>(`/mobilier-urbain/${id}`),

  ajouterIntervention: (id: number, corps: Record<string, unknown>) =>
    api.post<{
      success: boolean
      data: { intervention: InterventionMobilier; mobilier: MobilierUrbain }
    }>(`/mobilier-urbain/${id}/interventions`, corps),

  modifierIntervention: (interventionId: number, corps: Record<string, unknown>) =>
    api.put<{ success: boolean; data: MobilierUrbain }>(
      `/mobilier-urbain/interventions/${interventionId}`,
      corps
    ),

  supprimerIntervention: (interventionId: number) =>
    api.delete<{ success: boolean; data: MobilierUrbain }>(
      `/mobilier-urbain/interventions/${interventionId}`
    ),
}

/**
 * Quel matériel du parc peut être posé sur la voie publique.
 *
 * Même règle et mêmes formes que le prêt et l'implantation, sur une troisième
 * colonne : les candélabres et les corbeilles se posent, les barrières Vauban
 * des manifestations et les prestations non. Les lignes portent
 * `available_for_public_space` (le choix fait à ce niveau) et `posable` (ce qui
 * s'applique une fois la résolution faite).
 */
export const materielVoiePubliqueApi = {
  getTree: () =>
    api.get<{ success: boolean; data: CategorieReglee[] }>(
      '/mobilier-urbain/materiel-voie-publique/tree'
    ),
  getObjects: (categoryId: number) =>
    api.get<{ success: boolean; data: ObjetRegle[] }>(
      `/mobilier-urbain/materiel-voie-publique/objects?category_id=${categoryId}`
    ),
  rechercher: (terme: string) =>
    api.get<{ success: boolean; data: ObjetRegleTrouve[] }>(
      `/mobilier-urbain/materiel-voie-publique/search?q=${encodeURIComponent(terme)}`
    ),
  regler: (niveau: 'category' | 'subcategory' | 'object', id: number, available: Disponibilite) =>
    api.put<{ success: boolean }>(`/mobilier-urbain/materiel-voie-publique/${niveau}/${id}`, {
      available,
    }),
}

// ======================== AGENDAS EXTERNES ========================

/**
 * Un carnet d'agenda branché sur l'application.
 *
 * Il y en a autant que la commune en a besoin — le carnet du service technique,
 * celui des espaces verts, celui du régisseur des salles —, et chacun ne reçoit
 * que ce qu'on lui désigne. Sans cet aiguillage, brancher un CalDAV y déversait
 * les entretiens de véhicules, les contrôles techniques et les tontes de
 * pelouse dans le même flux, et la seule réaction possible était de couper.
 */
export interface AgendaExterne {
  id: number
  name: string
  kind: 'caldav' | 'outlook'
  server_url: string
  username: string
  /** Rendu en pastilles : le renvoyer tel quel conserve le secret enregistré. */
  password: string
  calendar_path: string
  client_id: string
  client_secret: string
  tenant_id: string
  direction: 'import' | 'export' | 'deux_sens'
  /** Vide = toutes les natures. */
  natures: string[]
  /** Vide = toutes les catégories. */
  category_ids: number[]
  include_uncategorized: boolean
  color: string
  enabled: boolean
  last_sync: string | null
  last_error: string | null
}

export interface NatureAgenda {
  valeur: string
  libelle: string
  description: string
}

/** Ce que l'export enverrait, avant de l'envoyer. */
export interface ApercuAgenda {
  total: number
  parNature: Array<{ nature: string; libelle: string; cnt: number }>
  exemples: Array<{ title: string; start_date: string; nature: string }>
}

export const agendaExterneApi = {
  lister: () => api.get<{ success: boolean; data: AgendaExterne[] }>('/calendar/agendas'),

  vocabulaire: () =>
    api.get<{
      success: boolean
      data: { natures: NatureAgenda[]; directions: NatureAgenda[] }
    }>('/calendar/agendas/vocabulaire'),

  creer: (corps: Partial<AgendaExterne>) =>
    api.post<{ success: boolean; data: AgendaExterne }>('/calendar/agendas', corps),

  modifier: (id: number, corps: Partial<AgendaExterne>) =>
    api.put<{ success: boolean; data: AgendaExterne }>(`/calendar/agendas/${id}`, corps),

  supprimer: (id: number) => api.delete<{ success: boolean }>(`/calendar/agendas/${id}`),

  tester: (id: number) =>
    api.post<{ success: boolean; message: string }>(`/calendar/agendas/${id}/test`),

  /** Combien d'événements partiraient, et lesquels — sans rien envoyer. */
  apercu: (id: number) =>
    api.get<{ success: boolean; data: ApercuAgenda }>(`/calendar/agendas/${id}/apercu`),

  synchroniser: (id: number) =>
    api.post<{
      success: boolean
      data: { importes: number; envoyes: number; retires: number; erreur: string | null }
    }>(`/calendar/agendas/${id}/sync`),
}

// --- API Plannings et heures ---

export type MesureTemps = 'mobilise' | 'personne'
export type GranularitePlanning = 'jour' | 'semaine' | 'mois' | 'annee'

export interface CategorieTemps {
  id: number
  nom: string
  couleur: string
  active: boolean
}

export interface RenfortTache {
  id: number
  personne: { id: number; nom: string } | null
  libelle: string | null
  minutes: number
}

export interface TachePlanning {
  id: number
  jour: string
  heureDebut: string | null
  heureFin: string | null
  minutes: number
  minutesMobilisees: number
  description: string | null
  titulaire: { id: number; nom: string }
  categorie: CategorieTemps | null
  manifestation: { id: number; titre: string } | null
  /** La demande à laquelle ces heures se rattachent, s'il y en a une. */
  ticket: { id: number; reference: string | null; titre: string } | null
  participants: RenfortTache[]
}

export interface PartTemps {
  id: number | null
  libelle: string
  couleur?: string
  minutes: number
  part: number | null
}

export interface SeriePeriode {
  cle: string
  libelle: string
  libelleLong: string
  debut: string
  fin: string
  minutes: number
}

export interface RapportTemps {
  periode: {
    debut: string
    fin: string
    libelle: string
    jours: number
    granularite: GranularitePlanning
    typePeriode: GranularitePlanning
  }
  mesure: MesureTemps
  total: { minutes: number; taches: number; personnes: number }
  parPeriode: SeriePeriode[]
  parCategorie: PartTemps[]
  parPersonne: PartTemps[]
  parManifestation: PartTemps[]
}

export interface ComparaisonTemps {
  reference: RapportTemps
  ecart: { minutes: number; pourcentage: number | null }
  parCategorie: {
    id: number | null
    libelle: string
    couleur?: string
    minutes: number
    minutesReference: number
    ecart: number
    pourcentage: number | null
  }[]
}

export interface LienEncadrement {
  id: number
  personneId: number
  nom: string
  intitule: string | null
}

export interface DroitsPlanning {
  canWrite: boolean
  canManageCategories: boolean
  canDisableCategories: boolean
  canManageLinks: boolean
  voitTout: boolean
  moi: number
  mesSuperviseurs: LienEncadrement[]
  mesAgents: LienEncadrement[]
  couleurs: string[]
}

export interface FiltresPlanning {
  debut?: string
  fin?: string
  periode?: GranularitePlanning
  ancre?: string
  mesure?: MesureTemps
  personneId?: number | null
  granularite?: GranularitePlanning
  categorieIds?: number[]
  personneIds?: number[]
  manifestationId?: number | null
  comparer?: 'precedente' | 'n-1'
  compareDebut?: string
  compareFin?: string
}

/**
 * Les parametres d'un rapport, ecrits une seule fois.
 *
 * L'ecran et l'export doivent envoyer exactement les memes : sinon le fichier
 * telecharge porte d'autres totaux que la page depuis laquelle on l'a demande,
 * et c'est le fichier qu'on croit.
 */
function parametresPlanning(filtres: FiltresPlanning): string {
  const p = new URLSearchParams()
  if (filtres.debut) p.append('debut', filtres.debut)
  if (filtres.fin) p.append('fin', filtres.fin)
  if (filtres.periode) p.append('periode', filtres.periode)
  if (filtres.ancre) p.append('ancre', filtres.ancre)
  if (filtres.mesure) p.append('mesure', filtres.mesure)
  if (filtres.personneId) p.append('personneId', String(filtres.personneId))
  if (filtres.granularite) p.append('granularite', filtres.granularite)
  if (filtres.categorieIds?.length) p.append('categorieIds', filtres.categorieIds.join(','))
  if (filtres.personneIds?.length) p.append('personneIds', filtres.personneIds.join(','))
  if (filtres.manifestationId) p.append('manifestationId', String(filtres.manifestationId))
  if (filtres.comparer) p.append('comparer', filtres.comparer)
  if (filtres.compareDebut) p.append('compareDebut', filtres.compareDebut)
  if (filtres.compareFin) p.append('compareFin', filtres.compareFin)
  return p.toString()
}

export const planningApi = {
  droits: () => api.get<{ success: boolean; data: DroitsPlanning }>('/plannings/permissions'),

  categories: (inclureInactives = false) =>
    api.get<{ success: boolean; data: CategorieTemps[] }>(
      `/plannings/categories${inclureInactives ? '?inclureInactives=1' : ''}`
    ),
  creerCategorie: (nom: string) =>
    api.post<{ success: boolean; data: CategorieTemps }>('/plannings/categories', { nom }),
  modifierCategorie: (id: number, data: { nom?: string; couleur?: string }) =>
    api.put<{ success: boolean; data: CategorieTemps }>(`/plannings/categories/${id}`, data),
  activerCategorie: (id: number, active: boolean) =>
    api.put<{ success: boolean; data: CategorieTemps }>(`/plannings/categories/${id}/actif`, { active }),
  supprimerCategorie: (id: number) =>
    api.delete<{ success: boolean }>(`/plannings/categories/${id}`),

  taches: (filtres: FiltresPlanning) =>
    api.get<{ success: boolean; data: { periode: { debut: string; fin: string }; taches: TachePlanning[] } }>(
      `/plannings/taches?${parametresPlanning(filtres)}`
    ),
  creerTache: (data: Record<string, unknown>) =>
    api.post<{ success: boolean; data: TachePlanning }>('/plannings/taches', data),
  modifierTache: (id: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean; data: TachePlanning }>(`/plannings/taches/${id}`, data),
  supprimerTache: (id: number) => api.delete<{ success: boolean }>(`/plannings/taches/${id}`),

  rapport: (filtres: FiltresPlanning) =>
    api.get<{ success: boolean; data: { rapport: RapportTemps; comparaison: ComparaisonTemps | null } }>(
      `/plannings/rapport?${parametresPlanning(filtres)}`
    ),
  urlExport: (filtres: FiltresPlanning, format: 'xlsx' | 'csv') =>
    `/plannings/rapport/export?format=${format}&${parametresPlanning(filtres)}`,

  superviseurs: (agentId: number) =>
    api.get<{ success: boolean; data: LienEncadrement[] }>(`/plannings/superviseurs?agentId=${agentId}`),
  definirSuperviseurs: (agentId: number, liens: { superviseurId: number; intitule?: string }[]) =>
    api.put<{ success: boolean; data: LienEncadrement[] }>(`/plannings/superviseurs/${agentId}`, { liens }),
  agentsSansSuperviseur: () =>
    api.get<{ success: boolean; data: { id: number; nom: string }[] }>('/plannings/agents-sans-superviseur'),
}

// ------------------------------------------------------------------- Tickets

export interface StatutTicket {
  id: number
  nom: string
  slug: string
  couleur: string | null
  icone: string | null
  ordre: number
  ouvert: boolean
  defaut: boolean
  final: boolean
  systeme: boolean
  /** « À valider » : on y arrive par *Terminer*, jamais par le sélecteur. */
  validation?: boolean
  actif: boolean
}

export interface CategorieDemande {
  id: number
  nom: string
  parentId: number | null
  description: string | null
  couleur: string | null
  icone: string | null
  ordre: number
  actif: boolean
  serviceId: number | null
  technicienId: number | null
  /** `null` sur une sous-catégorie veut dire « hérite de la parente ». */
  visibilite: 'privee' | 'site' | null
  materielMode: 'aucun' | 'optionnel' | 'requis' | null
  siteMode: 'auto' | 'requis' | 'masque' | null
  slaPriseEnChargeMinutes: number | null
  slaResolutionMinutes: number | null
  materiels?: { categoryId: number | null; subcategoryId: number | null }[]
}

export interface SiteBatiment {
  id: number
  nom: string
  code: string | null
  adresse: string | null
  ordre: number
  actif: boolean
  peutVoirTickets?: boolean
}

export interface LigneFilTicket {
  type: 'message' | 'evenement'
  id: number
  rang: number
  date: string
  auteur: { id: number | null; nom: string | null }
  body?: string
  interne?: boolean
  serviceNom?: string | null
  pieces?: { id: number; nom: string; url: string; mime: string | null; taille: number | null }[]
  action?: string
  champ?: string | null
  ancienne?: string | null
  nouvelle?: string | null
}

export interface Ticket {
  id: number
  reference: string | null
  titre: string
  description: string | null
  /** Faux quand la demande n'est visible qu'au titre du bâtiment. */
  accesComplet: boolean
  /** `validation` : « À valider », résolue par un agent et en attente de son superviseur. */
  statut: { id: number; nom: string; couleur: string | null; ouvert: boolean; validation?: boolean }
  categorie: { id: number; nom: string; couleur: string | null } | null
  sousCategorie: { id: number; nom: string } | null
  site: { id: number; nom: string } | null
  service: { id: number; nom: string } | null
  demandeur: { id: number; nom: string } | null
  technicien: { id: number; nom: string } | null
  materiel: { id: number | null; nom: string; reference: string | null } | null
  priorite: string
  echeanceResolution: string | null
  enRetard: boolean
  creeLe: string
  misAJourLe: string
}

export interface FiltresTickets {
  /** Les filtres sont sérialisés en chaîne de requête : une signature d'index
   *  évite d'avoir à recopier la liste dans `parametresTickets`. */
  [cle: string]: unknown
  statutId?: number | null
  categorieId?: number | null
  sousCategorieId?: number | null
  siteId?: number | null
  technicienId?: number | null
  serviceId?: number | null
  demandeurId?: number | null
  objectId?: number | null
  ouverts?: boolean | null
  /** Les clôtures qui attendent ma validation. */
  aValider?: boolean | null
  recherche?: string | null
  limite?: number
  depuis?: number
}

function parametresTickets(filtres: Record<string, unknown>): string {
  const p = new URLSearchParams()
  for (const [cle, valeur] of Object.entries(filtres)) {
    if (valeur === null || valeur === undefined || valeur === '') continue
    p.append(cle, String(valeur))
  }
  return p.toString()
}

/** Ce qu'une personne fait d'une catégorie de demandes, du moins au plus. */
export type NiveauTicket = 'demandeur' | 'intervenant' | 'intervenant_categorie' | 'superviseur'

export const NIVEAUX_TICKET: { valeur: NiveauTicket; libelle: string; aide: string }[] = [
  { valeur: 'demandeur', libelle: 'Demandeur', aide: 'Demande dans cette catégorie, suit ses demandes' },
  { valeur: 'intervenant', libelle: 'Intervenant (ses tickets)', aide: 'Référent : ne voit que ce qu’on lui confie' },
  {
    valeur: 'intervenant_categorie',
    libelle: 'Intervenant (toute la catégorie)',
    aide: 'Voit et traite toutes les demandes de la catégorie',
  },
  { valeur: 'superviseur', libelle: 'Superviseur', aide: 'Tout cela, et valide ce que les agents clôturent' },
]

/** Un module du menu, et ce qu'en voit une personne. */
export interface ModuleVisible {
  pluginId: number
  slug: string
  nom: string
  /** Ce que le rôle donne, faute de réglage individuel. */
  parRole: boolean
  /** `null` : le rôle décide. */
  individuel: boolean | null
  effectif: boolean
}

export interface CategorieDroits {
  categorieId: number
  nom: string
  couleur: string | null
  /** `null` : catégorie non attribuée. */
  niveau: NiveauTicket | null
  peutCloturer: boolean
  materielAutorise: boolean | null
  proposeMateriel: boolean
  aUnSuperviseur: boolean
}

/** Tous les droits d'une personne, lus et écrits d'un bloc. */
export interface DroitsPersonne {
  personne: { id: number; nom: string; role: string }
  modules: ModuleVisible[]
  tickets: {
    categories: CategorieDroits[]
    sites: RattachementSite[]
    materiels: { objectId: number; nom: string; reference: string | null }[]
    formulaire: { siteMode: string | null; materielMode: string | null }
  }
  avertissements: string[]
}

export const droitsApi = {
  lire: (userId: number) => api.get<{ success: boolean } & DroitsPersonne>(`/users/${userId}/droits`),
  enregistrer: (
    userId: number,
    data: {
      modules?: { pluginId: number; acces: boolean | null }[]
      categories?: { categorieId: number; niveau: NiveauTicket; peutCloturer: boolean; materielAutorise: boolean | null }[]
      sites?: RattachementSite[]
      formulaire?: { siteMode: string | null; materielMode: string | null }
    }
  ) => api.put<{ success: boolean; message: string } & DroitsPersonne>(`/users/${userId}/droits`, data),
}

/** Ce que le lecteur peut faire d'une demande, calculé par le serveur. */
export interface DroitsTicket {
  niveau: NiveauTicket | null
  intervenant: boolean
  superviseur: boolean
  /** Sa clôture est définitive ; sinon elle passe « À valider ». */
  autonome: boolean
  peutChangerStatut: boolean
  peutTerminer: boolean
  peutValider: boolean
}

/** Une durée saisie : des horaires, ou des minutes, et les renforts. */
export interface SaisieDureeTicket {
  jour: string
  heureDebut?: string | null
  heureFin?: string | null
  minutes?: number | null
  participants?: { userId: number | null; libelle: string | null; minutes: number | null }[]
  titulaireId?: number | null
}

/** Le temps passé sur une demande, lu au planning. */
export interface ClotureTicket {
  tacheCloture: TachePlanning | null
  taches: TachePlanning[]
  minutes: number
}

export const ticketApi = {
  permissions: () =>
    api.get<{
      success: boolean
      voitTout: boolean
      services: number[]
      sitesPartages: number[]
      niveaux: { categorieId: number; niveau: NiveauTicket; peutCloturer: boolean }[]
      estIntervenant: boolean
      estSuperviseur: boolean
      /** Les clôtures qui attendent ma validation. */
      aValider: number
    }>('/tickets/permissions'),

  /**
   * À qui l'on peut confier une demande de cette catégorie. Avec `ticketId`,
   * la règle est celle de la réaffectation de cette demande-là : la personne
   * à qui elle est confiée peut la passer à un autre.
   */
  intervenants: (categorieId: number, ticketId?: number) =>
    api.get<{ success: boolean; intervenants: { id: number; nom: string }[] }>(
      `/tickets/intervenants?categorieId=${categorieId}${ticketId ? `&ticketId=${ticketId}` : ''}`
    ),

  /** Tout ce dont le formulaire a besoin, en un seul appel. */
  formulaire: () =>
    api.get<{
      success: boolean
      sites: SiteBatiment[]
      /** Les bâtiments dont elle est responsable : ceux pour lesquels elle peut signaler. */
      sitesResponsable: SiteBatiment[]
      estResponsable: boolean
      categories: CategorieDemande[]
      statuts: StatutTicket[]
      /** Renseigné quand la personne n'a qu'un bâtiment : le champ est masqué. */
      siteImpose: number | null
      /** Son bâtiment par défaut, celui où elle a son bureau ; son seul bâtiment s'il n'en a qu'un. */
      siteParDefaut: number | null
      /** Rien ne lui a été attribué : l'écran le dit plutôt que d'afficher le vide. */
      sansRattachement: boolean
    }>('/tickets/formulaire'),

  /** Où partira la demande, une fois la catégorie choisie. */
  routage: (categorieId?: number | null, sousCategorieId?: number | null) =>
    api.get<{
      success: boolean
      routage: { siteMode: string; materielMode: string; visibilite: string }
      destinataire: {
        service: { id: number; nom: string } | null
        technicien: { id: number; nom: string } | null
      }
    }>(`/tickets/formulaire/routage?${parametresTickets({ categorieId, sousCategorieId })}`),

  materielsProposes: (categorieId?: number | null, sousCategorieId?: number | null, recherche?: string) =>
    api.get<{
      success: boolean
      materiels: { id: number; name: string; reference: string | null; location: string | null }[]
    }>(`/tickets/formulaire/materiels?${parametresTickets({ categorieId, sousCategorieId, recherche })}`),

  compteurs: (filtres: FiltresTickets = {}) =>
    api.get<{
      success: boolean
      parStatut: { statutId: number; nom: string; couleur: string | null; ordre: number; total: number }[]
      total: number
    }>(`/tickets/compteurs?${parametresTickets(filtres)}`),

  liste: (filtres: FiltresTickets = {}) =>
    api.get<{ success: boolean; total: number; tickets: Ticket[] }>(`/tickets?${parametresTickets(filtres)}`),

  lire: (id: number | string) =>
    api.get<{
      success: boolean
      ticket: Ticket
      acces: 'complet' | 'voisinage'
      intervenant?: boolean
      droits?: DroitsTicket
      fil: LigneFilTicket[]
      pieces: any[]
      observateurs: any[]
      message?: string
    }>(`/tickets/${id}`),

  creer: (data: Record<string, unknown>) =>
    api.post<{ success: boolean; id: number; reference: string | null; ticket: Ticket }>('/tickets', data),
  modifier: (id: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean }>(`/tickets/${id}`, data),
  changerStatut: (id: number, statutId: number) =>
    api.put<{ success: boolean }>(`/tickets/${id}/statut`, { statutId }),

  /** Clore en disant le temps passé et qui a aidé : la tâche part au planning. */
  terminer: (id: number, data: SaisieDureeTicket & { categorieId?: number | null; commentaire?: string | null }) =>
    api.post<{ success: boolean; statut: StatutTicket; tacheId: number }>(`/tickets/${id}/terminer`, data),
  /** Le superviseur valide, après avoir corrigé le temps s'il le faut. */
  valider: (id: number, data: { corrections?: SaisieDureeTicket | null; commentaire?: string | null }) =>
    api.post<{ success: boolean; statut: StatutTicket }>(`/tickets/${id}/valider`, data),
  renvoyer: (id: number, motif: string) =>
    api.post<{ success: boolean; statut: StatutTicket }>(`/tickets/${id}/renvoyer`, { motif }),
  cloture: (id: number | string) =>
    api.get<{ success: boolean } & ClotureTicket>(`/tickets/${id}/cloture`),
  renfortsPossibles: (id: number | string) =>
    api.get<{ success: boolean; personnes: { id: number; nom: string }[] }>(`/tickets/${id}/renforts-possibles`),
  supprimer: (id: number) => api.delete<{ success: boolean }>(`/tickets/${id}`),

  fil: (id: number | string) => api.get<{ success: boolean; fil: LigneFilTicket[] }>(`/tickets/${id}/fil`),
  ecrire: (id: number, data: { body: string; interne?: boolean; piecesIds?: number[] }) =>
    api.post<{ success: boolean; messageId: number }>(`/tickets/${id}/messages`, data),

  /**
   * Dépose une pièce.
   *
   * Passe par `/tickets/:id/documents` et non par `/upload/file` : ce dernier
   * exige le rôle agent de terrain, ce qui interdirait au demandeur de joindre
   * la photo de son rideau cassé.
   */
  joindre: (id: number, fichier: File, messageId?: number | null) => {
    const corps = new FormData()
    corps.append('file', fichier)
    if (messageId) corps.append('messageId', String(messageId))
    return api.post<{
      success: boolean
      document: { id: number; nom: string; url: string; mime: string; taille: number }
    }>(`/tickets/${id}/documents`, corps, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  retirerPiece: (id: number, docId: number) =>
    api.delete<{ success: boolean }>(`/tickets/${id}/documents/${docId}`),

  ajouterObservateur: (id: number, cible: { userId?: number; serviceId?: number }) =>
    api.post<{ success: boolean; id: number }>(`/tickets/${id}/observateurs`, cible),
  retirerObservateur: (id: number, obsId: number) =>
    api.delete<{ success: boolean }>(`/tickets/${id}/observateurs/${obsId}`),
}

export const ticketReferentielApi = {
  statuts: (tous = false) =>
    api.get<{ success: boolean; statuts: StatutTicket[] }>(
      `/tickets/referentiel/statuts${tous ? '?tous=true' : ''}`
    ),
  creerStatut: (data: Record<string, unknown>) =>
    api.post<{ success: boolean; id: number }>('/tickets/referentiel/statuts', data),
  modifierStatut: (id: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean }>(`/tickets/referentiel/statuts/${id}`, data),
  supprimerStatut: (id: number) => api.delete<{ success: boolean }>(`/tickets/referentiel/statuts/${id}`),

  categories: (toutes = false) =>
    api.get<{ success: boolean; categories: CategorieDemande[] }>(
      `/tickets/referentiel/categories${toutes ? '?toutes=true' : ''}`
    ),
  creerCategorie: (data: Record<string, unknown>) =>
    api.post<{ success: boolean; id: number }>('/tickets/referentiel/categories', data),
  modifierCategorie: (id: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean }>(`/tickets/referentiel/categories/${id}`, data),
  supprimerCategorie: (id: number) =>
    api.delete<{ success: boolean }>(`/tickets/referentiel/categories/${id}`),
  /** Étend la visibilité aux demandes déjà ouvertes — un geste, jamais automatique. */
  appliquerVisibilite: (id: number) =>
    api.post<{ success: boolean; modifiees: number }>(
      `/tickets/referentiel/categories/${id}/appliquer-visibilite`,
      {}
    ),

  rattachements: (userId: number) =>
    api.get<{
      success: boolean
      sites: RattachementSite[]
      categories: {
        categorieId: number
        niveau: NiveauTicket
        peutCloturer: boolean
        materielAutorise: boolean | null
      }[]
      materiels: { objectId: number; nom: string; reference: string | null }[]
    }>(`/tickets/referentiel/utilisateurs/${userId}`),
  definirRattachements: (userId: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean }>(`/tickets/referentiel/utilisateurs/${userId}`, data),

  /** L'état des rattachements de tous les comptes, pour l'écran d'attribution. */
  tableauRattachements: () =>
    api.get<{ success: boolean; comptes: CompteRattache[] }>('/tickets/referentiel/rattachements'),

  /** Attribue les mêmes rattachements à plusieurs comptes — ajoute sans retirer. */
  attribuerEnMasse: (data: {
    userIds: number[]
    categorieIds?: number[]
    sites?: Array<{ siteId: number; estResponsable?: boolean; peutVoirTickets?: boolean; notifie?: boolean }>
  }) => api.post<{ success: boolean; comptes: number }>('/tickets/referentiel/rattachements/en-masse', data),
}

/**
 * Le lien d'une personne avec un bâtiment, et les trois droits qu'il porte.
 *
 * Les trois sont **indépendants**. Une école a plusieurs responsables — la
 * directrice, l'élu, le responsable des écoles — qui n'ont ni le même périmètre
 * ni les mêmes besoins : l'élu veut regarder sans recevoir un courriel à chaque
 * ampoule grillée.
 */
export interface RattachementSite {
  siteId: number
  nom: string
  /** Peut signaler *pour le bâtiment*, et pas seulement pour son matériel. */
  estResponsable: boolean
  /** Lit les demandes du bâtiment. */
  peutVoirTickets: boolean
  /** Reçoit un courriel à chaque demande du bâtiment. */
  notifie: boolean
  /** Gère le bâtiment : ses salles, ses portes, ses rattachements. */
  gereLieu?: boolean
  /** Son bâtiment par défaut : celui où elle a son bureau. */
  parDefaut?: boolean
}

export interface CompteRattache {
  id: number
  nom: string
  email: string | null
  role: string
  seConnecte: boolean
  sites: number
  responsableDe: number
  /** Sur combien de bâtiments elle lit les demandes des autres. */
  voitPour: number
  notifiePour: number
  categories: number
  materiels: number
  /** Sans catégorie : cette personne ne peut ouvrir aucune demande. */
  inactif: boolean
}

export const siteApi = {
  mesSites: () =>
    api.get<{
      success: boolean
      sites: SiteBatiment[]
      rattaches: SiteBatiment[]
      impose: number | null
      partages: number[]
    }>('/sites/mes-sites'),
  liste: (tous = false) =>
    api.get<{ success: boolean; sites: SiteBatiment[] }>(`/sites${tous ? '?tous=true' : ''}`),
  lire: (id: number) => api.get<{ success: boolean; site: SiteBatiment; ouvrants: any[] }>(`/sites/${id}`),
  membres: (id: number) =>
    api.get<{
      success: boolean
      /** Faux pour le gestionnaire d'un bâtiment : il ne fait pas d'autres gestionnaires. */
      peutAccorderGestion: boolean
      membres: MembreSite[]
    }>(`/sites/${id}/membres`),
  /** Rattache la personne si elle ne l'est pas ; les droits absents ne sont pas touchés. */
  reglerMembre: (
    id: number,
    userId: number,
    droits: Partial<Pick<MembreSite, 'estResponsable' | 'peutVoirTickets' | 'notifie' | 'gereLieu'>>
  ) => api.put<{ success: boolean }>(`/sites/${id}/membres/${userId}`, droits),
  retirerMembre: (id: number, userId: number) =>
    api.delete<{ success: boolean }>(`/sites/${id}/membres/${userId}`),
  creer: (data: Record<string, unknown>) => api.post<{ success: boolean; id: number }>('/sites', data),
  modifier: (id: number, data: Record<string, unknown>) => api.put<{ success: boolean }>(`/sites/${id}`, data),
  supprimer: (id: number) => api.delete<{ success: boolean }>(`/sites/${id}`),
}

/** Une personne rattachée à un bâtiment, et ses quatre droits indépendants. */
export interface MembreSite {
  id: number
  userId: number
  nom: string
  email: string | null
  /** Signale pour le bâtiment, pas seulement pour son matériel. */
  estResponsable: boolean
  /** Lit les demandes du bâtiment. */
  peutVoirTickets: boolean
  /** Reçoit un courriel à chaque demande. */
  notifie: boolean
  /** Gère le bâtiment : ses salles, ses portes, ses rattachements. */
  gereLieu: boolean
}

// ------------------------------------------------------------- Organisation

/** Ce que le compte courant gère. Voir `gestionOrganisation.service.ts`. */
export interface PerimetreGestion {
  /** Case « gère toute l'organisation » cochée par l'administrateur. */
  gereOrganisation: boolean
  /** Tous les bâtiments et salles : administrateur, superviseur ou gestionnaire global. */
  gereLieux: boolean
  /** Tous les services : administrateur ou gestionnaire global. */
  gereServices: boolean
  sitesGeres: number[]
  /** Gérés ou dont le compte est responsable : ce que le module Bâtiments lui montre. */
  sitesConsultes: number[]
  servicesGeres: number[]
}

export interface Salle {
  id: number
  siteId: number
  siteNom: string
  nom: string
  /** « Salle du conseil — Mairie ». */
  libelle: string
  code: string | null
  description: string | null
  typeLieu: string | null
  capacite: number | null
  /** `null` = suit le bâtiment. */
  pretable: boolean | null
  pretableEffectif: boolean
  actif: boolean
  modifiable: boolean
}

export interface PersonneGestion {
  userId: number
  nom: string
  email: string | null
}

export const organisationApi = {
  moi: () => api.get<{ success: boolean } & PerimetreGestion>('/organisation/moi'),
  salles: (tous = false) =>
    api.get<{ success: boolean; salles: Salle[] }>(`/organisation/salles${tous ? '?tous=true' : ''}`),
  gestionnaires: () =>
    api.get<{
      success: boolean
      globaux: Array<PersonneGestion & { role: string }>
      batiments: Array<{ siteId: number; nom: string; actif: boolean; gestionnaires: PersonneGestion[] }>
      services: Array<{ serviceId: number; nom: string; actif: boolean; responsables: PersonneGestion[] }>
    }>('/organisation/gestionnaires'),
  /** Comptes actifs qui se connectent — ce qu'un gestionnaire peut rattacher ou ajouter. */
  personnes: () =>
    api.get<{ success: boolean; personnes: PersonneGestion[] }>('/organisation/personnes'),
  definirGestionnaire: (userId: number, gereOrganisation: boolean) =>
    api.put<{ success: boolean }>(`/organisation/gestionnaires/${userId}`, { gereOrganisation }),
}

// ------------------------------------------------------------------ Bâtiments

/** Ce qu'on range : l'« objet » d'un document. Voir `batiments.service.ts`. */
export type NatureRubrique = 'controle' | 'rapport' | 'facture' | 'contrat' | 'autre'
export type ResultatControle = 'conforme' | 'reserves' | 'non_conforme'
export type StatutDocumentBatiment = 'a_valider' | 'valide' | 'refuse'
/** Du plus urgent au plus calme. */
export type StatutSuivi = 'en_retard' | 'non_conforme' | 'bientot' | 'a_jour' | 'jamais'

export interface RubriqueBatiment {
  id: number
  code: string
  libelle: string
  nature: NatureRubrique
  /** `null` : pas d'échéance, le document se range seulement. */
  periodiciteMois: number | null
  rappelJours: number
  referenceReglementaire: string | null
  description: string | null
  actif: boolean
  /** Livrée avec l'application : se désactive, ne se supprime pas. */
  systeme: boolean
  ordre: number
  suivis: number
  documents: number
}

export interface EtatSuivi {
  suiviId: number
  siteId: number
  siteNom: string
  rubriqueId: number
  rubriqueLibelle: string
  nature: NatureRubrique
  libelle: string | null
  pieceId: number | null
  pieceNom: string | null
  periodiciteMois: number | null
  rappelJours: number
  surcharge: { periodiciteMois: number | null; rappelJours: number | null }
  echeanceInitiale: string | null
  actif: boolean
  notes: string | null
  dernierDocument: { id: number; titre: string; date: string | null; resultat: ResultatControle | null } | null
  echeance: string | null
  joursRestants: number | null
  enRetard: boolean
  dansFenetre: boolean
  statut: StatutSuivi
}

export interface DocumentBatiment {
  id: number
  siteId: number
  siteNom: string
  pieceId: number | null
  pieceNom: string | null
  rubriqueId: number | null
  rubriqueLibelle: string | null
  nature: NatureRubrique | null
  suiviId: number | null
  suiviLibelle: string | null
  titre: string
  description: string | null
  commentaireDepot: string | null
  nomOrigine: string
  mime: string | null
  taille: number | null
  dateDocument: string | null
  prochaineEcheance: string | null
  resultat: ResultatControle | null
  statut: StatutDocumentBatiment
  motifRefus: string | null
  source: 'interne' | 'entreprise'
  deposePar: { id: number; nom: string } | null
  /** L'entreprise extérieure qui l'a déposé par son portail. */
  entreprise: { id: number; nom: string } | null
  validePar: { id: number; nom: string } | null
  valideLe: string | null
  creeLe: string | null
}

export interface ResumeBatiment {
  id: number
  nom: string
  code: string | null
  adresse: string | null
  /** Le compte gère ce bâtiment ; sinon il en est responsable, et dépose sans valider. */
  gere: boolean
  compteurs: Record<StatutSuivi | 'suivis' | 'aValider' | 'documents', number>
}

/** Ce qui classe un document : envoyé au dépôt, à la validation, au reclassement. */
export interface ClassementDocument {
  siteId?: number
  pieceId?: number | null
  rubriqueId?: number | null
  suiviId?: number | null
  titre?: string
  description?: string | null
  dateDocument?: string | null
  prochaineEcheance?: string | null
  resultat?: ResultatControle | null
  creerSuivi?: boolean
}

export const batimentsApi = {
  liste: () =>
    api.get<{ success: boolean; gereTout: boolean; batiments: ResumeBatiment[] }>('/batiments'),
  lire: (id: number) =>
    api.get<{
      success: boolean
      batiment: { id: number; nom: string; code: string | null; adresse: string | null; actif: boolean; surfaceM2: number | null }
      gere: boolean
      pieces: { id: number; nom: string }[]
    }>(`/batiments/${id}`),
  suivis: (id: number) => api.get<{ success: boolean; suivis: EtatSuivi[] }>(`/batiments/${id}/suivis`),
  suivi: (suiviId: number) => api.get<{ success: boolean; suivi: EtatSuivi }>(`/batiments/suivis/${suiviId}`),
  creerSuivi: (id: number, data: Record<string, unknown>) =>
    api.post<{ success: boolean; id: number }>(`/batiments/${id}/suivis`, data),
  modifierSuivi: (suiviId: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean }>(`/batiments/suivis/${suiviId}`, data),
  supprimerSuivi: (suiviId: number) => api.delete<{ success: boolean }>(`/batiments/suivis/${suiviId}`),

  documents: (id: number, filtre: { statut?: StatutDocumentBatiment; rubrique?: number; suivi?: number; q?: string } = {}) =>
    api.get<{ success: boolean; documents: DocumentBatiment[] }>(`/batiments/${id}/documents`, { params: filtre }),
  aValider: () => api.get<{ success: boolean; documents: DocumentBatiment[] }>('/batiments/a-valider'),
  /** Multipart : le fichier sous `fichier`, la classification en champs. */
  deposer: (id: number, donnees: FormData) =>
    api.post<{ success: boolean; id: number; statut: StatutDocumentBatiment; suiviId: number | null; suiviCree: boolean }>(
      `/batiments/${id}/documents`,
      donnees,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    ),
  modifierDocument: (docId: number, data: ClassementDocument) =>
    api.put<{ success: boolean; suiviId: number | null; suiviCree: boolean }>(`/batiments/documents/${docId}`, data),
  /** `coutTtc` : le coût du contrôle, qui crée l'intervention correspondante. */
  valider: (docId: number, data: ClassementDocument & { coutTtc?: number | string | null }) =>
    api.post<{ success: boolean; suiviId: number | null; suiviCree: boolean; prochaineEcheance: string | null; interventionId: number | null }>(
      `/batiments/documents/${docId}/valider`,
      data
    ),
  refuser: (docId: number, motif: string) =>
    api.post<{ success: boolean }>(`/batiments/documents/${docId}/refuser`, { motif }),
  supprimerDocument: (docId: number) => api.delete<{ success: boolean }>(`/batiments/documents/${docId}`),
  /** Le fichier, en blob : il ne passe jamais par une URL que l'on pourrait partager. */
  fichier: (docId: number) => api.get<Blob>(`/batiments/documents/${docId}/fichier`, { responseType: 'blob' }),

  rubriques: (toutes = false) =>
    api.get<{ success: boolean; rubriques: RubriqueBatiment[] }>(`/batiments/rubriques${toutes ? '?toutes=true' : ''}`),
  creerRubrique: (data: Record<string, unknown>) =>
    api.post<{ success: boolean; id: number }>('/batiments/rubriques', data),
  modifierRubrique: (rubriqueId: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean }>(`/batiments/rubriques/${rubriqueId}`, data),
  supprimerRubrique: (rubriqueId: number) => api.delete<{ success: boolean }>(`/batiments/rubriques/${rubriqueId}`),
  appliquerRubrique: (rubriqueId: number, cible: { tous: true } | { siteIds: number[] }) =>
    api.post<{ success: boolean; crees: number }>(`/batiments/rubriques/${rubriqueId}/appliquer`, cible),
}

// ------------------------------------------------------ Étages, plans, pièces

export interface PointPlanApi {
  x: number
  y: number
}

export interface Etage {
  id: number
  siteId: number
  nom: string
  /** 0 pour le rez-de-chaussée, -1 pour le sous-sol. */
  niveau: number
  ordre: number
  plan: { mime: string | null; largeur: number | null; hauteur: number | null; ratio: number | null } | null
  echelle: { metresParPourcent: number; points: { a: PointPlanApi; b: PointPlanApi; metres: number } | null } | null
}

export interface PieceSurPlan {
  id: number
  nom: string
  code: string | null
  typeLieu: string | null
  capacite: number | null
  actif: boolean
  etageId: number | null
  /** En pourcentages du plan ; vide tant que la pièce n'est pas dessinée. */
  zone: PointPlanApi[]
  surfaceM2: number | null
  materiels: number
}

export interface MaterielDansPiece {
  placementId: number
  pieceId: number
  objectId: number
  nom: string
  reference: string | null
  image: string | null
  unique: boolean
  quantite: number
  notes: string | null
}

export interface FichePiece {
  piece: {
    id: number
    siteId: number
    nom: string
    code: string | null
    typeLieu: string | null
    capacite: number | null
    etageId: number | null
    etageNom: string | null
    surfaceM2: number | null
    aUneZone: boolean
  }
  materiels: MaterielDansPiece[]
  cles: Array<{
    id: number
    nom: string
    reference: string | null
    portee: 'batiment' | 'piece' | 'porte'
    porte: string | null
    detenteurs: string[]
  }>
  portes: { id: number; nom: string; code: string | null }[]
  documents: { id: number; titre: string; date: string | null; rubrique: string | null }[]
}

export const plansApi = {
  etages: (siteId: number) =>
    api.get<{ success: boolean; etages: Etage[]; pieces: PieceSurPlan[] }>(`/batiments/${siteId}/etages`),
  creerEtage: (siteId: number, data: { nom: string; niveau: number }) =>
    api.post<{ success: boolean; id: number }>(`/batiments/${siteId}/etages`, data),
  modifierEtage: (etageId: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean; etage: Etage }>(`/batiments/etages/${etageId}`, data),
  supprimerEtage: (etageId: number) => api.delete<{ success: boolean }>(`/batiments/etages/${etageId}`),
  /** Multipart : l'image sous `plan`, et les dimensions mesurées par le navigateur. */
  deposerPlan: (etageId: number, donnees: FormData) =>
    api.post<{ success: boolean; etage: Etage }>(`/batiments/etages/${etageId}/plan`, donnees, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  /** Le plan, en blob : il ne passe jamais par une URL partageable. */
  plan: (etageId: number) => api.get<Blob>(`/batiments/etages/${etageId}/plan`, { responseType: 'blob' }),
  creerPiece: (etageId: number, data: { nom: string; typeLieu?: string | null; points: PointPlanApi[] }) =>
    api.post<{ success: boolean; id: number; surfaceM2: number | null }>(`/batiments/etages/${etageId}/pieces`, data),
  zone: (pieceId: number, data: { etageId: number | null; points: PointPlanApi[] | null }) =>
    api.put<{ success: boolean; surfaceM2: number | null }>(`/batiments/pieces/${pieceId}/zone`, data),
  fiche: (pieceId: number) => api.get<{ success: boolean } & FichePiece>(`/batiments/pieces/${pieceId}`),
  placer: (pieceId: number, data: { objectId: number; quantite?: number; deplacer?: boolean }) =>
    api.post<{ success: boolean; placementId: number; deplaceDe: string | null }>(
      `/batiments/pieces/${pieceId}/materiels`,
      data
    ),
  modifierPlacement: (placementId: number, data: { quantite?: number; notes?: string | null }) =>
    api.put<{ success: boolean }>(`/batiments/placements/${placementId}`, data),
  retirerPlacement: (placementId: number) => api.delete<{ success: boolean }>(`/batiments/placements/${placementId}`),
  materielsDuBatiment: (siteId: number) =>
    api.get<{ success: boolean; materiels: MaterielDansPiece[] }>(`/batiments/${siteId}/materiels`),
  piecesDuMateriel: (objectId: number) =>
    api.get<{
      success: boolean
      pieces: Array<{ placementId: number; pieceId: number; pieceNom: string; siteId: number; siteNom: string; etage: string | null; quantite: number }>
    }>(`/batiments/materiels/${objectId}/pieces`),
}

// ------------------------------------ Énergie, contrats, interventions (lot D)

export type Energie = 'electricite' | 'gaz' | 'eau' | 'fioul' | 'chaleur' | 'autre'
export type NatureIntervention = 'entretien' | 'depannage' | 'travaux' | 'controle' | 'nettoyage' | 'autre'
export type StatutContrat = 'actif' | 'a_resilier' | 'se_termine' | 'echu' | 'sans_fin' | 'inactif'

interface Nomme {
  id: number
  nom: string
}

export interface Compteur {
  id: number
  siteId: number
  energie: Energie
  libelle: string | null
  numero: string | null
  unite: string
  fournisseur: Nomme | null
  actif: boolean
  notes: string | null
  dernierReleve: { date: string; index: number } | null
}

export interface Releve {
  id: number
  date: string
  index: number
  /** Depuis le relevé précédent ; `null` pour le premier. */
  consommation: number | null
  notes: string | null
}

export interface Facture {
  id: number
  siteId: number
  compteurId: number | null
  compteurLibelle: string | null
  energie: Energie
  fournisseur: Nomme | null
  numero: string | null
  dateFacture: string
  periodeDebut: string | null
  periodeFin: string | null
  consommation: number | null
  unite: string | null
  montantHt: number | null
  /** Négatif pour un avoir. */
  montantTtc: number
  estimee: boolean
  document: { id: number; titre: string } | null
  notes: string | null
}

export interface SyntheseEnergie {
  energie: Energie
  unite: string | null
  montant: number
  consommation: number
  montantPrecedent: number
  consommationPrecedente: number
  /** Jours de l'année couverts par au moins une facture. */
  joursCouverts: number
}

export interface Contrat {
  id: number
  objet: string
  entreprise: Nomme | null
  reference: string | null
  dateDebut: string
  dateFin: string | null
  reconductionTacite: boolean
  preavisJours: number
  montantAnnuelHt: number | null
  montantAnnuelTtc: number | null
  document: { id: number; titre: string } | null
  notes: string | null
  actif: boolean
  sites: Nomme[]
  etat: {
    finEnCours: string | null
    /** Veille du préavis d'un contrat tacite ; fin d'un contrat ferme. */
    dateCle: string | null
    joursAvantDateCle: number | null
    statut: StatutContrat
  }
}

export interface Intervention {
  id: number
  siteId: number
  siteNom: string
  pieceId: number | null
  pieceNom: string | null
  date: string
  nature: NatureIntervention
  titre: string
  description: string | null
  entreprise: Nomme | null
  contrat: { id: number; objet: string } | null
  ticketId: number | null
  document: { id: number; titre: string } | null
  montantHt: number | null
  montantTtc: number | null
  dureeMinutes: number | null
}

export type CategorieStat = 'energie' | 'contrats' | 'interventions' | 'controles' | 'achats'
export type ComparaisonStat = 'aucune' | 'precedente' | 'n-1'
export type GranulariteStat = 'semaine' | 'mois' | 'annee'
type ParCategorieStat = Record<CategorieStat, number>

export interface SerieStat {
  cle: string
  libelle: string
  libelleLong: string
  debut: string
  fin: string
  parCategorie: ParCategorieStat
  total: number
  consommations: Partial<Record<Energie, number>>
}

export interface StatistiquesBatiments {
  filtre: {
    debut: string
    fin: string
    granularite: GranulariteStat
    siteIds: number[]
    categories: CategorieStat[]
    energies: Energie[]
    comparaison: ComparaisonStat
  }
  fenetre: { debut: string; fin: string }
  fenetreComparaison: { debut: string; fin: string } | null
  totaux: { montant: number; comparaison: number | null; parCategorie: ParCategorieStat; parCategorieComparaison: ParCategorieStat | null }
  series: SerieStat[]
  seriesComparaison: SerieStat[] | null
  details: Array<{ categorie: CategorieStat; sous: string; montant: number; comparaison: number | null }>
  parEnergie: Array<{
    energie: Energie
    montant: number
    consommation: number
    unite: string | null
    comparaison: number | null
    consommationComparaison: number | null
  }>
  parBatiment: Array<{
    siteId: number
    nom: string
    surfaceM2: number | null
    parCategorie: ParCategorieStat
    total: number
    comparaison: number | null
    consommations: Partial<Record<Energie, number>>
    /** Par énergie facturée : la part des jours couverts par une facture, de 0 à 1. */
    couverture: Partial<Record<Energie, number>>
  }>
  achatsSansPrix: number
}

export interface FiltreStatistiquesApi {
  debut?: string
  fin?: string
  granularite?: GranulariteStat
  sites?: number[]
  categories?: CategorieStat[]
  energies?: Energie[]
  comparaison?: ComparaisonStat
}

export const exploitationApi = {
  statistiques: (f: FiltreStatistiquesApi) =>
    api.get<{ success: boolean; statistiques: StatistiquesBatiments }>('/batiments/statistiques', {
      params: {
        debut: f.debut,
        fin: f.fin,
        granularite: f.granularite,
        comparaison: f.comparaison,
        sites: f.sites?.length ? f.sites.join(',') : undefined,
        categories: f.categories?.length ? f.categories.join(',') : undefined,
        energies: f.energies?.length ? f.energies.join(',') : undefined,
      },
    }),
  fournisseurs: () => api.get<{ success: boolean; fournisseurs: Nomme[] }>('/batiments/fournisseurs'),
  surface: (siteId: number, surfaceM2: number | string | null) =>
    api.put<{ success: boolean; surfaceM2: number | null }>(`/batiments/${siteId}/surface`, { surfaceM2 }),

  compteurs: (siteId: number) => api.get<{ success: boolean; compteurs: Compteur[] }>(`/batiments/${siteId}/compteurs`),
  creerCompteur: (siteId: number, data: Record<string, unknown>) =>
    api.post<{ success: boolean; id: number }>(`/batiments/${siteId}/compteurs`, data),
  modifierCompteur: (id: number, data: Record<string, unknown>) => api.put<{ success: boolean }>(`/batiments/compteurs/${id}`, data),
  supprimerCompteur: (id: number) => api.delete<{ success: boolean }>(`/batiments/compteurs/${id}`),
  releves: (compteurId: number) => api.get<{ success: boolean; releves: Releve[] }>(`/batiments/compteurs/${compteurId}/releves`),
  ajouterReleve: (compteurId: number, data: { date: string; index: number | string; notes?: string | null }) =>
    api.post<{ success: boolean; id: number }>(`/batiments/compteurs/${compteurId}/releves`, data),
  supprimerReleve: (id: number) => api.delete<{ success: boolean }>(`/batiments/releves/${id}`),

  factures: (siteId: number, filtre: { annee?: number; energie?: Energie } = {}) =>
    api.get<{ success: boolean; factures: Facture[] }>(`/batiments/${siteId}/factures`, { params: filtre }),
  creerFacture: (siteId: number, data: Record<string, unknown>) =>
    api.post<{ success: boolean; id: number }>(`/batiments/${siteId}/factures`, data),
  modifierFacture: (id: number, data: Record<string, unknown>) => api.put<{ success: boolean }>(`/batiments/factures/${id}`, data),
  supprimerFacture: (id: number) => api.delete<{ success: boolean }>(`/batiments/factures/${id}`),
  synthese: (siteId: number, annee: number) =>
    api.get<{ success: boolean; annee: number; surfaceM2: number | null; energies: SyntheseEnergie[] }>(
      `/batiments/${siteId}/energie/synthese`,
      { params: { annee } }
    ),

  contrats: (siteId?: number) =>
    api.get<{ success: boolean; contrats: Contrat[] }>('/batiments/contrats', { params: siteId ? { site: siteId } : {} }),
  contrat: (id: number) => api.get<{ success: boolean; contrat: Contrat }>(`/batiments/contrats/${id}`),
  creerContrat: (data: Record<string, unknown>) => api.post<{ success: boolean; id: number }>('/batiments/contrats', data),
  modifierContrat: (id: number, data: Record<string, unknown>) => api.put<{ success: boolean }>(`/batiments/contrats/${id}`, data),
  supprimerContrat: (id: number) => api.delete<{ success: boolean }>(`/batiments/contrats/${id}`),

  interventions: (siteId: number, filtre: { piece?: number; annee?: number; nature?: NatureIntervention } = {}) =>
    api.get<{ success: boolean; interventions: Intervention[] }>(`/batiments/${siteId}/interventions`, { params: filtre }),
  creerIntervention: (siteId: number, data: Record<string, unknown>) =>
    api.post<{ success: boolean; id: number }>(`/batiments/${siteId}/interventions`, data),
  modifierIntervention: (id: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean }>(`/batiments/interventions/${id}`, data),
  supprimerIntervention: (id: number) => api.delete<{ success: boolean }>(`/batiments/interventions/${id}`),
}

// ------------------------------------------------------ Entreprises extérieures

export type EtatAccesEntreprise = 'aucun' | 'actif' | 'suspendu' | 'expire' | 'bloque' | 'inactive'

export interface ContactEntreprise {
  id?: number
  nom: string
  fonction: string | null
  telephone: string | null
  email: string | null
  /** Reçoit le lien et le code avec l'entreprise. */
  recoitAcces: boolean
}

export interface DroitObjet {
  rubriqueId: number
  lecture: boolean
  depot: boolean
}

export interface Entreprise {
  id: number
  nom: string
  email: string
  telephone: string | null
  adresse: string | null
  codePostal: string | null
  ville: string | null
  siret: string | null
  notes: string | null
  actif: boolean
  acces: {
    etat: EtatAccesEntreprise
    genereLe: string | null
    fin: string | null
    suspendu: boolean
    bloqueJusqua: string | null
    derniereConnexion: string | null
  }
  contacts: ContactEntreprise[]
  sites: number[]
  rubriques: DroitObjet[]
  documents: number
}

export interface ResultatAcces {
  success: boolean
  /** En clair, une seule fois : il n'est jamais relu. */
  code: string
  lien: string
  envoi: { resultat: 'envoye' | 'retenu' | 'echec' | 'non_demande'; destinataires: string[]; message?: string }
}

export const entreprisesApi = {
  liste: () =>
    api.get<{
      success: boolean
      entreprises: Array<Entreprise & { nbSites: number; nbRubriques: number; nbContacts: number }>
    }>('/entreprises'),
  lire: (id: number) => api.get<{ success: boolean; entreprise: Entreprise; lien: string }>(`/entreprises/${id}`),
  creer: (data: Record<string, unknown>) => api.post<{ success: boolean; id: number }>('/entreprises', data),
  modifier: (id: number, data: Record<string, unknown>) => api.put<{ success: boolean }>(`/entreprises/${id}`, data),
  supprimer: (id: number) => api.delete<{ success: boolean }>(`/entreprises/${id}`),
  contacts: (id: number, contacts: ContactEntreprise[]) =>
    api.put<{ success: boolean }>(`/entreprises/${id}/contacts`, { contacts }),
  droits: (id: number, droits: { sites: number[]; rubriques: DroitObjet[] }) =>
    api.put<{ success: boolean }>(`/entreprises/${id}/droits`, droits),
  genererAcces: (id: number, options: { envoyer: boolean; inclureCode: boolean }) =>
    api.post<ResultatAcces>(`/entreprises/${id}/acces`, options),
  reglerAcces: (id: number, reglage: { fin?: string | null; suspendu?: boolean }) =>
    api.put<{ success: boolean }>(`/entreprises/${id}/acces`, reglage),
  deverrouiller: (id: number) => api.post<{ success: boolean }>(`/entreprises/${id}/deverrouiller`),
}

// --------------------------------------------- Tickets : règles de diffusion

export interface RegleNotification {
  id: number
  /** `null` vaut « tous les événements » : c'est le cas d'un élu qui suit un bâtiment. */
  evenement: string | null
  libelle: string | null
  actif: boolean
  /** Chaque champ à `null` vaut « peu importe », et élargit la règle. */
  portee: {
    categorieId: number | null
    categorieNom: string | null
    sousCategorieId: number | null
    sousCategorieNom: string | null
    siteId: number | null
    siteNom: string | null
    serviceId: number | null
    serviceNom: string | null
  }
  destinataire: {
    type: 'user' | 'service' | 'role'
    userId: number | null
    userNom: string | null
    serviceId: number | null
    serviceNom: string | null
    role: string | null
  }
}

export const ticketRegleApi = {
  liste: () =>
    api.get<{ success: boolean; regles: RegleNotification[] }>('/tickets/referentiel/regles'),
  creer: (data: Record<string, unknown>) =>
    api.post<{ success: boolean; id: number }>('/tickets/referentiel/regles', data),
  activer: (id: number, actif: boolean) =>
    api.put<{ success: boolean }>(`/tickets/referentiel/regles/${id}`, { actif }),
  supprimer: (id: number) => api.delete<{ success: boolean }>(`/tickets/referentiel/regles/${id}`),
  /** Qui recevrait, et pourquoi — sans rien envoyer. */
  simuler: (data: Record<string, unknown>) =>
    api.post<{ success: boolean; destinataires: { email: string; raison: string }[] }>(
      '/tickets/referentiel/regles/simulation',
      data
    ),
}

/** Le catalogue d'événements d'un module, et les rôles configurables. */
export const notificationCatalogueApi = {
  evenements: (domaine: 'manifestation' | 'ticket') =>
    api.get<{
      success: boolean
      data: {
        events: Array<{
          domaine: string
          evenement: string
          libelle: string
          description: string
          engageant: boolean
        }>
        roles: { role: string; label: string }[]
      }
    }>(`/notifications/events?domaine=${domaine}`),
  defauts: (domaine: 'manifestation' | 'ticket') =>
    api.get<{ success: boolean; data: Record<string, { roles: string[]; services: boolean }> }>(
      `/notifications/defaults?domaine=${domaine}`
    ),
  enregistrerDefauts: (domaine: 'manifestation' | 'ticket', defaults: Record<string, unknown>) =>
    api.put<{ success: boolean }>(`/notifications/defaults?domaine=${domaine}`, { defaults }),
}
