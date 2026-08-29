import { Link, useNavigate } from 'react-router-dom'
import { Compass, ArrowLeft, Home } from 'lucide-react'

/**
 * Avant : toute URL inconnue redirigeait silencieusement vers l'accueil,
 * ce qui laissait l'utilisateur croire que son lien avait fonctionné.
 */
export default function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-md text-center">
        <div className="w-16 h-16 rounded-full bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center mx-auto mb-5">
          <Compass className="w-8 h-8 text-primary-600 dark:text-primary-400" />
        </div>

        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Cette page n'existe pas
        </h1>
        <p className="mt-3 text-gray-600 dark:text-gray-300">
          Le lien que vous avez suivi est peut-être incorrect, ou la page a été
          déplacée.
        </p>

        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-lg font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Page précédente
          </button>
          <Link
            to="/"
            className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-lg font-medium text-white bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-700 hover:to-primary-600 transition-colors"
          >
            <Home className="w-5 h-5" />
            Accueil
          </Link>
        </div>
      </div>
    </div>
  )
}
