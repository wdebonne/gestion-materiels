import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LifeBuoy, Plus, CircleDot, CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import api from '@/lib/api'
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, LoadingInline } from '@/components/ui'
import NouveauTicket from '@/components/tickets/NouveauTicket'

/**
 * Les demandes qui concernent ce matériel.
 *
 * C'est ce qui donne son sens au rattachement : « souci de bruit sur le Nemo »
 * apparaît enfin dans l'historique du Nemo, aux côtés de ses entretiens et de
 * ses pleins. Jusqu'ici, la demande vivait dans un autre outil, et la fiche du
 * matériel n'en savait rien — c'était la moitié de la raison pour laquelle le
 * module a été écrit ici plutôt qu'intégré à GestSup.
 *
 * Le bouton « Signaler » ouvre le formulaire avec le matériel **déjà rempli** :
 * c'est depuis la fiche qu'on constate le problème, et redemander de le
 * retrouver dans une liste serait absurde.
 *
 * La liste est bornée par la portée du lecteur. Un matériel peut porter des
 * demandes qu'on n'a pas le droit de lire — elles n'apparaissent simplement
 * pas, plutôt que d'être annoncées sans être ouvrables.
 */
export default function DemandesDuMateriel({ objectId }: { objectId: number }) {
  const [creation, setCreation] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['tickets', 'materiel', objectId],
    queryFn: async () => (await api.get(`/tickets/materiel/${objectId}`)).data,
    enabled: Boolean(objectId),
  })

  const demandes = data?.demandes ?? []
  const ouvertes = demandes.filter((d: any) => d.statut.ouvert).length

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <LifeBuoy className="w-5 h-5" />
            Demandes
            {ouvertes > 0 && (
              <Badge variant="warning" className="ml-1">
                {ouvertes} en cours
              </Badge>
            )}
          </CardTitle>
          <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setCreation(true)}>
            Signaler un problème
          </Button>
        </CardHeader>
        <CardBody>
          {isLoading ? (
            <LoadingInline />
          ) : demandes.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">
              Aucune demande n'a été ouverte sur ce matériel.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {demandes.map((d: any) => (
                <li key={d.id}>
                  <Link
                    to={`/tickets/${d.id}`}
                    className="flex items-start gap-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-2 -mx-2"
                  >
                    {d.statut.ouvert ? (
                      <CircleDot className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-600" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-900 dark:text-white truncate">{d.titre}</p>
                      <p className="text-xs text-gray-500">
                        <span className="font-mono">{d.reference}</span>
                        {d.categorie && ` · ${d.categorie}`}
                        {d.demandeur && ` · ${d.demandeur}`}
                        {' · '}
                        {new Date(String(d.creeLe).replace(' ', 'T')).toLocaleDateString('fr-FR')}
                      </p>
                    </div>
                    <Badge variant="default" className="shrink-0">
                      {d.statut.nom}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {creation && (
        <NouveauTicket
          objectIdInitial={objectId}
          onFerme={() => {
            setCreation(false)
            refetch()
          }}
        />
      )}
    </>
  )
}
