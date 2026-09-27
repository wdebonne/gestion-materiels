import api from './api'

/**
 * La passerelle comptable, côté écran : types et appels de `/api/comptabilite`.
 * Voir `comptabilite.service.ts` pour les règles.
 */

export type GesteCompta = 'importer' | 'ranger' | 'sortir' | 'envoyer' | 'integrer' | 'regler'
export type DroitsCompta = Record<GesteCompta, boolean> & { recoitMail: boolean }
export type Couleur = 'vert' | 'orange' | 'rouge'
export type Motif = 'perdu' | 'casse' | 'vole' | 'vendu' | 'reforme' | 'don' | 'autre'

export const MOTIFS: Record<Motif, string> = {
  perdu: 'Perdu',
  casse: 'Cassé',
  vole: 'Volé',
  vendu: 'Vendu',
  reforme: 'Réformé',
  don: 'Donné',
  autre: 'Autre',
}

export const LIBELLES_GESTES: Record<GesteCompta, string> = {
  importer: 'Importer l’export Ciril',
  ranger: 'Ranger dans les catégories',
  sortir: 'Déclarer des sorties',
  envoyer: 'Envoyer les sorties à la compta',
  integrer: 'Confirmer l’intégration dans Ciril',
  regler: 'Régler le module',
}

export const AIDE_GESTES: Record<keyof DroitsCompta, string> = {
  importer: 'Déposer le fichier des immobilisations exporté de Ciril',
  ranger: 'Créer ou rattacher les objets dans les catégories — le travail de l’inventaire',
  sortir: 'Sortir un bien depuis le module (le terrain le fait depuis la fiche de l’objet)',
  envoyer: 'Envoyer tout de suite le lot du jour, ou le télécharger',
  integrer: 'Dire que le fichier reçu a été intégré dans Ciril',
  regler: 'Envoi automatique, destinataires, format du fichier',
  recoitMail: 'Reçoit chaque jour le fichier des sorties par mail',
}

export interface Sortie {
  id: number
  objectId: number
  date: string
  motif: Motif
  motifLibelle: string
  commentaire: string | null
  valeurCession: number | null
  quantite: number
  declareeLe: string
  declareePar: string | null
  exportId: number | null
  envoyeeLe: string | null
  integreeLe: string | null
  integreePar: string | null
}

export interface SortieListee extends Sortie {
  objet: string
  inventaireInterne: string | null
  localisation: string | null
  categorie: string | null
  numero: string | null
  libelle: string | null
  valeurAcquisition: number | null
}

export interface Immobilisation {
  id: number
  numero: string
  libelle: string | null
  dateAcquisition: string | null
  valeurAcquisition: number | null
  compte: string | null
  fournisseur: string | null
  numeroFacture: string | null
  affectation: string | null
  etat: 'a_ranger' | 'rangee' | 'ignoree'
  importeeLe: string
  rangeeLe: string | null
  rangeePar: string | null
  nbObjets: number
}

export interface ExportComptable {
  id: number
  origine: 'manuel' | 'automatique' | 'telechargement'
  creeLe: string
  par: string | null
  lignes: number
  nomFichier: string
  fichierDisponible: boolean
  nextcloud: 'ok' | 'echec' | 'retenu' | null
  mail: 'ok' | 'echec' | 'retenu' | null
  erreur: string | null
  envoyeLe: string | null
  integreLe: string | null
  integrePar: string | null
  integreParId: number | null
}

export interface Suivi {
  seuil: number
  aRanger: { nombre: number; plusAncien: string | null; jours: number | null; couleur: Couleur }
  aEnvoyer: {
    nombre: number
    plusAncienne: string | null
    jours: number | null
    prochainEnvoi: string | null
    echec: { le: string; erreur: string } | null
    couleur: Couleur
  }
  horsCompta: number
  aIntegrer: { envois: number; biens: number; plusAncien: string | null; jours: number | null; couleur: Couleur }
  dernierImport: { le: string; par: string | null; lignes: number; creees: number; misesAJour: number; jours: number | null } | null
  mouvements: { id: number; action: string; details: string; le: string; par: string | null }[]
}

