import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ArrowLeft, User, Building2, MapPin, Briefcase } from 'lucide-react'
import api from '@/lib/api'
import { LoadingInline } from '@/components/ui'
import { formatDate } from '@/lib/utils'

/**
 * Par qui ce trousseau est-il passé.
 *
 * Une frise reprenant la forme d'`ObjectTimeline`, mais sur une seule source :
 * le registre des attributions. Chaque remise et chaque restitution y figure,
 * ce qui rend la question « qui l'avait en mars » lisible d'un coup d'œil au
 * lieu de se reconstituer de mémoire.
 *
 * Les remises encore ouvertes sont en tête et signalées : c'est la seule ligne
 * qui engage quelqu'un aujourd'hui, et elle ne doit pas se confondre avec
 * l'histoire déjà close.
 */

interface Props {
  objectId: number
}

function nomDetenteur(entree: any): string {
  if (entree.holder_type === 'user') {
    return [entree.holder_first_name, entree.holder_last_name].filter(Boolean).join(' ') || 'Agent supprimé'
  }
  if (entree.holder_type === 'service') return entree.holder_service_name || 'Service supprimé'
  if (entree.holder_type === 'ouvrant') {
    return [entree.holder_site_name, entree.holder_ouvrant_name].filter(Boolean).join(' — ') || 'Lieu supprimé'
  }
  return entree.holder_label || 'Externe'
}

function Icone({ type }: { type: string }) {
  if (type === 'service') return <Building2 className="h-4 w-4" />
  if (type === 'ouvrant') return <MapPin className="h-4 w-4" />
  if (type === 'externe') return <Briefcase className="h-4 w-4" />
  return <User className="h-4 w-4" />
}

function parQui(prenom?: string, nom?: string): string {
  const complet = [prenom, nom].filter(Boolean).join(' ')
  return complet ? ` par ${complet}` : ''
}

export default function HistoriqueCle({ objectId }: Props) {
  const { data: entrees = [], isLoading } = useQuery<any[]>({
    queryKey: ['cle-historique', objectId],
    queryFn: async () => (await api.get(`/cles/${objectId}/historique`)).data.data,
  })

  if (isLoading) return <LoadingInline />

  if (entrees.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-gray-600 dark:text-gray-300">
        Ce matériel n'a encore été remis à personne.
      </p>
    )
  }

  return (
    <ol className="space-y-3">
      {entrees.map((entree) => {
        const enCours = !entree.restitution_on

        return (
          <li
            key={entree.id}
            className={`rounded-lg border p-3 ${
              enCours
                ? 'border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-900/20'
                : 'border-gray-200 dark:border-gray-700'
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                  enCours
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                }`}
              >
                <Icone type={entree.holder_type} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {nomDetenteur(entree)}
                  </span>
                  {entree.quantity > 1 && (
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      ×{entree.quantity}
                    </span>
                  )}
                  {enCours && (
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                      en cours
                    </span>
                  )}
                </div>

                <div className="mt-1 space-y-0.5 text-sm text-gray-600 dark:text-gray-300">
                  <div className="flex items-center gap-1.5">
                    <ArrowRight className="h-3.5 w-3.5 flex-shrink-0" />
                    Remis le {formatDate(entree.remise_on)}
                    {parQui(entree.remise_by_first_name, entree.remise_by_last_name)}
                  </div>
                  {entree.restitution_on && (
                    <div className="flex items-center gap-1.5">
                      <ArrowLeft className="h-3.5 w-3.5 flex-shrink-0" />
                      Rendu le {formatDate(entree.restitution_on)}
                      {parQui(entree.restitution_by_first_name, entree.restitution_by_last_name)}
                      {entree.etat_retour ? ` · état : ${entree.etat_retour}` : ''}
                    </div>
                  )}
                </div>

                {entree.notes && (
                  <p className="mt-1.5 whitespace-pre-line text-sm text-gray-600 dark:text-gray-400">
                    {entree.notes}
                  </p>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
