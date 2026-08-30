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
 * Routes dont un 401 ne décrit pas une session à récupérer.
 *
 * Sans cette exclusion, un 401 sur `/auth/logout` appelait `handleExpiredSession`,
 * qui appelait `logout()`, qui rappelait `/auth/logout` : une dizaine de
 * requêtes en cascade, jusqu'au 429 du limiteur. Comme celui-ci couvre tout
 * `/api/auth` à 10 requêtes par quart d'heure, se déconnecter — ou simplement
 * se tromper de mot de passe — interdisait de se reconnecter pendant 15 minutes.
 */
const ROUTES_SANS_REPRISE_DE_SESSION = ['/auth/logout', '/auth/refresh', '/auth/login']

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
          method: methode.toUpperCase() as 'POST' | 'PUT',
          body: originalRequest.data ? JSON.parse(originalRequest.data) : undefined,
          label: decrireSaisie(url),
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
export interface User {
  id: number
  email: string
  firstName?: string
  lastName?: string
  role: 'admin' | 'supervisor' | 'agent' | 'user'
  avatar?: string
  isActive: boolean
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
  backupType: 'manual' | 'auto'
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
  objects?: Array<{ object_id: number; notes?: string | null }>
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
  obligatoire: boolean
  type: string
  alias: string[]
}

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
        correspondance: Record<string, string>
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
      field_mapping?: Record<string, string> | null
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

  getNextcloud: () =>
    api.get<{ success: boolean; data: ConfigNextcloud }>('/manifestations/export/nextcloud'),
  saveNextcloud: (data: { url: string; username: string; password?: string; folder?: string }) =>
    api.put<{ success: boolean }>('/manifestations/export/nextcloud', data),
  testNextcloud: (data: { url?: string; username?: string; password?: string; folder?: string }) =>
    api.post<{ success: boolean; message: string }>('/manifestations/export/nextcloud/test', data),
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
    data: { delivered?: boolean; returned?: boolean; return_state?: EtatRetour; notes?: string }
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
  /** Une liste se répète dans le modèle : `{#materiels}…{/materiels}`. */
  liste?: boolean
}

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
    data: { name: string; source: 'upload' | 'nextcloud'; file_path?: string; remote_path?: string }
  ) => api.post<{ success: boolean; data: ModeleService }>(`/services/${serviceId}/template`, data),

  enregistrer: (
    serviceId: number,
    data: { name?: string; field_mapping?: Record<string, string>; is_active?: boolean }
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
  apercu: async (serviceId: number, nom: string, manifestationId?: number) => {
    const reponse = await api.post(
      `/services/${serviceId}/template/preview`,
      manifestationId ? { manifestation_id: manifestationId } : {},
      { responseType: 'blob' }
    )
    const url = window.URL.createObjectURL(new Blob([reponse.data]))
    const lien = document.createElement('a')
    lien.href = url
    lien.setAttribute('download', `${nom || 'apercu'}.docx`)
    document.body.appendChild(lien)
    lien.click()
    lien.remove()
    window.URL.revokeObjectURL(url)
  },
}

/** Compte rendu d'un essai de réception, qui ne crée jamais rien. */
export interface EssaiIntake {
  source: { id: number; name: string; slug: string } | null
  origine_correspondance: 'imposee' | 'detectee'
  correspondance: Record<string, string>
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
