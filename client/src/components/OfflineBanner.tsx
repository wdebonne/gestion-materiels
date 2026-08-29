import { useCallback, useEffect, useState } from 'react'
import { CloudOff, Upload, WifiOff } from 'lucide-react'
import { offlineQueue, type QueuedMutation } from '@/lib/offlineQueue'
import api from '@/lib/api'
import toast from 'react-hot-toast'

/**
 * État du réseau et saisies en attente.
 *
 * Le bandeau reste affiché tant que la file n'est pas vide : c'est la
 * contrepartie du choix de laisser l'écran avancer après une saisie hors
 * réseau. Sans ce rappel permanent, l'agent croirait son travail transmis.
 */
export default function OfflineBanner() {
  const [horsLigne, setHorsLigne] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine)
  const [enAttente, setEnAttente] = useState(0)
  const [envoiEnCours, setEnvoiEnCours] = useState(false)

  const rafraichir = useCallback(async () => {
    setEnAttente(await offlineQueue.count())
  }, [])

  const envoyer = useCallback(
    async (saisie: QueuedMutation) => {
      return api.request({
        url: saisie.url,
        method: saisie.method,
        data: saisie.body,
      })
    },
    []
  )

  const vider = useCallback(async () => {
    if (envoiEnCours) return
    setEnvoiEnCours(true)
    try {
      const bilan = await offlineQueue.flush(envoyer)

      if (bilan.ok > 0) {
        toast.success(
          bilan.ok === 1 ? '1 saisie envoyée' : `${bilan.ok} saisies envoyées`
        )
      }
      if (bilan.abandonnees.length > 0) {
        toast.error(
          `${bilan.abandonnees.length} saisie(s) refusée(s) par le serveur : ${bilan.abandonnees
            .map((s) => s.label)
            .join(', ')}. À ressaisir.`,
          { duration: 10000 }
        )
      }
    } finally {
      setEnvoiEnCours(false)
      await rafraichir()
    }
  }, [envoiEnCours, envoyer, rafraichir])

  useEffect(() => {
    rafraichir()

    const auRetour = () => {
      setHorsLigne(false)
      // Le réseau revient : on tente d'écouler la file sans rien demander.
      vider()
    }
    const auDepart = () => setHorsLigne(true)

    window.addEventListener('online', auRetour)
    window.addEventListener('offline', auDepart)
    window.addEventListener('file-hors-ligne:changement', rafraichir)

    return () => {
      window.removeEventListener('online', auRetour)
      window.removeEventListener('offline', auDepart)
      window.removeEventListener('file-hors-ligne:changement', rafraichir)
    }
  }, [rafraichir, vider])

  if (!horsLigne && enAttente === 0) return null

  const couleur = horsLigne
    ? 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-900/40 dark:border-amber-700 dark:text-amber-100'
    : 'bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-100'

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-2 border-b px-4 py-2 ${couleur}`}
    >
      {horsLigne ? (
        <WifiOff className="h-5 w-5 flex-shrink-0" />
      ) : (
        <CloudOff className="h-5 w-5 flex-shrink-0" />
      )}

      <span className="flex-1 min-w-[12rem]">
        {horsLigne && 'Hors connexion. '}
        {enAttente > 0
          ? enAttente === 1
            ? '1 saisie en attente d’envoi.'
            : `${enAttente} saisies en attente d’envoi.`
          : 'Vos saisies seront conservées.'}
      </span>

      {enAttente > 0 && !horsLigne && (
        <button
          onClick={vider}
          disabled={envoiEnCours}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-current px-3 font-medium transition-colors hover:bg-white/40 disabled:opacity-50 dark:hover:bg-white/10"
        >
          <Upload className="h-4 w-4" />
          {envoiEnCours ? 'Envoi…' : 'Envoyer maintenant'}
        </button>
      )}
    </div>
  )
}
