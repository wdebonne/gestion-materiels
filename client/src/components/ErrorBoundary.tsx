import { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RotateCw, Home } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Filet de dernier recours : sans cela, une erreur de rendu laisse
 * l'utilisateur devant un écran entièrement blanc, sans aucune indication.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Erreur non rattrapée :', error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  handleGoHome = () => {
    window.location.href = '/'
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
        <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-5">
            <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
          </div>

          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Un problème est survenu
          </h1>
          <p className="mt-3 text-gray-600 dark:text-gray-300">
            L'application n'a pas réussi à afficher cette page. Vos données
            enregistrées ne sont pas perdues.
          </p>

          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              onClick={this.handleRetry}
              className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-lg font-medium text-white bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-700 hover:to-primary-600 transition-colors"
            >
              <RotateCw className="w-5 h-5" />
              Réessayer
            </button>
            <button
              onClick={this.handleGoHome}
              className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-lg font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <Home className="w-5 h-5" />
              Accueil
            </button>
          </div>

          {import.meta.env.DEV && this.state.error && (
            <pre className="mt-6 p-3 text-left text-xs overflow-x-auto rounded-lg bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300">
              {this.state.error.message}
            </pre>
          )}
        </div>
      </div>
    )
  }
}
