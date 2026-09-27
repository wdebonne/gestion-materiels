import { useState } from 'react'
import { BarChart3, FileDown, PieChart } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button, Modal, ModalBody, ModalFooter } from '@/components/ui'
import { cn } from '@/lib/utils'
import { REPARTITIONS, type FormeGraphique, type RapportDemandes } from './commun'
import { exporterRapportTicketsPdf, type FormatRapport, type SectionRapport } from './exportPdf'

/**
 * Ce qu'on met dans le PDF, choisi avant de le produire.
 *
 * Le rapport d'une réunion de direction n'est pas celui qu'on remet au
 * responsable des bâtiments : l'un veut une page, l'autre le détail de ses
 * sites. Plutôt que trois boutons figés, une fenêtre qui dit la longueur, la
 * forme des graphiques et les sections — réglée par défaut sur ce que l'écran
 * montre, pour qu'un clic suffise dans le cas courant.
 */

const FORMATS: { value: FormatRapport; titre: string; detail: string }[] = [
  { value: 'court', titre: 'Court', detail: 'Une feuille : chiffres clés et les 5 premières lignes, sans graphique.' },
  { value: 'normal', titre: 'Normal', detail: 'Chaque section avec son graphique et ses 15 premières lignes.' },
  { value: 'complet', titre: 'Complet', detail: 'Une page par graphique, avec le tableau intégral.' },
]

const SECTIONS: { value: SectionRapport; libelle: string }[] = [
  { value: 'chiffres', libelle: 'Chiffres clés' },
  { value: 'delais', libelle: 'Délais' },
  ...REPARTITIONS.map((r) => ({ value: r.id as SectionRapport, libelle: r.titre })),
  { value: 'temps', libelle: 'Temps passé' },
]

interface Props {
  rapport: RapportDemandes
  formeEcran: FormeGraphique
  onFerme: () => void
}

export default function ExportRapportModal({ rapport, formeEcran, onFerme }: Props) {
  const [format, setFormat] = useState<FormatRapport>('normal')
  const [forme, setForme] = useState<FormeGraphique>(formeEcran)
  const [sections, setSections] = useState<SectionRapport[]>(SECTIONS.map((s) => s.value))
  const [enCours, setEnCours] = useState(false)

  const basculer = (valeur: SectionRapport) =>
    setSections((courantes) =>
      courantes.includes(valeur) ? courantes.filter((s) => s !== valeur) : [...courantes, valeur]
    )

  /** Le nombre de lignes d'une section, pour dire d'avance qu'elle sera vide. */
  const lignesDe = (valeur: SectionRapport): number | null => {
    const repartition = REPARTITIONS.find((r) => r.id === valeur)
    if (repartition) return rapport[repartition.champ].length
    if (valeur === 'temps') return rapport.tempsParCategorie.length
    return null
  }

  const produire = () => {
    setEnCours(true)
    try {
      // L'ordre du document est celui de l'écran, pas celui des coches.
      const ordonnees = SECTIONS.map((s) => s.value).filter((s) => sections.includes(s))
      exporterRapportTicketsPdf(rapport, { format, forme, sections: ordonnees })
      onFerme()
    } catch (erreur) {
      console.error(erreur)
      toast.error("Le PDF n'a pas pu être produit.")
    } finally {
      setEnCours(false)
    }
  }

  return (
    <Modal isOpen onClose={onFerme} title="Exporter le rapport en PDF" size="lg">
      <ModalBody className="space-y-6">
        {/* ------------------------------------------------ la longueur */}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-900 dark:text-white">Longueur</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {FORMATS.map((f) => (
              <label
                key={f.value}
                className={cn(
                  'cursor-pointer rounded-lg border p-3 transition-colors',
                  format === f.value
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
                )}
              >
                <input
                  type="radio"
                  name="format-rapport"
                  value={f.value}
                  checked={format === f.value}
                  onChange={() => setFormat(f.value)}
                  className="sr-only"
                />
                <span className="block text-sm font-medium text-gray-900 dark:text-white">{f.titre}</span>
                <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{f.detail}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* ------------------------------------------------- la forme */}
        <fieldset disabled={format === 'court'} className={cn(format === 'court' && 'opacity-50')}>
          <legend className="mb-2 text-sm font-medium text-gray-900 dark:text-white">
            Graphiques
            {format === 'court' && (
              <span className="ml-2 font-normal text-gray-500">— le format court n'en contient pas</span>
            )}
          </legend>
          <div className="flex gap-2">
            {(
              [
                { value: 'barres', libelle: 'Barres', icone: <BarChart3 className="h-4 w-4" /> },
                { value: 'camembert', libelle: 'Camembert', icone: <PieChart className="h-4 w-4" /> },
              ] as const
            ).map((f) => (
              <label
                key={f.value}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                  forme === f.value
                    ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                    : 'border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-300'
                )}
              >
                <input
                  type="radio"
                  name="forme-rapport"
                  value={f.value}
                  checked={forme === f.value}
                  onChange={() => setForme(f.value)}
                  className="sr-only"
                />
                {f.icone}
                {f.libelle}
              </label>
            ))}
          </div>
        </fieldset>

        {/* ----------------------------------------------- les sections */}
        <fieldset>
          <div className="mb-2 flex items-center justify-between">
            <legend className="text-sm font-medium text-gray-900 dark:text-white">Contenu</legend>
            <div className="flex gap-3 text-xs">
              <button
                type="button"
                className="text-primary-600 hover:underline dark:text-primary-400"
                onClick={() => setSections(SECTIONS.map((s) => s.value))}
              >
                Tout
              </button>
              <button
                type="button"
                className="text-primary-600 hover:underline dark:text-primary-400"
                onClick={() => setSections([])}
              >
                Rien
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            {SECTIONS.map((s) => {
              const lignes = lignesDe(s.value)
              return (
                <label key={s.value} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={sections.includes(s.value)}
                    onChange={() => basculer(s.value)}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  {s.libelle}
                  {lignes !== null && (
                    <span className="ml-auto text-xs tabular-nums text-gray-400">
                      {lignes === 0 ? 'vide' : `${lignes} ligne(s)`}
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        </fieldset>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" onClick={onFerme}>
          Annuler
        </Button>
        <Button
          icon={<FileDown className="h-4 w-4" />}
          loading={enCours}
          disabled={sections.length === 0}
          onClick={produire}
        >
          Télécharger le PDF
        </Button>
      </ModalFooter>
    </Modal>
  )
}
