import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, Loader2, QrCode } from 'lucide-react'
import { Button, Modal, ModalBody, ModalFooter } from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'

/**
 * Impression d'étiquettes QR en lot.
 *
 * `POST /api/qrcode/batch` renvoyait jusqu'à 100 étiquettes depuis toujours,
 * et n'était appelé par aucun écran : les QR codes s'imprimaient un par un,
 * depuis la fiche de chaque matériel. Étiqueter un parc de cinquante machines
 * demandait cinquante allers-retours.
 *
 * L'aperçu est rendu dans la page, dans une zone que la feuille de style
 * d'impression est seule à laisser visible. C'est plus robuste qu'une fenêtre
 * ouverte en JavaScript, que les navigateurs bloquent souvent.
 */

interface MaterielImprimable {
  id: number
  name: string
  reference?: string | null
}

interface Etiquette {
  objectId: number
  objectName: string
  reference: string
  serialNumber: string
  url: string
  qrCode: string
}

interface Props {
  materiels: MaterielImprimable[]
  titre?: string
  onClose: () => void
}

/** L'API refuse au-delà de 100 identifiants par appel. */
const TAILLE_LOT = 100

export default function QrLabelsModal({ materiels, titre, onClose }: Props) {
  const [selection, setSelection] = useState<Set<number>>(() => new Set(materiels.map((m) => m.id)))
  const [etiquettes, setEtiquettes] = useState<Etiquette[] | null>(null)
  const [generation, setGeneration] = useState(false)

  const basculer = (id: number) => {
    setSelection((precedente) => {
      const suivante = new Set(precedente)
      if (suivante.has(id)) suivante.delete(id)
      else suivante.add(id)
      return suivante
    })
  }

  const toutSelectionner = () => setSelection(new Set(materiels.map((m) => m.id)))
  const toutDeselectionner = () => setSelection(new Set())

  const imprimer = async () => {
    const ids = materiels.filter((m) => selection.has(m.id)).map((m) => m.id)
    if (ids.length === 0) return

    setGeneration(true)
    try {
      // Découpé en lots de 100 : au-delà, le serveur refuse. Étiqueter un parc
      // entier ne doit pas obliger à recommencer par tranches à la main.
      const lots: Etiquette[] = []
      for (let i = 0; i < ids.length; i += TAILLE_LOT) {
        const res = await api.post('/qrcode/batch', { objectIds: ids.slice(i, i + TAILLE_LOT) })
        lots.push(...(res.data.data ?? []))
      }

      if (lots.length === 0) {
        toast.error('Aucune étiquette à imprimer')
        return
      }

      setEtiquettes(lots)
      // Laisser le navigateur peindre les images avant d'ouvrir l'aperçu.
      requestAnimationFrame(() => requestAnimationFrame(() => window.print()))
    } catch {
      toast.error('Erreur lors de la génération des étiquettes')
    } finally {
      setGeneration(false)
    }
  }

  const nombre = selection.size

  return (
    <>
      <Modal isOpen onClose={onClose} title="Imprimer les étiquettes QR" size="lg">
        <ModalBody>
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Chaque étiquette porte le QR code du matériel, son nom et sa référence.
              Scanner l'étiquette ouvre directement sa fiche.
              {titre ? ` Matériels de « ${titre} ».` : ''}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={toutSelectionner}>Tout sélectionner</Button>
              <Button size="sm" variant="outline" onClick={toutDeselectionner}>Tout désélectionner</Button>
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {nombre} sur {materiels.length}
              </span>
            </div>

            <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2 dark:border-gray-700">
              {materiels.map((m) => (
                <label
                  key={m.id}
                  className="touch-target flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  <input
                    type="checkbox"
                    checked={selection.has(m.id)}
                    onChange={() => basculer(m.id)}
                    className="h-5 w-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-900 dark:text-gray-100">{m.name}</span>
                  {m.reference && (
                    <span className="text-sm text-gray-600 dark:text-gray-300">{m.reference}</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={onClose}>Fermer</Button>
          <Button onClick={imprimer} disabled={nombre === 0 || generation}>
            {generation
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <Printer className="mr-2 h-4 w-4" />}
            {generation
              ? 'Génération…'
              : `Imprimer ${nombre} étiquette${nombre > 1 ? 's' : ''}`}
          </Button>
        </ModalFooter>
      </Modal>

      {/*
        Rendu dans `document.body` et non dans l'arbre React : la feuille
        d'impression masque tous les enfants directs de `body` sauf celui-ci, et
        un ancêtre masqué masque tout ce qu'il contient. Placée dans la modale,
        la grille se retrouvait dans `#root` — donc invisible, et la page
        sortait blanche.
      */}
      {etiquettes && createPortal(
        <div className="zone-etiquettes" aria-hidden="true">
          {etiquettes.map((e) => (
            <div key={e.objectId} className="etiquette">
              <img src={e.qrCode} alt="" className="etiquette-qr" />
              <div className="etiquette-texte">
                <div className="etiquette-nom">{e.objectName}</div>
                {e.reference && <div className="etiquette-ref">{e.reference}</div>}
                {e.serialNumber && <div className="etiquette-serie">N° {e.serialNumber}</div>}
              </div>
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

/** Bouton d'ouverture, pour éviter de recopier l'état sur chaque page. */
export function BoutonEtiquettesQr({ materiels, titre }: { materiels: MaterielImprimable[]; titre?: string }) {
  const [ouvert, setOuvert] = useState(false)

  if (materiels.length === 0) return null

  return (
    <>
      <Button variant="outline" onClick={() => setOuvert(true)}>
        <QrCode className="mr-2 h-4 w-4" />
        Étiquettes QR
      </Button>
      {ouvert && (
        <QrLabelsModal materiels={materiels} titre={titre} onClose={() => setOuvert(false)} />
      )}
    </>
  )
}