export type ColonneExport = string

export interface ReglagesCompta {
  envoi: {
    frequence: 'quotidien' | 'hebdomadaire' | 'manuel'
    heure: number
    jour: number
    nextcloud: { actif: boolean; dossier: string }
    mail: { actif: boolean; adresses: string }
  }
  format: {
    extension: 'csv' | 'xlsx'
    separateur: ';' | ',' | '\t'
    encodage: 'utf8' | 'windows-1252'
    formatDate: 'jj/mm/aaaa' | 'aaaa-mm-jj'
    colonnes: ColonneExport[]
    codesMotif: Record<Motif, string>
  }
  seuilRetardJours: number
}

export interface Bien {
  id: number
  nom: string
  statut: string
  localisation: string | null
  inventaireInterne: string | null
  categorie: string | null
  sousCategorie: string | null
  immobilisation: { id: number; numero: string; libelle: string | null; valeur: number | null; dateAcquisition: string | null }
  sortie: { date: string; motif: Motif; motifLibelle: string; envoyeeLe: string | null; integreeLe: string | null } | null
}

export interface ResultatLot {
  exportId: number | null
  lignes: number
  nomFichier: string | null
  nextcloud: 'ok' | 'echec' | 'retenu' | null
  mail: 'ok' | 'echec' | 'retenu' | null
  erreurs: string[]
  envoye: boolean
}

export interface SaisieSortie {
  date: string
  motif: Motif | ''
  commentaire: string
  valeurCession: string
  quantite?: string
}

const multipart = { headers: { 'Content-Type': 'multipart/form-data' } }

export const comptaApi = {
  mesDroits: async () =>
    (await api.get<{ droits: DroitsCompta; estAdmin: boolean; colonnes: Record<string, string> }>('/comptabilite/mes-droits')).data,
  suivi: async () => (await api.get<{ suivi: Suivi }>('/comptabilite/suivi')).data.suivi,
  immobilisations: async (params: { etat?: string; recherche?: string; page?: number; limite?: number }) =>
    (
      await api.get<{ total: number; page: number; limite: number; immobilisations: Immobilisation[] }>('/comptabilite/immobilisations', {
        params,
      })
    ).data,
  analyser: async (fichier: File) => {
    const data = new FormData()
    data.append('file', fichier)
    return (await api.post('/comptabilite/immobilisations/analyser', data, multipart)).data.analyse
  },
  importer: async (fichier: File, correspondance: Record<string, number>) => {
    const data = new FormData()
    data.append('file', fichier)
    data.append('correspondance', JSON.stringify(correspondance))
    return (await api.post('/comptabilite/immobilisations/importer', data, multipart)).data.resultat
  },
  ranger: (saisie: { ids: number[]; categoryId?: number | null; subcategoryId?: number | null; exemplaires?: number }) =>
    api.post<{ objets: number[] }>('/comptabilite/immobilisations/ranger', saisie),
  rattacher: (immoId: number, objectId: number) => api.post(`/comptabilite/immobilisations/${immoId}/rattacher`, { objectId }),
  ignorer: (immoId: number) => api.post(`/comptabilite/immobilisations/${immoId}/ignorer`),
  retablir: (immoId: number) => api.post(`/comptabilite/immobilisations/${immoId}/retablir`),
  objetsARattacher: async (q: string) =>
    (
      await api.get<{
        objets: { id: number; nom: string; inventaireInterne: string | null; categorie: string | null; localisation: string | null; numeroComptable: string | null }[]
      }>('/comptabilite/objets-a-rattacher', { params: { q } })
    ).data.objets,
  sorties: async (filtre: string) => (await api.get<{ sorties: SortieListee[] }>('/comptabilite/sorties', { params: { filtre } })).data.sorties,
  exports: async () => (await api.get<{ exports: ExportComptable[] }>('/comptabilite/exports')).data.exports,
  envoyer: async () => (await api.post<{ resultat: ResultatLot }>('/comptabilite/envoyer')).data.resultat,
  telechargerLot: () => api.post('/comptabilite/exports', {}, { responseType: 'blob' }),
  fichier: (id: number) => api.get(`/comptabilite/exports/${id}/fichier`, { responseType: 'blob' }),
  renvoyer: async (id: number) => (await api.post<{ resultat: ResultatLot }>(`/comptabilite/exports/${id}/renvoyer`)).data.resultat,
  annulerExport: (id: number) => api.delete(`/comptabilite/exports/${id}`),
  confirmerIntegration: (id: number) => api.post(`/comptabilite/exports/${id}/integration`),
  annulerIntegration: (id: number) => api.delete(`/comptabilite/exports/${id}/integration`),
  biens: async (params: { recherche?: string; sortis?: string; page?: number }) =>
    (await api.get<{ total: number; biens: Bien[] }>('/comptabilite/biens', { params })).data,
  bien: async (id: number) => (await api.get<{ bien: any }>(`/comptabilite/biens/${id}`)).data.bien,
  sortirBien: (id: number, saisie: SaisieSortie) => api.post(`/comptabilite/biens/${id}/sortie`, versCorps(saisie)),
  annulerSortieBien: (id: number) => api.delete(`/comptabilite/biens/${id}/sortie`),
  reglages: async () =>
    (await api.get<{ reglages: ReglagesCompta; nextcloudConfigure: boolean; smtpConfigure: boolean }>('/comptabilite/reglages')).data,
  enregistrerReglages: async (reglages: Partial<ReglagesCompta>) =>
    (await api.put<{ reglages: ReglagesCompta }>('/comptabilite/reglages', reglages)).data.reglages,
  testerEnvoi: async () => (await api.post<{ resultat: ResultatLot }>('/comptabilite/envoi/tester')).data.resultat,
}

