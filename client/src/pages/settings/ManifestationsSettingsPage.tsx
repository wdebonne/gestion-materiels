import { useSearchParams } from 'react-router-dom'
import { CalendarDays, Inbox, Building2, PackageCheck, FileSpreadsheet } from 'lucide-react'
import { Tabs, Tab } from '@/components/ui'
import ManifestationIntakePage from './ManifestationIntakePage'
import ServicesPage from './ServicesPage'
import MaterielPretablePage from './MaterielPretablePage'
import ManifestationExportPage from './ManifestationExportPage'

/**
 * Tout ce qui règle les manifestations, au même endroit.
 *
 * Quatre entrées de menu séparées racontaient mal qu'elles décrivent un seul
 * trajet : une demande arrive, elle sollicite des services, elle ne peut porter
 * que sur du matériel prêtable, et elle finit dans un export. Les onglets
 * rendent cet ordre visible.
 */

const ONGLETS = {
  reception: { description: 'Par où les demandes entrent.' },
  services: { description: 'Qui est sollicité, et pour quel matériel.' },
  'materiel-pretable': { description: 'Ce que le parc accepte de prêter.' },
  export: { description: 'Ce qui ressort, et vers où.' },
} as const

type Onglet = keyof typeof ONGLETS

const DEFAUT: Onglet = 'reception'

export default function ManifestationsSettingsPage() {
  // L'onglet vit dans l'URL : un lien vers les services reste un lien, et le
  // retour arrière du navigateur ramène là où on était.
  const [parametres, setParametres] = useSearchParams()
  const demande = parametres.get('onglet')
  const actif: Onglet = demande && demande in ONGLETS ? (demande as Onglet) : DEFAUT

  const changer = (onglet: string) => {
    setParametres(onglet === DEFAUT ? {} : { onglet }, { replace: true })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <CalendarDays className="w-7 h-7 text-primary-600" />
          Manifestations
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">{ONGLETS[actif].description}</p>
      </div>

      <Tabs value={actif} onChange={changer}>
        <Tab value="reception" label="Réception" icon={<Inbox className="w-4 h-4" />} />
        <Tab value="services" label="Services" icon={<Building2 className="w-4 h-4" />} />
        <Tab value="materiel-pretable" label="Matériel prêtable" icon={<PackageCheck className="w-4 h-4" />} />
        <Tab value="export" label="Export" icon={<FileSpreadsheet className="w-4 h-4" />} />
      </Tabs>

      <div className="mt-6">
        {actif === 'reception' && <ManifestationIntakePage />}
        {actif === 'services' && <ServicesPage />}
        {actif === 'materiel-pretable' && <MaterielPretablePage />}
        {actif === 'export' && <ManifestationExportPage />}
      </div>
    </div>
  )
}
