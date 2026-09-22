import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { UserPlus, X, Users, Info } from 'lucide-react'
import api from '@/lib/api'
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, LoadingInline, Select } from '@/components/ui'
import Can from '@/components/Can'

/**
 * À qui ce matériel est attribué.
 *
 * L'attribution se règle depuis les deux bouts : la fiche d'une personne, dans
 * *Paramètres › Tickets*, et la fiche du matériel — ici. C'est le même lien, et
 * les deux entrées valent : on affecte un poste en équipant quelqu'un, et on
 * corrige en ouvrant la fiche du poste le jour où il change de bureau.
 *
 * Ce que l'attribution décide, concrètement : **le formulaire de demande ne
 * propose à chacun que le matériel qui lui est attribué**. Sans elle, signaler
 * une panne obligerait à retrouver son poste parmi trois cents, ce que personne
 * ne fait — on choisit le premier de la liste, et la demande part sur le
 * matériel d'un collègue.
 *
 * Plusieurs personnes peuvent se partager un matériel : un véhicule de service,
 * un vidéoprojecteur d'étage. C'est voulu, et cela n'a pas besoin d'être
 * arbitré — chacun signale ce qu'il constate.
 */
export default function DetenteursDuMateriel({ objectId }: { objectId: number }) {
  const queryClient = useQueryClient()
  const [aAjouter, setAAjouter] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['objects', objectId, 'detenteurs'],
    queryFn: async () => (await api.get(`/tickets/materiel/${objectId}/detenteurs`)).data,
    enabled: Boolean(objectId),
  })

  const { data: annuaire } = useQuery({
    queryKey: ['users', 'annuaire'],
    queryFn: async () => (await api.get('/users/annuaire')).data,
  })

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['objects', objectId, 'detenteurs'] })
    // La liste « mon matériel » du formulaire de demande en dépend.
    queryClient.invalidateQueries({ queryKey: ['tickets', 'materiels'] })
  }

  const attribuer = useMutation({
    mutationFn: (userId: number) =>
      api.post(`/tickets/materiel/${objectId}/detenteurs`, { userId }),
    onSuccess: () => {
      setAAjouter('')
      rafraichir()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Attribution impossible'),
  })

  const retirer = useMutation({
    mutationFn: (userId: number) => api.delete(`/tickets/materiel/${objectId}/detenteurs/${userId}`),
    onSuccess: rafraichir,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Retrait impossible'),
  })

  const detenteurs = data?.detenteurs ?? []
  const personnes = annuaire?.data ?? annuaire?.users ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5" />
          Attribué à
          {detenteurs.length > 0 && (
            <Badge variant="default" className="ml-1">
              {detenteurs.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {isLoading ? (
          <LoadingInline />
        ) : (
          <>
            {detenteurs.length === 0 ? (
              <p className="flex items-start gap-2 text-sm text-gray-500">
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                Ce matériel n'est attribué à personne. Tant qu'il ne l'est pas, il n'apparaîtra dans
                le formulaire de demande de personne — c'est ce qui évite de retrouver son poste
                parmi trois cents.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {detenteurs.map((d: any) => (
                  <li
                    key={d.userId}
                    className="inline-flex items-center gap-2 rounded-full bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-800 dark:text-gray-200"
                  >
                    {d.nom}
                    {!d.seConnecte && (
                      <span className="text-xs text-gray-400">(sans compte)</span>
                    )}
                    <Can manage>
                      <button
                        onClick={() => retirer.mutate(d.userId)}
                        className="text-gray-400 hover:text-red-600"
                        aria-label={`Retirer ${d.nom}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </Can>
                  </li>
                ))}
              </ul>
            )}

            {/* Attribuer décide de qui pourra ouvrir une demande sur ce
                matériel : le geste reste à l'encadrement. */}
            <Can manage>
              <div className="flex gap-2">
                <Select
                  value={aAjouter}
                  onChange={(e: any) => setAAjouter(e.target.value)}
                  className="flex-1"
                  options={[
                    { value: '', label: 'Attribuer à…' },
                    ...personnes
                      .filter((p: any) => !detenteurs.some((d: any) => d.userId === Number(p.id)))
                      .map((p: any) => ({
                        value: String(p.id),
                        label:
                          [p.first_name, p.last_name].filter(Boolean).join(' ').trim() ||
                          p.email ||
                          `#${p.id}`,
                      })),
                  ]}
                />
                <Button
                  icon={<UserPlus className="w-4 h-4" />}
                  disabled={!aAjouter || attribuer.isPending}
                  onClick={() => attribuer.mutate(Number(aAjouter))}
                >
                  Attribuer
                </Button>
              </div>
            </Can>
          </>
        )}
      </CardBody>
    </Card>
  )
}