/** Sortie depuis la fiche de l'objet : la route du terrain. */
export const sortieObjetApi = {
  sortir: (objectId: number, saisie: SaisieSortie) => api.post(`/objects/${objectId}/sortie`, versCorps(saisie)),
  annuler: (objectId: number) => api.delete(`/objects/${objectId}/sortie`),
}

function versCorps(saisie: SaisieSortie) {
  return {
    date: saisie.date,
    motif: saisie.motif,
    commentaire: saisie.commentaire || null,
    valeurCession: saisie.valeurCession || null,
    quantite: saisie.quantite || null,
  }
}

// ------------------------------------------------------------------ dates

/** « 2026-09-27 » ou « 2026-09-27 18:10:00 » → « 27/09/2026 ». */
export function jourFr(valeur: string | null | undefined): string {
  if (!valeur) return '—'
  const m = String(valeur).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(valeur)
}

/** « 2026-09-27 18:10:00 » → « 27/09/2026 à 18:10 ». */
export function instantFr(valeur: string | null | undefined): string {
  if (!valeur) return '—'
  const m = String(valeur).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]} à ${m[4]}:${m[5]}` : jourFr(valeur)
}

/** « il y a 9 jours », « aujourd’hui », « hier ». */
export function depuis(jours: number | null | undefined): string {
  if (jours === null || jours === undefined) return ''
  if (jours <= 0) return 'aujourd’hui'
  if (jours === 1) return 'hier'
  return `il y a ${jours} jours`
}

/** Aujourd'hui en jour ISO local. */
export function aujourdhui(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function montant(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}

/** Télécharge une réponse `blob` sous le nom donné par le serveur, ou celui fourni. */
export function enregistrerBlob(reponse: { data: Blob; headers: any }, nomParDefaut: string) {
  const disposition = String(reponse.headers?.['content-disposition'] ?? '')
  const nom = disposition.match(/filename="?([^";]+)"?/)?.[1] ?? nomParDefaut
  const url = window.URL.createObjectURL(new Blob([reponse.data]))
  const lien = document.createElement('a')
  lien.href = url
  lien.setAttribute('download', nom)
  document.body.appendChild(lien)
  lien.click()
  lien.remove()
  window.URL.revokeObjectURL(url)
}
