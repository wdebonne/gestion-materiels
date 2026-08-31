import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Lock } from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle, Alert, Spinner } from '@/components/ui'
import { notificationApi } from '@/lib/api'
import toast from 'react-hot-toast'

/**
 * Ce que je reçois, et ce que je peux couper.
 *
 * Les réglages n'existaient qu'au niveau du service : un agent noyé sous les
 * messages ne pouvait rien y faire sans couper aussi ses collègues.
 *
 * Une exception, et une seule : ce qui **engage** son destinataire part
 * toujours. Une approbation qu'on attend de vous bloque la manifestation tant
 * que vous n'avez pas répondu ; vous laisser la couper, c'est vous laisser
 * bloquer une manifestation sans jamais le savoir. L'écran le dit, plutôt que
 * d'afficher une case qui ne ferait rien.
 */
export default function PreferencesNotification() {
  const queryClient = useQueryClient()

  const { data: preferences = [], isLoading } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: async () => (await notificationApi.getPreferences()).data.data,
  })

  const enregistrer = useMutation({
    mutationFn: ({ event, enabled }: { event: string; enabled: boolean }) =>
      notificationApi.savePreference(event, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] })
      toast.success('Préférence enregistrée')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Bell className="w-4 h-4" /> Mes notifications de manifestation
        </CardTitle>
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Ces choix ne valent que pour vous : couper un avis ici ne le coupe pas pour vos
              collègues. Un événement laissé sans choix suit le réglage de la collectivité.
            </p>

            {preferences.map((preference) => (
              <label
                key={preference.evenement}
                className={`flex items-start gap-3 p-2 rounded ${
                  preference.engageant ? 'opacity-90' : 'hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={preference.actif}
                  disabled={preference.engageant || enregistrer.isPending}
                  onChange={(e) =>
                    enregistrer.mutate({ event: preference.evenement, enabled: e.target.checked })
                  }
                />
                <span className="min-w-0">
                  <span className="text-sm text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    {preference.libelle}
                    {preference.engageant && (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        <Lock className="w-3 h-3" /> toujours envoyé
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {preference.description}
                  </span>
                  {preference.choix === null && !preference.engageant && (
                    <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      Suit le réglage de la collectivité.
                    </span>
                  )}
                </span>
              </label>
            ))}

            <Alert type="info">
              <span className="text-sm">
                Une approbation attendue de vous ou de votre service part toujours : sans cet avis,
                vous bloqueriez une manifestation sans le savoir.
              </span>
            </Alert>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
