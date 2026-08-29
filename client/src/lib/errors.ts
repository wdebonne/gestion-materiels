import { AxiosError } from 'axios'

/**
 * Traduit une erreur (axios ou autre) en un message compréhensible par
 * un utilisateur non technicien.
 *
 * Remplace le `err.response?.data?.message || 'Erreur'` recopié dans
 * une cinquantaine de pages, qui affichait un toast noir « Erreur ».
 */

// Messages par code HTTP, formulés en langage courant
const STATUS_MESSAGES: Record<number, string> = {
  400: "Certaines informations saisies ne sont pas valides. Vérifiez le formulaire.",
  401: "Votre session a expiré. Reconnectez-vous.",
  403: "Vous n'avez pas les droits pour cette action. Contactez votre responsable.",
  404: "Cet élément n'existe plus. Il a peut-être été supprimé entre-temps.",
  409: "Cette action entre en conflit avec une donnée existante.",
  413: "Le fichier est trop volumineux.",
  422: "Certaines informations saisies ne sont pas valides. Vérifiez le formulaire.",
  429: "Trop de tentatives. Patientez une minute avant de réessayer.",
  500: "Le serveur a rencontré un problème. Réessayez dans un instant.",
  502: "Le serveur est momentanément indisponible. Réessayez dans un instant.",
  503: "Le serveur est momentanément indisponible. Réessayez dans un instant.",
  504: "Le serveur met trop de temps à répondre. Réessayez dans un instant.",
}

const NETWORK_MESSAGE =
  "Pas de connexion. Votre saisie n'a pas été envoyée."

/**
 * Un message renvoyé par le serveur n'est affichable que s'il a été écrit
 * pour un humain. On écarte les messages qui ressemblent à de la technique
 * (trace SQL, message d'exception, code d'erreur node/axios...).
 */
function isReadableServerMessage(message: unknown): message is string {
  if (typeof message !== 'string') return false

  const text = message.trim()
  if (text.length === 0 || text.length > 200) return false

  const technicalPatterns = [
    /SQLITE_/i,
    /ER_[A-Z_]+/,
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET/i,
    /Request failed with status code/i,
    /\bat\s+\w+\s+\(/,          // trace de pile
    /\b(SELECT|INSERT|UPDATE|DELETE)\s+.*\bFROM\b/i,
    /undefined is not|cannot read propert/i,
  ]

  return !technicalPatterns.some((pattern) => pattern.test(text))
}

export function getErrorMessage(error: unknown): string {
  const axiosError = error as AxiosError<{ message?: string; error?: string; errors?: unknown }>

  // Pas de réponse du tout : le réseau est coupé ou le serveur est injoignable
  if (axiosError?.isAxiosError && !axiosError.response) {
    return NETWORK_MESSAGE
  }

  const status = axiosError?.response?.status

  if (status) {
    // Un message serveur rédigé pour un humain est plus précis que le
    // message générique : on le préfère quand il est lisible.
    const serverMessage =
      axiosError.response?.data?.message ?? axiosError.response?.data?.error

    if (isReadableServerMessage(serverMessage)) {
      return serverMessage
    }

    return STATUS_MESSAGES[status] ?? "Une erreur est survenue. Réessayez."
  }

  if (error instanceof Error && isReadableServerMessage(error.message)) {
    return error.message
  }

  return "Une erreur est survenue. Réessayez."
}

/** `true` si l'échec vient d'une absence de réseau (et non d'un refus serveur). */
export function isNetworkError(error: unknown): boolean {
  const axiosError = error as AxiosError
  return Boolean(axiosError?.isAxiosError && !axiosError.response)
}

/**
 * `true` si l'intercepteur axios a déjà affiché un message pour cette erreur
 * (403 et coupure réseau). Évite un second toast identique depuis le
 * gestionnaire global des mutations.
 */
export function isReportedByInterceptor(error: unknown): boolean {
  return isNetworkError(error) || getErrorStatus(error) === 403
}

/** Code HTTP de l'erreur, ou `undefined` si la requête n'a pas abouti. */
export function getErrorStatus(error: unknown): number | undefined {
  return (error as AxiosError)?.response?.status
}
