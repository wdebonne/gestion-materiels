import { Star } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui'
import { useFavoris, type TypeFavori } from '@/lib/accueil'

interface BoutonFavoriProps {
  type: Exclude<TypeFavori, 'lien'>
  cibleId: number
  /** Ce qu'on épingle, pour l'aide et le lecteur d'écran : « ce bâtiment ». */
  quoi?: string
}

/**
 * L'étoile d'une fiche : épingler au tableau de bord, ou retirer.
 *
 * Une seule étoile pour tous les modules, et un seul endroit où les favoris se
 * retrouvent : le bloc « Mes favoris » de l'accueil, sur tous les appareils.
 */
export default function BoutonFavori({ type, cibleId, quoi = 'cette fiche' }: BoutonFavoriProps) {
  const { estFavori, ajouter, retirerCible, chargement } = useFavoris()
  const epingle = estFavori(type, cibleId)
  const libelle = epingle ? `Retirer ${quoi} de mes favoris` : `Épingler ${quoi} à mes favoris`

  const basculer = async () => {
    if (epingle) {
      retirerCible({ type, cibleId })
      return
    }
    try {
      await ajouter({ type, cibleId })
      toast.success('Ajouté à vos favoris, sur le tableau de bord')
    } catch {
      // Le message d'erreur est affiché par le gestionnaire global des mutations.
    }
  }

  return (
    <Button
      variant={epingle ? 'primary' : 'outline'}
      size="icon"
      onClick={basculer}
      disabled={chargement}
      title={libelle}
      aria-label={libelle}
      aria-pressed={epingle}
    >
      <Star className={epingle ? 'h-4 w-4 fill-current' : 'h-4 w-4'} />
    </Button>
  )
}
