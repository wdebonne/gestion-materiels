import { useEffect, useState } from 'react'
import { Button, Modal, ModalBody, ModalFooter } from '@/components/ui'
import { aujourdhui, MOTIFS, type Motif, type SaisieSortie } from '@/lib/comptabilite'

const CLASSE_CHAMP =
  'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100'

/**
 * Sortir un objet de l'inventaire : une date, un motif, et c'est tout ce qui
 * est obligatoire. L'objet reste consultable ; s'il a un numéro comptable, sa
 * sortie part avec le prochain envoi à la compta.
 */
export default function FenetreSortie({
  ouverte,
  nomObjet,
  numeroComptable,
  quantiteMax,
  enCours,
  onFermer,
  onValider,
}: {
  ouverte: boolean
  nomObjet: string
  numeroComptable: string | null
  /** Pour un lot : combien d'unités sortent. */
  quantiteMax?: number
  enCours: boolean
  onFermer: () => void
  onValider: (saisie: SaisieSortie) => void
}) {
  const [saisie, setSaisie] = useState<SaisieSortie>({ date: aujourdhui(), motif: '', commentaire: '', valeurCession: '' })

  useEffect(() => {
    if (ouverte) setSaisie({ date: aujourdhui(), motif: '', commentaire: '', valeurCession: '', quantite: quantiteMax ? String(quantiteMax) : undefined })
  }, [ouverte, quantiteMax])

  const maj = (champs: Partial<SaisieSortie>) => setSaisie((s) => ({ ...s, ...champs }))

  return (
    <Modal isOpen={ouverte} onClose={onFermer} title="Sortir de l’inventaire">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (saisie.motif) onValider(saisie)
        }}
      >
        <ModalBody className="space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            <strong>{nomObjet}</strong> quittera les listes de l’inventaire mais restera consultable.
            {numeroComptable ? (
              <> Sa sortie partira à la compta avec le prochain envoi (immobilisation n° <strong>{numeroComptable}</strong>).</>
            ) : (
              <> Il n’a pas de numéro comptable : la compta ne sera pas prévenue.</>
            )}
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="sortie-motif" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Motif <span className="text-red-600">*</span>
              </label>
              <select
                id="sortie-motif"
                required
                value={saisie.motif}
                onChange={(e) => maj({ motif: e.target.value as Motif })}
                className={CLASSE_CHAMP}
              >
                <option value="">— choisir —</option>
                {(Object.keys(MOTIFS) as Motif[]).map((m) => (
                  <option key={m} value={m}>
                    {MOTIFS[m]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sortie-date" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Date de sortie <span className="text-red-600">*</span>
              </label>
              <input
                id="sortie-date"
                type="date"
                required
                max={aujourdhui()}
                value={saisie.date}
                onChange={(e) => maj({ date: e.target.value })}
                className={CLASSE_CHAMP}
              />
            </div>
          </div>

          {saisie.motif === 'vendu' && (
            <div>
              <label htmlFor="sortie-cession" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Prix de vente (€)
              </label>
              <input
                id="sortie-cession"
                inputMode="decimal"
                value={saisie.valeurCession}
                onChange={(e) => maj({ valeurCession: e.target.value })}
                className={CLASSE_CHAMP}
              />
            </div>
          )}

          {quantiteMax && quantiteMax > 1 && (
            <div>
              <label htmlFor="sortie-quantite" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Quantité sortie (sur {quantiteMax})
              </label>
              <input
                id="sortie-quantite"
                type="number"
                min={1}
                max={quantiteMax}
                value={saisie.quantite ?? ''}
                onChange={(e) => maj({ quantite: e.target.value })}
                className={CLASSE_CHAMP}
              />
            </div>
          )}

          <div>
            <label htmlFor="sortie-commentaire" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Commentaire
            </label>
            <textarea
              id="sortie-commentaire"
              rows={2}
              value={saisie.commentaire}
              onChange={(e) => maj({ commentaire: e.target.value })}
              placeholder="Ce qui s’est passé, qui l’a constaté…"
              className={CLASSE_CHAMP}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onFermer}>
            Annuler
          </Button>
          <Button type="submit" variant="danger" disabled={!saisie.motif || enCours}>
            {enCours ? 'Sortie en cours…' : 'Sortir de l’inventaire'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}
