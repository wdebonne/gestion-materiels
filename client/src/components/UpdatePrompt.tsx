import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, X } from 'lucide-react'

/**
 * La PWA était en `registerType: 'autoUpdate'` : elle pouvait basculer sur une
 * nouvelle version en plein milieu d'une saisie. On demande maintenant
 * confirmation, et l'agent choisit son moment.
 */
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] p-4 sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-sm">
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary-50 dark:bg-primary-900/30">
            <RefreshCw className="h-5 w-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-gray-900 dark:text-gray-100">
              Une nouvelle version est disponible
            </p>
            <p className="mt-1 text-gray-600 dark:text-gray-300">
              Terminez votre saisie en cours, puis mettez à jour.
            </p>
          </div>
          <button
            onClick={() => setNeedRefresh(false)}
            aria-label="Plus tard"
            title="Plus tard"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <button
          onClick={() => updateServiceWorker(true)}
          className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary-600 to-primary-500 px-5 font-medium text-white transition-colors hover:from-primary-700 hover:to-primary-600"
        >
          <RefreshCw className="h-5 w-5" />
          Mettre à jour maintenant
        </button>
      </div>
    </div>
  )
}
