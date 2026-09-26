import { useLayoutEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Button, Input, Modal, ModalBody, ModalFooter } from '@/components/ui'
import { useFavoris } from '@/lib/accueil'

interface AjouterRaccourciProps {
  ouvert: boolean
  onFermer: () => void
  /** Le nom de l'entrée du menu qui correspond à la page, faute de mieux. */
  nomDeRepli: string
}

/**
 * Enregistre la page ouverte, filtres compris, parmi ses raccourcis.
 *
 * « Les tickets hors délai de l'école Pasteur » est une liste filtrée qu'on
 * reconstruit chaque matin en quatre clics. L'adresse la contient déjà
 * (`/tickets?moi=1&batiment=3`) : il suffit de la garder, sous un nom qu'on
 * reconnaîtra.
 */
export default function AjouterRaccourci({ ouvert, onFermer, nomDeRepli }: AjouterRaccourciProps) {
  const { pathname, search } = useLocation()
  const { ajouter } = useFavoris({ actif: ouvert })
  const [nom, setNom] = useState('')
  const [envoi, setEnvoi] = useState(false)

  // Avant l'affichage : le champ ne doit jamais apparaître vide, puis se remplir.
  useLayoutEffect(() => {
    if (!ouvert) return
    // Le titre de la page dit mieux ce qu'on regarde que l'entrée du menu :
    // « École Pasteur » plutôt que « Bâtiments ».
    const titre = document.querySelector('main h1')?.textContent?.trim()
    const base = titre || nomDeRepli
    setNom((search ? `${base} (filtré)` : base).slice(0, 120))
  }, [ouvert, nomDeRepli, search])

  const enregistrer = async () => {
    if (!nom.trim()) return
    setEnvoi(true)
    try {
      const { data } = await ajouter({ type: 'lien', url: `${pathname}${search}`, libelle: nom.trim() })
      toast.success(data.cree ? 'Raccourci ajouté à votre tableau de bord' : 'Cette page est déjà dans vos raccourcis')
      onFermer()
    } catch {
      // Le message d'erreur est affiché par le gestionnaire global des mutations.
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <Modal isOpen={ouvert} onClose={onFermer} title="Ajouter cette page à mes raccourcis" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          enregistrer()
        }}
      >
        <ModalBody className="space-y-3">
          <Input id="nom-raccourci" label="Nom du raccourci" value={nom} maxLength={120} onChange={(e) => setNom(e.target.value)} autoFocus />
          <p className="break-all text-sm text-gray-500 dark:text-gray-400">
            {pathname}
            {search}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Il apparaîtra dans « Mes favoris » sur votre tableau de bord, sur tous vos appareils.
          </p>
        </ModalBody>
        <ModalFooter className="dark:bg-gray-900/40 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onFermer}>
            Annuler
          </Button>
          <Button type="submit" loading={envoi} disabled={!nom.trim()}>
            Ajouter
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}
