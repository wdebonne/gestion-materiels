import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, Loader2, Tag, Ruler } from 'lucide-react'
import { Button, Modal, ModalBody, ModalFooter, Select } from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import {
  FORMATS_AVERY,
  FORMAT_PAR_DEFAUT,
  formatParRef,
  parPlanche,
  qrLisible,
  tailleQr,
  type FormatAvery,
} from '@/lib/formatsAvery'

/**
 * Impression d'étiquettes sur planches Avery.
 *
 * L'impression existante calait deux colonnes de 52 mm sur une page A4, ce qui
 * ne correspond à aucune planche du commerce : sur de vraies étiquettes
 * autocollantes, le contenu tombait à cheval sur les découpes. Ici la grille se
 * règle sur les cotes publiées de la référence choisie.
 *
 * Le QR pointe vers la page publique du trousseau, pas vers sa fiche interne.
 * Une clé perdue est ramassée par quelqu'un qui n'a pas de compte, et c'est lui
 * que l'étiquette doit renseigner ; l'agent connecté, lui, voit en plus le
 * détenteur et la composition sur la même adresse.
 *
 * Sur les très petites planches le QR est retiré plutôt que rétréci jusqu'à
 * l'illisible : une étiquette qui porte seulement un numéro lisible vaut mieux
 * qu'une qui porte un carré que personne ne peut scanner.
 */

interface MaterielImprimable {
  id: number
  name: string
  reference?: string | null
}

interface Etiquette {
  objectId: number
  nom: string
  inventaire: string
  url: string
  qrCode: string
  ouvre: string[]
}

interface Props {
  materiels: MaterielImprimable[]
  titre?: string
  onClose: () => void
}

/** Découpe une liste en planches de la taille du format. */
function enPlanches<T>(elements: T[], parPage: number): T[][] {
  const planches: T[][] = []
  for (let i = 0; i < elements.length; i += parPage) {
    planches.push(elements.slice(i, i + parPage))
  }
  return planches
}

/** Variables CSS décrivant la géométrie d'une planche, en millimètres. */
function geometrie(format: FormatAvery, cote: number): React.CSSProperties {
  return {
    '--largeur': `${format.largeur}mm`,
    '--hauteur': `${format.hauteur}mm`,
    '--colonnes': format.colonnes,
    '--marge-haut': `${format.margeHaut}mm`,
    '--marge-gauche': `${format.margeGauche}mm`,
    '--ecart-h': `${format.ecartH}mm`,
    '--ecart-v': `${format.ecartV}mm`,
    '--qr': `${cote}mm`,
  } as React.CSSProperties
}

function Vignette({
  etiquette,
  format,
  avecQr,
}: {
  etiquette: Etiquette
  format: FormatAvery
  avecQr: boolean
}) {
  return (
    <div className="etiquette-avery" data-profil={format.profil}>
      {avecQr && <img src={etiquette.qrCode} alt="" className="etiquette-avery-qr" />}
      <div className="etiquette-avery-texte">
        <div className="etiquette-avery-inventaire">
          {etiquette.inventaire || etiquette.nom}
        </div>
        {format.profil !== 'minuscule' && etiquette.inventaire && (
          <div className="etiquette-avery-nom">{etiquette.nom}</div>
        )}
        {format.profil === 'complet' && etiquette.ouvre.length > 0 && (
          <div className="etiquette-avery-ouvre">{etiquette.ouvre.join(' · ')}</div>
        )}
      </div>
    </div>
  )
}

