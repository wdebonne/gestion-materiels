import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import api from '@/lib/api'

/**
 * Passkeys, côté navigateur.
 *
 * Chaque cérémonie se déroule en trois temps : le serveur remet un défi, le
 * navigateur le fait signer par l'appareil — empreinte, visage, code ou clé
 * USB — et le serveur vérifie la signature. Ce module tient les trois d'un
 * bloc, pour qu'aucun écran n'ait à connaître ce découpage.
 *
 * La clé privée ne quitte jamais l'appareil : rien de secret ne transite ici,
 * et rien de secret n'est stocké en face.
 */

/** Ce que l'écran de connexion sait du fournisseur. */
export interface EtatPasskeys {
  actif: boolean
  connexionSansMotDePasse: boolean
  secondFacteur: boolean
}

/** Une passkey enregistrée, telle qu'elle s'affiche dans le profil. */
export interface PasskeyEnregistree {
  id: number
  name: string | null
  transports: string[]
  synchronisee: boolean
  sauvegardee: boolean
  createdAt: string
  lastUsedAt: string | null
}

/** Second facteur à présenter : le ticket du serveur et le défi à signer. */
export interface DemandeSecondFacteur {
  ticket: string
  options: PublicKeyCredentialRequestOptionsJSON
}

/**
 * Le navigateur sait-il faire des passkeys ?
 *
 * Non sur un très vieux navigateur, et non hors contexte sécurisé : WebAuthn
 * exige https, à l'exception de localhost. Une commune qui sert son
 * application en http verra le bouton disparaître plutôt qu'échouer.
 */
export function passkeysSupportees(): boolean {
  try {
    return browserSupportsWebAuthn()
  } catch {
    return false
  }
}

/**
 * Traduit ce que le navigateur a refusé.
 *
 * Les erreurs WebAuthn sortent en anglais et parlent de « ceremony » et de
 * « credential ». Elles arrivent pourtant au moment le plus fragile — l'agent
 * vient de poser son doigt sur un lecteur — et méritent une phrase qui dit
 * quoi faire.
 */
export function messageErreurPasskey(erreur: any): string {
  const nom = erreur?.name ?? erreur?.cause?.name

  switch (nom) {
    case 'NotAllowedError':
      // Refus explicite, fenêtre fermée, ou simplement délai dépassé : le
      // navigateur ne fait pas la différence, exprès.
      return 'Demande annulée ou expirée. Réessayez.'
    case 'InvalidStateError':
      return 'Cet appareil est déjà enregistré pour ce compte.'
    case 'NotSupportedError':
      return "Cet appareil ne gère pas le type de passkey demandé par l'administrateur."
    case 'SecurityError':
      return "Le domaine du site ne correspond pas à celui configuré pour les passkeys."
    case 'AbortError':
      return 'Demande interrompue.'
    default:
      return erreur?.response?.data?.message || erreur?.message || 'La passkey n\'a pas pu être utilisée.'
  }
}

/** État du fournisseur. Ne lève jamais : sans réponse, les passkeys sont masquées. */
export async function lireEtatPasskeys(): Promise<EtatPasskeys> {
  try {
    const { data } = await api.get('/auth/passkey/status')
    return {
      actif: !!data.actif,
      connexionSansMotDePasse: !!data.connexionSansMotDePasse,
      secondFacteur: !!data.secondFacteur,
    }
  } catch {
    return { actif: false, connexionSansMotDePasse: false, secondFacteur: false }
  }
}

/** Mes passkeys. */
export async function listerMesPasskeys(): Promise<PasskeyEnregistree[]> {
  const { data } = await api.get('/auth/passkey')
  return data.passkeys ?? []
}

/**
 * Enregistre une passkey pour le compte connecté.
 *
 * Le nom est facultatif : sans lui, le serveur en propose un d'après le type
 * d'appareil — « Cet appareil », « Clé de sécurité », « Passkey synchronisée ».
 */
export async function enregistrerPasskey(nom?: string): Promise<PasskeyEnregistree> {
  const { data: depart } = await api.post('/auth/passkey/register/options')
  const reponse = await startRegistration({ optionsJSON: depart.options })
  const { data } = await api.post('/auth/passkey/register/verify', { response: reponse, name: nom })
  return data.passkey
}

export async function renommerPasskey(id: number, nom: string): Promise<void> {
  await api.patch(`/auth/passkey/${id}`, { name: nom })
}

export async function supprimerPasskey(id: number): Promise<void> {
  await api.delete(`/auth/passkey/${id}`)
}

/**
 * Connexion sans mot de passe.
 *
 * Aucun email n'est saisi : l'appareil propose les passkeys qu'il détient pour
 * ce site, et c'est la clé présentée qui désigne le compte. Rend la même
 * charge utile que `POST /auth/login`.
 */
export async function connexionParPasskey(): Promise<any> {
  const { data: depart } = await api.post('/auth/passkey/login/options')
  const reponse: AuthenticationResponseJSON = await startAuthentication({
    optionsJSON: depart.options,
  })
  const { data } = await api.post('/auth/passkey/login/verify', { response: reponse })
  return data
}

/** Présente la passkey réclamée après un mot de passe validé. */
export async function repondreSecondFacteur(demande: DemandeSecondFacteur): Promise<any> {
  const reponse: AuthenticationResponseJSON = await startAuthentication({
    optionsJSON: demande.options,
  })
  const { data } = await api.post('/auth/passkey/2fa/verify', {
    ticket: demande.ticket,
    response: reponse,
  })
  return data
}
