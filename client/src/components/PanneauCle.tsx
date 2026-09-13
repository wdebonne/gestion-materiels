import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { DoorOpen, KeyRound, Package, ArrowRight, User, Building2, MapPin } from 'lucide-react'
import api from '@/lib/api'
import { Badge, Button, Card, CardBody, LoadingInline } from '@/components/ui'
import { formatCurrency } from '@/lib/utils'

/**
 * Encart « Clé » sur la fiche d'un matériel.
 *
 * Un résumé, et un lien — pas un second écran de saisie. Les lots, les ouvrants
 * et la remise se gèrent sur la fiche dédiée, qui connaît déjà ces règles ;
 * recopier ici les mêmes formulaires donnerait deux chemins pour la même
 * écriture, qui divergeraient à la première évolution.
 *
 * L'encart répond aux trois questions qu'on se pose en arrivant depuis le parc :
 * qu'est-ce que ça ouvre, combien en reste-t-il, et qui l'a.
 */

interface Props {
  objectId: number
}

function nomDetenteur(detenteur: any): string {
  if (detenteur.holder_type === 'user') {
    return [detenteur.holder_first_name, detenteur.holder_last_name].filter(Boolean).join(' ')
  }
  if (detenteur.holder_type === 'service') return detenteur.holder_service_name || ''
  if (detenteur.holder_type === 'ouvrant') {
    return [detenteur.holder_site_name, detenteur.holder_ouvrant_name].filter(Boolean).join(' — ')
  }
  return detenteur.holder_label || ''
}

export default function PanneauCle({ objectId }: Props) {
  const { data: cle, isLoading } = useQuery<any>({
    queryKey: ['cle', objectId],
    queryFn: async () => (await api.get(`/cles/${objectId}`)).data.data,
  })

  if (isLoading) return <LoadingInline />
  if (!cle) return null

  const estLot = cle.material_type === 'lot'
  const stock = cle.stock ?? { total: 0, disponibles: 0, enTrousseaux: 0, attribueesSeules: 0 }

  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
            <KeyRound className="h-5 w-5 text-primary-600" />
            {estLot ? 'Clé ou badge' : 'Trousseau'}
          </h3>
          <Link to={`/cles/${objectId}`}>
            <Button variant="outline" size="sm">
              Gérer
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {estLot ? 'Ouvre' : 'Composition'}
          </div>
          {estLot ? (
            cle.ouvre?.length > 0 ? (
              <ul className="space-y-1">
                {cle.ouvre.map((o: any) => (
                  <li
                    key={o.id}
                    className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100"
                  >
                    <DoorOpen className="h-4 w-4 flex-shrink-0 text-gray-500" />
                    {o.est_passe ? (
                      <>
                        {o.site_name}
                        <Badge variant="info" size="sm">
                          passe
                        </Badge>
                      </>
                    ) : (
                      o.ouvrant_name
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-300">Aucun lieu renseigné.</p>
            )
          ) : cle.composition?.length > 0 ? (
            <ul className="space-y-1">
              {cle.composition.map((c: any) => (
                <li key={c.id} className="text-sm text-gray-900 dark:text-gray-100">
                  {c.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-300">Trousseau vide.</p>
          )}
        </div>

        {estLot ? (
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Stock
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">
                <span className="flex items-center gap-1">
                  <Package className="h-3.5 w-3.5" />
                  {stock.total} au total
                </span>
              </Badge>
              <Badge variant="success">{stock.disponibles} au coffre</Badge>
              {stock.enTrousseaux > 0 && (
                <Badge variant="default">{stock.enTrousseaux} en trousseaux</Badge>
              )}
            </div>
            {cle.valeur?.valeur > 0 && (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Valeur du stock : {formatCurrency(cle.valeur.valeur)}
                {cle.valeur.coutMoyen > 0 &&
                  ` · coût moyen ${formatCurrency(cle.valeur.coutMoyen)}`}
              </p>
            )}
          </div>
        ) : (
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Détention
            </div>
            {cle.detenteur ? (
              <div className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                {cle.detenteur.holder_type === 'service' ? (
                  <Building2 className="h-4 w-4 text-gray-500" />
                ) : cle.detenteur.holder_type === 'ouvrant' ? (
                  <MapPin className="h-4 w-4 text-gray-500" />
                ) : (
                  <User className="h-4 w-4 text-gray-500" />
                )}
                {nomDetenteur(cle.detenteur)}
              </div>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-300">Non attribué.</p>
            )}
          </div>
        )}

        {cle.trousseaux?.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Présente dans
            </div>
            <div className="flex flex-wrap gap-2">
              {cle.trousseaux.map((t: any) => (
                <Link key={t.id} to={`/cles/${t.id}`}>
                  <Badge variant="default">{t.reference || t.name}</Badge>
                </Link>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
