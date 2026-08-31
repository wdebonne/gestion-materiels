import { Boxes, Fingerprint } from 'lucide-react'
import { Input } from '@/components/ui'

/**
 * Un exemplaire identifié, ou un lot avec une quantité.
 *
 * Le parc ne savait compter que des **exemplaires** : ce camion-là, avec son
 * numéro de série, ses pleins et ses contrôles techniques. Cinquante chaises
 * identiques n'ont rien à faire dans ce moule — les saisir une par une donnerait
 * cinquante fiches, cinquante QR codes et cinquante historiques d'entretien pour
 * un même modèle.
 *
 * Ce que le lot perd : **carburant et contrôle technique**, qui portent sur un
 * exemplaire et non sur un modèle — on ne fait pas le plein « des chaises ». Ce
 * qu'il garde : l'**entretien**, car un lot se répare et se nettoie.
 *
 * Ce que le lot gagne : une quantité, qui devient du stock. Deux manifestations
 * se partagent cent chaises ; elles ne se partagent pas le camion. Ce qui manque
 * sur un lot est donc un avertissement chiffré, pas un refus.
 */

export type TypeMateriel = 'unique' | 'lot'

const CLASSES_BASE =
  'flex-1 px-3 py-2 text-sm rounded-md border transition-colors flex items-center justify-center gap-1.5'

export default function ChoixTypeMateriel({
  type,
  quantite,
  onChangeType,
  onChangeQuantite,
}: {
  type: TypeMateriel
  quantite: number
  onChangeType: (type: TypeMateriel) => void
  onChangeQuantite: (quantite: number) => void
}) {
  const options: Array<{
    valeur: TypeMateriel
    libelle: string
    aide: string
    icone: React.ReactNode
  }> = [
    {
      valeur: 'unique',
      libelle: 'Exemplaire unique',
      aide: 'Un matériel identifié : un véhicule, un vidéoprojecteur. Il ne peut pas être à deux endroits le même jour.',
      icone: <Fingerprint className="w-4 h-4" />,
    },
    {
      valeur: 'lot',
      libelle: 'Lot avec quantité',
      aide: 'Un modèle en plusieurs exemplaires : des chaises, des tables. Le stock réel et prévisionnel se lit sur cette fiche.',
      icone: <Boxes className="w-4 h-4" />,
    },
  ]

  const choisi = options.find((o) => o.valeur === type) ?? options[0]

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Type de matériel
      </label>
      <div className="flex gap-2">
        {options.map((option) => (
          <button
            key={option.valeur}
            type="button"
            onClick={() => onChangeType(option.valeur)}
            aria-pressed={type === option.valeur}
            className={`${CLASSES_BASE} ${
              type === option.valeur
                ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-600'
                : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            {option.icone}
            {option.libelle}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{choisi.aide}</p>

      {type === 'lot' && (
        <div className="pt-1">
          <Input
            label="Quantité détenue"
            type="number"
            inputMode="numeric"
            min={0}
            value={String(quantite)}
            onChange={(e) => onChangeQuantite(Math.max(0, parseInt(e.target.value, 10) || 0))}
            placeholder="Ex : 50"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Ce que vous possédez. Les manifestations s’y imputent : le stock restant se calcule
            à date, sans le saisir ailleurs.
          </p>
        </div>
      )}
    </div>
  )
}

/** Repère visuel, pour reconnaître un lot dans une liste. */
export function BadgeLot({ quantite, className = '' }: { quantite?: number; className?: string }) {
  return (
    <span
      title="Lot : une quantité, dont le stock est suivi"
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 ${className}`}
    >
      <Boxes className="w-3 h-3" />
      {quantite === undefined ? 'Lot' : `Lot · ${quantite}`}
    </span>
  )
}
