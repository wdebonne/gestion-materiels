import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, CalendarClock, Share2 } from 'lucide-react'
import { Tab, Tabs } from '@/components/ui'
import ReferentielLieux from '@/components/ReferentielLieux'
import OccupationLieux from '@/components/lieux/OccupationLieux'
import PartageAgenda from '@/components/lieux/PartageAgenda'

/**
 * Les lieux de la commune, sous leurs deux angles.
 *
 * **Référentiel** décrit ce qui existe — bâtiments, pièces, ouvrants — et c'est
 * l'écran de l'administrateur, consulté deux fois l'an.
 *
 * **Occupation** dit qui s'en sert et quand, et c'est l'écran du régisseur,
 * ouvert tous les jours.
 *
 * **Partage** donne aux uns et aux autres une adresse à coller dans leur propre
 * agenda, parce que personne n'ouvrira l'application pour vérifier qu'une salle
 * est libre s'il a déjà un agenda ailleurs.
 *
 * Les trois vivent ici plutôt que dans autant d'entrées de menu : le menu est
 * alimenté par les plugins enregistrés en base, et y ajouter une entrée
 * demanderait une migration de données pour des écrans qui se trouvent déjà là
 * où on les cherche. La section « Lieux » du module Clés est l'endroit où le
 * référentiel se tient depuis le début ; l'agenda s'y range naturellement à
 * côté.
 */
export default function GestionLieux() {
  const [onglet, setOnglet] = useState<'referentiel' | 'occupation' | 'partage'>('referentiel')

  return (
    <div className="space-y-4">
      <Tabs value={onglet} onChange={(v) => setOnglet(v as typeof onglet)}>
        <Tab
          value="referentiel"
          label="Référentiel"
          icon={<Building2 className="h-4 w-4" />}
        />
        <Tab
          value="occupation"
          label="Occupation"
          icon={<CalendarClock className="h-4 w-4" />}
        />
        <Tab value="partage" label="Partage" icon={<Share2 className="h-4 w-4" />} />
      </Tabs>

      {onglet === 'referentiel' && (
        <>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Ce référentiel se tient aussi dans{' '}
            <Link to="/settings/organisation" className="text-primary-600 hover:underline">
              Paramètres › Organisation
            </Link>
            , avec les salles, les personnes rattachées et leurs gestionnaires.
          </p>
          <ReferentielLieux />
        </>
      )}
      {onglet === 'occupation' && <OccupationLieux />}
      {onglet === 'partage' && <PartageAgenda />}
    </div>
  )
}
