import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast, { Toaster } from 'react-hot-toast'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import UpdatePrompt from './components/UpdatePrompt'
import { ConfirmProvider } from './components/ui'
import { getErrorMessage, isReportedByInterceptor } from './lib/errors'
import './i18n'
import './index.css'

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** Message de succès à afficher. Sans lui, l'enregistrement reste silencieux. */
      successMessage?: string
      /** Passe à `true` pour ne pas afficher le message d'erreur automatique. */
      silentError?: boolean
    }
  }
}

const queryClient = new QueryClient({
  /**
   * Retour utilisateur global sur les écritures.
   *
   * Sans cela, les 45 `useMutation` d'EspacesVertsPage — qui n'ont ni `onError`
   * ni `toast` — enregistrent, suppriment et archivent en silence complet :
   * l'utilisateur ne sait pas si son travail a été pris en compte.
   */
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.silentError) return
      // La page gère déjà son propre message : ne pas le doubler.
      if (mutation.options.onError) return
      // L'intercepteur axios a déjà signalé les 403 et les coupures réseau.
      if (isReportedByInterceptor(error)) return
      toast.error(getErrorMessage(error))
    },
    onSuccess: (_data, _variables, _context, mutation) => {
      const message = mutation.meta?.successMessage
      if (message) toast.success(message)
    },
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
          <UpdatePrompt />
          <Toaster
            // En bas : en haut à droite, le message passait sous le pouce
            // et sous l'en-tête sur un téléphone en portrait.
            position="bottom-center"
            toastOptions={{
              duration: 4000,
              // Une erreur doit rester lisible le temps d'être lue et comprise.
              error: { duration: 7000 },
              style: {
                borderRadius: '10px',
                background: '#1e293b',
                color: '#fff',
                maxWidth: '90vw',
              },
            }}
          />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
