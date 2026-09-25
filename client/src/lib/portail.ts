import axios from 'axios'
import type { NatureRubrique, ResultatControle, StatutDocumentBatiment, StatutSuivi } from '@/lib/api'

/**
 * Le client HTTP du portail des entreprises.
 *
 * **Une instance à part**, et non `api` : celle-ci pose le jeton de l'agent
 * connecté et transforme tout 401 en tentative de reconnexion, puis en
 * déconnexion. Un code faux saisi sur le portail — un 401 — déconnecterait
 * l'agent qui, sur le même poste, essaie le lien avant de l'envoyer.
 *
 * La session tient dans `localStorage`, **par lien** : « sur cet appareil »,
 * comme promis à l'entreprise, et sans mélanger deux portails ouverts sur le
 * même poste. Le serveur la fait expirer au bout de huit heures ; au premier
 * 401, on l'oublie et l'écran redemande le code.
 */

const API_URL = import.meta.env.VITE_API_URL || '/api'

const cle = (lien: string) => `portail:${lien}`

export function sessionDe(lien: string): string | null {
  try {
    const brut = localStorage.getItem(cle(lien))
    if (!brut) return null
    const { jeton, expireLe } = JSON.parse(brut) as { jeton: string; expireLe: string }
    if (new Date(expireLe).getTime() <= Date.now()) {
      localStorage.removeItem(cle(lien))
      return null
    }
    return jeton
  } catch {
    return null
  }
}

function retenirSession(lien: string, jeton: string, expireLe: string) {
  try {
    localStorage.setItem(cle(lien), JSON.stringify({ jeton, expireLe }))
  } catch {
    /* navigation privée : la session vivra le temps de la page */
  }
}

export function oublierSession(lien: string) {
  try {
    localStorage.removeItem(cle(lien))
  } catch {
    /* rien à oublier */
  }
}

export interface MoiPortail {
  entreprise: { nom: string }
  batiments: { id: number; nom: string }[]
  objets: { id: number; libelle: string; nature: NatureRubrique; lecture: boolean; depot: boolean }[]
  echeances: {
    siteId: number
    siteNom: string
    rubriqueLibelle: string
    libelle: string | null
    echeance: string | null
    joursRestants: number | null
    statut: StatutSuivi
  }[]
}

export interface DocumentPortail {
  id: number
  siteId: number
  siteNom: string
  rubriqueId: number | null
  rubriqueLibelle: string | null
  titre: string
  nomOrigine: string
  mime: string | null
  taille: number | null
  dateDocument: string | null
  prochaineEcheance: string | null
  resultat: ResultatControle | null
  statut: StatutDocumentBatiment
  motifRefus: string | null
  sien: boolean
  deposeLe: string | null
}

/** Les appels d'un portail, tous porteurs de sa session. */
export function portail(lien: string) {
  const http = axios.create({ baseURL: `${API_URL}/portail` })
  http.interceptors.request.use((config) => {
    const jeton = sessionDe(lien)
    if (jeton) config.headers['X-Session-Portail'] = jeton
    return config
  })

  return {
    async connexion(code: string) {
      const { data } = await http.post<{ jeton: string; expireLe: string; entreprise: { nom: string } }>(
        `/${encodeURIComponent(lien)}/connexion`,
        { code }
      )
      retenirSession(lien, data.jeton, data.expireLe)
      return data
    },
    async deconnexion() {
      try {
        await http.post('/deconnexion')
      } finally {
        oublierSession(lien)
      }
    },
    moi: async () => (await http.get<MoiPortail & { success: boolean }>('/moi')).data,
    documents: async () => (await http.get<{ documents: DocumentPortail[] }>('/documents')).data.documents,
    fichier: (id: number) => http.get<Blob>(`/documents/${id}/fichier`, { responseType: 'blob' }),
    deposer: (donnees: FormData) => http.post<{ id: number }>('/documents', donnees),
    retirer: (id: number) => http.delete(`/documents/${id}`),
  }
}

/** Un 401 du portail : la session est finie, l'écran redemande le code. */
export const sessionPerdue = (erreur: unknown): boolean =>
  axios.isAxiosError(erreur) && erreur.response?.status === 401
