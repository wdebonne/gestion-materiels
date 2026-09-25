import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FileWarning, Upload } from 'lucide-react'
import { Alert, Button, LoadingInline, Modal, ModalBody, ModalFooter, Select } from '@/components/ui'
import { plansApi, type Etage } from '@/lib/api'
import { dimensionsImage, nombreDePages, pdfEnImage } from './pdfEnImage'

/**
 * Importer le plan d'un étage : une image, ou un PDF rendu en image ici même.
 *
 * Un DWG ne se lit pas dans un navigateur, et le convertir demanderait un
 * logiciel de CAO côté serveur. On le dit plutôt que d'échouer : le logiciel
 * qui l'a produit l'exporte en PDF en deux clics.
 */
export default function ImporterPlan({
  etage,
  onFermer,
  onImporte,
}: {
  etage: Etage
  onFermer: () => void
  onImporte: () => void
}) {
  const [fichier, setFichier] = useState<File | null>(null)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [rendu, setRendu] = useState<{ image: Blob; largeur: number; hauteur: number } | null>(null)
  const [apercu, setApercu] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const estDwg = !!fichier && /\.(dwg|dxf)$/i.test(fichier.name)
  const estPdf = !!fichier && (fichier.type === 'application/pdf' || /\.pdf$/i.test(fichier.name))

  // Préparer l'image à envoyer : rendue depuis le PDF, ou prise telle quelle.
  useEffect(() => {
    let abandonne = false
    setRendu(null)
    setErreur(null)
    if (!fichier || estDwg) return
    setEnCours(true)
    ;(async () => {
      try {
        if (estPdf) {
          const n = await nombreDePages(fichier)
          if (abandonne) return
          setPages(n)
          const r = await pdfEnImage(fichier, Math.min(page, n))
          if (!abandonne) setRendu(r)
        } else {
          const d = await dimensionsImage(fichier)
          if (!abandonne) setRendu({ image: fichier, ...d })
        }
      } catch {
        if (!abandonne) setErreur('Ce fichier ne se lit pas. Essayez une image PNG ou JPEG, ou un PDF.')
      } finally {
        if (!abandonne) setEnCours(false)
      }
    })()
    return () => {
      abandonne = true
    }
  }, [fichier, page, estPdf, estDwg])

  useEffect(() => {
    if (!rendu) {
      setApercu(null)
      return
    }
    const url = URL.createObjectURL(rendu.image)
    setApercu(url)
    return () => URL.revokeObjectURL(url)
  }, [rendu])

  const envoyer = async () => {
    if (!rendu || !fichier) return
    setEnvoi(true)
    try {
      const donnees = new FormData()
      const nom = estPdf ? `${fichier.name.replace(/\.pdf$/i, '')}-page${page}.png` : fichier.name
      donnees.append('plan', new File([rendu.image], nom, { type: estPdf ? 'image/png' : fichier.type }))
      donnees.append('largeur', String(rendu.largeur))
      donnees.append('hauteur', String(rendu.hauteur))
      await plansApi.deposerPlan(etage.id, donnees)
      toast.success(`Plan de « ${etage.nom} » enregistré`)
      onImporte()
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? "Le plan n'a pas pu être envoyé")
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <Modal isOpen onClose={onFermer} title={`Plan de « ${etage.nom} »`} size="lg">
      <ModalBody className="space-y-4">
        {etage.plan && (
          <Alert type="info">
            <span className="text-sm">
              Le plan actuel sera remplacé. Les pièces déjà dessinées restent en place : gardez le même
              cadrage, ou redessinez-les.
            </span>
          </Alert>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf,.pdf,.dwg,.dxf"
          onChange={(e) => {
            setPage(1)
            setFichier(e.target.files?.[0] ?? null)
          }}
          className="block w-full text-sm text-gray-700 dark:text-gray-200 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-primary-700 hover:file:bg-primary-100"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">PDF, PNG, JPEG ou WebP. Un PDF est converti en image dans votre navigateur.</p>

        {estDwg && (
          <Alert type="warning">
            <span className="flex items-start gap-2 text-sm">
              <FileWarning className="mt-0.5 h-4 w-4 flex-shrink-0" />
              Un fichier DWG ou DXF ne se lit pas dans le navigateur. Exportez-le en PDF depuis votre
              logiciel de dessin (dans AutoCAD : Tracer, imprimante « DWG To PDF »), puis importez le PDF.
            </span>
          </Alert>
        )}

        {estPdf && pages > 1 && (
          <Select
            label="Page du PDF"
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
            options={Array.from({ length: pages }, (_, i) => ({ value: i + 1, label: `Page ${i + 1}` }))}
          />
        )}

        {erreur && (
          <Alert type="error">
            <span className="text-sm">{erreur}</span>
          </Alert>
        )}
        {enCours && <LoadingInline />}
        {apercu && !enCours && (
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
            <img src={apercu} alt="Aperçu du plan" className="w-full" />
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onFermer} disabled={envoi}>
          Annuler
        </Button>
        <Button icon={<Upload className="h-4 w-4" />} onClick={envoyer} loading={envoi} disabled={!rendu || enCours}>
          Enregistrer le plan
        </Button>
      </ModalFooter>
    </Modal>
  )
}
