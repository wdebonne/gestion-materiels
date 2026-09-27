import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Landmark } from 'lucide-react'
import { CarteModule } from '@/components/accueil/briques'
import { comptaApi } from '@/lib/comptabilite'
import CartesSuivi from './CartesSuivi'

/**
 * Le suivi comptable sur l'accueil : pour la personne aux deux casquettes,
 * inventaire et compta, tout est visible dès l'arrivée.
 */
export default function CarteComptabilite() {
  const navigate = useNavigate()
  const { data: suivi, isLoading } = useQuery({ queryKey: ['comptabilite', 'suivi'], queryFn: comptaApi.suivi })

  return (
    <CarteModule titre="Comptabilité" icone={<Landmark className="h-5 w-5" />} lien="/comptabilite" chargement={isLoading}>
      {suivi && (
        <CartesSuivi
          suivi={suivi}
          compact
          onOuvrir={(onglet) => navigate(onglet === 'import' ? '/comptabilite?onglet=ranger' : `/comptabilite?onglet=${onglet}`)}
        />
      )}
    </CarteModule>
  )
}
