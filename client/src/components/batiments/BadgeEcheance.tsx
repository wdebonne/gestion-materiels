import { Badge } from '@/components/ui'
import type { EtatSuivi } from '@/lib/api'
import { delaiRelatif, jourFr, STATUTS_SUIVI } from './libelles'

/**
 * L'état d'un suivi en une pastille : « En retard », « À prévoir », « À jour ».
 *
 * L'échéance et le délai sont dans l'infobulle et, en mode détaillé, à côté :
 * « en retard » seul ne dit pas si c'est d'hier ou de l'an dernier.
 */
export default function BadgeEcheance({
  etat,
  detaille = false,
}: {
  etat: Pick<EtatSuivi, 'statut' | 'echeance' | 'joursRestants'>
  detaille?: boolean
}) {
  const { libelle, variante } = STATUTS_SUIVI[etat.statut]
  const infobulle = etat.echeance
    ? `Échéance le ${jourFr(etat.echeance)} (${delaiRelatif(etat.joursRestants)})`
    : 'Aucune échéance connue'

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge variant={variante} size="sm" title={infobulle} className="whitespace-nowrap">
        {libelle}
      </Badge>
      {detaille && etat.echeance && (
        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{delaiRelatif(etat.joursRestants)}</span>
      )}
    </span>
  )
}
