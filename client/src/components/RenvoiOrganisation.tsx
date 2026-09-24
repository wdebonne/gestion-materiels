import { Link } from 'react-router-dom'
import { ArrowRight, Network } from 'lucide-react'
import { Card, CardBody } from '@/components/ui'

/**
 * « Cela se règle désormais dans Organisation. »
 *
 * Les bâtiments se tenaient dans Tickets, les services dans Manifestations :
 * ceux qui y avaient pris l'habitude y reviendront. L'onglet reste donc, et
 * les y renvoie d'un clic plutôt que de disparaître sans laisser d'adresse.
 */
export default function RenvoiOrganisation({
  onglet,
  quoi,
}: {
  onglet: 'batiments' | 'salles' | 'services'
  /** Ce qui a déménagé, dit comme dans la phrase : « Les bâtiments ». */
  quoi: string
}) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Network className="h-6 w-6 shrink-0 text-primary-600" />
        <p className="flex-1 text-sm text-gray-600 dark:text-gray-300">
          {quoi} servent à tous les modules — demandes, clés, manifestations, prêt de salles. Ils se
          gèrent désormais au même endroit, dans <strong>Paramètres › Organisation</strong>, où l'on
          peut aussi en confier la gestion à quelqu'un.
        </p>
        <Link
          to={`/settings/organisation?onglet=${onglet}`}
          className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          Ouvrir
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardBody>
    </Card>
  )
}
