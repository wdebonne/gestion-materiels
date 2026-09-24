import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MailX } from 'lucide-react'
import toast from 'react-hot-toast'
import { Card, CardBody } from '@/components/ui'
import api from '@/lib/api'

/**
 * Interrupteur « suspendre les envois automatiques ».
 *
 * Le serveur retient alors tout ce que les tâches planifiées et les
 * notifications enverraient — échéances de tickets, rappels de manifestation,
 * alertes. Le mot de passe oublié, l'e-mail de test et l'envoi d'une
 * sauvegarde partent quand même : ils sont demandés à l'instant par quelqu'un.
 *
 * Le chargement des données de test pose la suspension lui-même
 * (`donnees_test`), et la purge la lève.
 */

type Etat = 'false' | 'manuel' | 'donnees_test'

export const CLE_REQUETE_SUSPENSION = ['settings', 'emails_suspendus']

export function useSuspensionEmails() {
  return useQuery({
    queryKey: CLE_REQUETE_SUSPENSION,
    queryFn: async () => {
      const valeur = (await api.get('/settings')).data.settings?.emails_suspendus
      return (valeur === 'manuel' || valeur === 'donnees_test' ? valeur : 'false') as Etat
    },
  })
}

export default function SuspensionEmails({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient()
  const { data: etat = 'false' } = useSuspensionEmails()
  const suspendus = etat !== 'false'

  const basculer = useMutation({
    mutationFn: async (suspendre: boolean) =>
      api.put('/settings', { settings: { emails_suspendus: suspendre ? 'manuel' : 'false' } }),
    onSuccess: (_reponse, suspendre) => {
      queryClient.invalidateQueries({ queryKey: CLE_REQUETE_SUSPENSION })
      toast.success(suspendre ? 'Envois automatiques suspendus' : 'Envois automatiques rétablis')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Réglage non enregistré'),
  })

  const contenu = (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-start gap-3">
        <MailX className={`w-5 h-5 mt-0.5 shrink-0 ${suspendus ? 'text-orange-500' : 'text-gray-400'}`} />
        <div>
          <h4 className="font-medium text-gray-900">Suspendre les envois automatiques</h4>
          <p className="text-sm text-gray-500">
            {etat === 'donnees_test'
              ? 'Suspendus par le chargement des données de test : ils reprendront à la purge.'
              : suspendus
                ? 'Aucune notification ne part : échéances, rappels et alertes sont retenus.'
                : 'Échéances de tickets, rappels de manifestation et alertes partent normalement.'}
            {!compact && ' Le mot de passe oublié et l’e-mail de test partent toujours.'}
          </p>
        </div>
      </div>
      <label className="relative inline-flex items-center cursor-pointer shrink-0">
        <input
          type="checkbox"
          checked={suspendus}
          disabled={basculer.isPending}
          onChange={(e) => basculer.mutate(e.target.checked)}
          className="sr-only peer"
          aria-label="Suspendre les envois automatiques"
        />
        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-orange-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
      </label>
    </div>
  )

  if (compact) return <div className="p-3 bg-gray-50 rounded-lg">{contenu}</div>
  return (
    <Card>
      <CardBody>{contenu}</CardBody>
    </Card>
  )
}
