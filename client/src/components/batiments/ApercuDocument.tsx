import { useEffect, useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { Button, LoadingInline } from '@/components/ui'
import { ouvrirFichier } from './ouvrirFichier'

/**
 * L'aperçu d'un document, chargé en blob.
 *
 * Un PDF s'affiche dans un cadre, une image telle quelle ; un fichier
 * bureautique ne s'affiche pas dans un navigateur, et se télécharge. L'URL
 * `blob:` est révoquée quand on change de document, pour ne pas garder en
 * mémoire tous ceux qu'on a relus dans la matinée.
 */
export default function ApercuDocument({
  cle,
  charger,
  nom,
  mime,
}: {
  /** L'identité du document : l'aperçu se recharge quand elle change. */
  cle: string | number
  charger: () => Promise<{ data: Blob }>
  nom: string
  mime: string | null
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [erreur, setErreur] = useState(false)
  const affichable = mime === 'application/pdf' || /^image\/(png|jpe?g|webp)$/.test(mime ?? '')

  useEffect(() => {
    if (!affichable) return
    let actuelle: string | null = null
    let abandonne = false
    setUrl(null)
    setErreur(false)
    charger()
      .then(({ data }) => {
        if (abandonne) return
        actuelle = URL.createObjectURL(data)
        setUrl(actuelle)
      })
      .catch(() => !abandonne && setErreur(true))
    return () => {
      abandonne = true
      if (actuelle) URL.revokeObjectURL(actuelle)
    }
    // `charger` change à chaque rendu de l'appelant : on suit le document, pas la fonction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, affichable])

  if (!affichable || erreur) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-8 text-center">
        <FileText className="w-10 h-10 text-gray-400" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {erreur ? "L'aperçu n'a pas pu être chargé." : "Ce format ne s'affiche pas dans le navigateur."}
        </p>
        <Button
          variant="secondary"
          size="sm"
          icon={<Download className="w-4 h-4" />}
          onClick={() => ouvrirFichier(charger, nom, 'telecharger')}
        >
          Télécharger {nom}
        </Button>
      </div>
    )
  }

  if (!url) return <LoadingInline />

  return mime === 'application/pdf' ? (
    <iframe title={nom} src={url} className="w-full h-[70vh] rounded-lg border border-gray-200 dark:border-gray-700" />
  ) : (
    <img src={url} alt={nom} className="max-h-[70vh] mx-auto rounded-lg border border-gray-200 dark:border-gray-700" />
  )
}
