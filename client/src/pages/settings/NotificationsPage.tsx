import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Lock, Save } from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle, Button, Alert, Spinner } from '@/components/ui'
import { notificationApi, type ReglageEvenement } from '@/lib/api'
import toast from 'react-hot-toast'

/**
 * Qui reçoit quoi, par défaut, dans la collectivité.
 *
 * Trois niveaux se superposent, et cet écran ne règle que le premier :
 *
 * 1. **ici** — pour chaque événement, quels rôles sont destinataires, et si les
 *    services rattachés à la manifestation le reçoivent ;
 * 2. le réglage de chaque service (Réglages › Services) ;
 * 3. la préférence de chaque compte (Mon profil), qui l'emporte sur tout.
 *
 * Un événement marqué « toujours envoyé » engage son destinataire : un compte ne
 * peut pas le couper pour lui-même. Le service, lui, garde la main — décider de
 * ne pas être sollicité du tout reste une décision collective assumée.
 */
export default function NotificationsPage() {
  const queryClient = useQueryClient()
  const [brouillon, setBrouillon] = useState<Record<string, ReglageEvenement> | null>(null)

  const { data: catalogue, isLoading: chargementCatalogue } = useQuery({
    queryKey: ['notification-events'],
    queryFn: async () => (await notificationApi.getEvents()).data.data,
  })

  const { data: defauts, isLoading: chargementDefauts } = useQuery({
    queryKey: ['notification-defaults'],
    queryFn: async () => (await notificationApi.getDefaults()).data.data,
  })

  // Le brouillon suit le serveur tant que rien n'a été touché : sans cela,
  // l'écran resterait vide au premier chargement.
  useEffect(() => {
    if (defauts && !brouillon) setBrouillon(defauts)
  }, [defauts, brouillon])

  const enregistrement = useMutation({
    mutationFn: () => notificationApi.saveDefaults(brouillon ?? {}),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['notification-defaults'] })
      setBrouillon(res.data.data)
      toast.success('Réglages enregistrés')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  if (chargementCatalogue || chargementDefauts || !catalogue || !brouillon) {
    return <div className="flex justify-center py-10"><Spinner /></div>
  }

  const basculerRole = (evenement: string, role: string) => {
    const actuel = brouillon[evenement] ?? { roles: [], services: true }
    const roles = actuel.roles.includes(role)
      ? actuel.roles.filter((r) => r !== role)
      : [...actuel.roles, role]
    setBrouillon({ ...brouillon, [evenement]: { ...actuel, roles } })
  }

  const basculerServices = (evenement: string) => {
    const actuel = brouillon[evenement] ?? { roles: [], services: true }
    setBrouillon({ ...brouillon, [evenement]: { ...actuel, services: !actuel.services } })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Bell className="w-5 h-5" /> Notifications des manifestations
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Qui reçoit quoi par défaut. Chacun peut ensuite ajuster pour lui-même.
          </p>
        </div>
        <Button icon={<Save className="w-4 h-4" />} loading={enregistrement.isPending}
          onClick={() => enregistrement.mutate()}>
          Enregistrer
        </Button>
      </div>

      <Alert type="info">
        <span className="text-sm">
          « Services concernés » désigne les services que la manifestation touche réellement —
          ceux dont le périmètre couvre le matériel demandé — et les observateurs. Un service qui
          n'est pas concerné ne reçoit rien, quelle que soit cette grille.
        </span>
      </Alert>

      <div className="space-y-3">
        {catalogue.events.map((evenement) => {
          const reglage = brouillon[evenement.evenement] ?? { roles: [], services: true }

          return (
            <Card key={evenement.evenement}>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  {evenement.libelle}
                  {evenement.engageant && (
                    <span className="inline-flex items-center gap-1 text-xs font-normal text-gray-500 dark:text-gray-400">
                      <Lock className="w-3 h-3" /> non coupable individuellement
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">{evenement.description}</p>

                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={reglage.services}
                    onChange={() => basculerServices(evenement.evenement)} />
                  Services concernés et observateurs
                </label>

                <div className="pt-2 border-t dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    En plus, par rôle — indépendamment des services :
                  </p>
                  <div className="flex flex-wrap gap-4">
                    {catalogue.roles.map(({ role, label }) => (
                      <label key={role} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <input type="checkbox" checked={reglage.roles.includes(role)}
                          onChange={() => basculerRole(evenement.evenement, role)} />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </CardBody>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
