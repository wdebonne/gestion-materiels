import { ConciergeBell, Package } from 'lucide-react'

/**
 * Dire si une branche du parc contient des prestations.
 *
 * Une prestation — un raccordement électrique, un débit de boissons, du
 * personnel pour une cérémonie — n'est pas un matériel : elle n'a ni numéro de
 * série, ni entretien, ni exemplaire à immobiliser. Mais elle se range là où le
 * service tient déjà ses affaires, sous sa propre catégorie.
 *
 * Le réglage existe à trois niveaux, **le plus précis l'emporte** : la catégorie
 * donne le ton, la sous-catégorie l'affine, un matériel fait exception. C'est le
 * même mécanisme que « matériel prêtable », et il est présenté pareil pour qu'on
 * n'ait pas à l'apprendre deux fois.
 *
 * « Hérite » est proposé explicitement plutôt que déduit d'une case décochée :
 * sans ce troisième état, marquer une catégorie obligerait à recocher chacune de
 * ses sous-catégories, et on ne saurait plus distinguer « non » de « je n'ai
 * rien dit ».
 */

export type ValeurPrestation = boolean | null

const CLASSES_BASE =
  'flex-1 px-3 py-2 text-sm rounded-md border transition-colors flex items-center justify-center gap-1.5'

export default function ChoixPrestation({
  valeur,
  onChange,
  /** Ce qui s'appliquerait si on laissait « hérite » — pour que le choix se fasse en connaissance de cause. */
  heriteDe,
  /** Une catégorie ne peut pas hériter : c'est elle la valeur de référence. */
  sansHeritage = false,
  label = 'Nature',
  aide,
}: {
  valeur: ValeurPrestation
  onChange: (valeur: ValeurPrestation) => void
  heriteDe?: { prestation: boolean; source: string }
  sansHeritage?: boolean
  label?: string
  aide?: string
}) {
  const options: Array<{ cle: string; valeur: ValeurPrestation; libelle: string; icone: React.ReactNode }> = [
    { cle: 'materiel', valeur: false, libelle: 'Matériel', icone: <Package className="w-4 h-4" /> },
    { cle: 'prestation', valeur: true, libelle: 'Prestation', icone: <ConciergeBell className="w-4 h-4" /> },
  ]

  if (!sansHeritage) {
    options.unshift({ cle: 'herite', valeur: null, libelle: 'Hérité', icone: null })
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        {label}
      </label>
      <div className="flex gap-2">
        {options.map((option) => {
          const actif = valeur === option.valeur
          return (
            <button
              key={option.cle}
              type="button"
              onClick={() => onChange(option.valeur)}
              aria-pressed={actif}
              className={`${CLASSES_BASE} ${
                actif
                  ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-600'
                  : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {option.icone}
              {option.libelle}
            </button>
          )
        })}
      </div>

      {valeur === null && heriteDe && (
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          Suit {heriteDe.source} : {heriteDe.prestation ? 'prestation' : 'matériel'}.
        </p>
      )}
      {aide && <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{aide}</p>}
    </div>
  )
}

/** Petit repère visuel, pour reconnaître une prestation dans une liste. */
export function BadgePrestation({ className = '' }: { className?: string }) {
  return (
    <span
      title="Prestation : un acte demandé à un service, sans stock ni exemplaire"
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 ${className}`}
    >
      <ConciergeBell className="w-3 h-3" />
      Prestation
    </span>
  )
}