export default function EtiquettesAvery({ materiels, titre, onClose }: Props) {
  const [selection, setSelection] = useState<Set<number>>(() => new Set(materiels.map((m) => m.id)))
  const [refFormat, setRefFormat] = useState(FORMAT_PAR_DEFAUT)
  const [etiquettes, setEtiquettes] = useState<Etiquette[] | null>(null)
  const [calibrage, setCalibrage] = useState(false)
  const [generation, setGeneration] = useState(false)

  const format = formatParRef(refFormat)
  const cote = tailleQr(format)

  // La longueur d'URL décide de la densité du QR, donc de sa lisibilité une fois
  // imprimé petit. On la mesure sur les étiquettes réelles quand elles existent,
  // sinon sur une estimation prudente.
  const longueurUrl = useMemo(() => {
    if (!etiquettes || etiquettes.length === 0) return 40
    return Math.max(...etiquettes.map((e) => e.url.length))
  }, [etiquettes])

  const avecQr = qrLisible(cote, longueurUrl)

  const basculer = (id: number) => {
    setSelection((precedente) => {
      const suivante = new Set(precedente)
      if (suivante.has(id)) suivante.delete(id)
      else suivante.add(id)
      return suivante
    })
  }

  const lancerImpression = (planches: unknown[]) => {
    if (planches.length === 0) return
    // Laisser le navigateur peindre les images avant d'ouvrir l'aperçu.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()))
  }

  const imprimer = async () => {
    const ids = materiels.filter((m) => selection.has(m.id)).map((m) => m.id)
    if (ids.length === 0) return

    setGeneration(true)
    try {
      const res = await api.post('/cles/etiquettes', { objectIds: ids })
      const lot: Etiquette[] = res.data.data ?? []

      if (lot.length === 0) {
        toast.error('Aucune étiquette à imprimer')
        return
      }

      setCalibrage(false)
      setEtiquettes(lot)
      lancerImpression(lot)
    } catch {
      toast.error('Erreur lors de la génération des étiquettes')
    } finally {
      setGeneration(false)
    }
  }

  /**
   * Planche de contours à vide, pour vérifier le calage avant de gâcher des
   * étiquettes. Les cotes publiées varient d'un revendeur à l'autre et les
   * marges de l'imprimante s'y ajoutent : une feuille de papier ordinaire posée
   * sur la planche Avery à contre-jour règle la question en dix secondes.
   */
  const calibrer = () => {
    const vides: Etiquette[] = Array.from({ length: parPlanche(format) }, (_, i) => ({
      objectId: -i - 1,
      nom: format.ref,
      inventaire: `${i + 1}`,
      url: '',
      qrCode: '',
      ouvre: [],
    }))

    setCalibrage(true)
    setEtiquettes(vides)
    lancerImpression(vides)
  }

  const nombre = selection.size
  const planches = etiquettes ? enPlanches(etiquettes, parPlanche(format)) : []
  const apercu = planches[0] ?? []

  return (
    <>
      <Modal isOpen onClose={onClose} title="Imprimer des étiquettes" size="lg">
        <ModalBody>
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Le QR code renvoie vers la page publique : celui qui trouve un trousseau y lit la
              consigne de restitution, un agent connecté y voit le détenteur et la composition.
              {titre ? ` Matériels de « ${titre} ».` : ''}
            </p>

            <div>
              <Select
                label="Planche Avery"
                value={refFormat}
                onChange={(e) => setRefFormat(e.target.value)}
                options={FORMATS_AVERY.map((f) => ({
                  value: f.ref,
                  label: `${f.ref} — ${f.libelle}`,
                }))}
              />
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{format.usage}</p>
              {!avecQr && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  À cette taille le QR code ne serait pas scannable : seules les mentions
                  textuelles seront imprimées. Une adresse plus courte, réglée dans
                  Paramètres → Clés, permet de le rétablir.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelection(new Set(materiels.map((m) => m.id)))}
              >
                Tout sélectionner
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSelection(new Set())}>
                Tout désélectionner
              </Button>
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {nombre} sur {materiels.length} · {parPlanche(format)} par planche
              </span>
            </div>

            <div className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2 dark:border-gray-700">
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

            {apercu.length > 0 && (
              <div>
                <div className="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">
                  Aperçu de la première planche
                </div>
                {/* Réduit à 45 % pour tenir dans la modale ; l'original part
                    à l'imprimante avec ses cotes en millimètres. */}
                <div
                  className="apercu-planche mx-auto rounded border border-gray-200 dark:border-gray-700"
                  style={{ width: '94.5mm', height: '133.65mm' }}
                >
                  <div
                    className={`planche-avery ${calibrage ? 'calibrage' : ''}`}
                    style={{ ...geometrie(format, cote), transform: 'scale(0.45)', transformOrigin: 'top left' }}
                  >
                    {apercu.map((e) => (
                      <Vignette
                        key={e.objectId}
                        etiquette={e}
                        format={format}
                        avecQr={avecQr && !calibrage}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
          <Button variant="outline" onClick={calibrer}>
            <Ruler className="mr-2 h-4 w-4" />
            Planche de test
          </Button>
          <Button onClick={imprimer} disabled={nombre === 0 || generation}>
            {generation ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Printer className="mr-2 h-4 w-4" />
            )}
            {generation ? 'Génération…' : `Imprimer ${nombre} étiquette${nombre > 1 ? 's' : ''}`}
          </Button>
        </ModalFooter>
      </Modal>

      {/*
        Rendu dans `document.body` et non dans l'arbre React : la feuille
        d'impression masque tous les enfants directs de `body` sauf celui-ci, et
        un ancêtre masqué masque tout ce qu'il contient. Placée dans la modale,
        la planche se retrouverait dans `#root`, donc invisible, et la page
        sortirait blanche.
      */}
      {planches.length > 0 &&
        createPortal(
          <div className="zone-planches" aria-hidden="true">
            {planches.map((planche, index) => (
              <div
                key={index}
                className={`planche-avery ${calibrage ? 'calibrage' : ''}`}
                style={geometrie(format, cote)}
              >
                {planche.map((e) => (
                  <Vignette
                    key={e.objectId}
                    etiquette={e}
                    format={format}
                    avecQr={avecQr && !calibrage}
                  />
                ))}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}

/** Bouton d'ouverture, pour éviter de recopier l'état sur chaque page. */
export function BoutonEtiquettesAvery({
  materiels,
  titre,
}: {
  materiels: MaterielImprimable[]
  titre?: string
}) {
  const [ouvert, setOuvert] = useState(false)

  if (materiels.length === 0) return null

  return (
    <>
      <Button variant="outline" onClick={() => setOuvert(true)}>
        <Tag className="mr-2 h-4 w-4" />
        Étiquettes
      </Button>
      {ouvert && (
        <EtiquettesAvery materiels={materiels} titre={titre} onClose={() => setOuvert(false)} />
      )}
    </>
  )
}
