import { Lock, Share2 } from 'lucide-react'

/**
 * Ce matériel part-il en manifestation ?
 *
 * Le réglage n'existait que dans Réglages › Matériel prêtable, un écran d'arbre
 * fait pour trancher en masse. Or la question se pose surtout au moment où l'on
 * crée le matériel : on sait alors très bien si le réfrigérateur part pour la
 * brocante et si le grill reste à la cuisine. Aller le régler ailleurs, plus
 * tard, c'est ne jamais le régler.
 *
 * L'écran d'arbre reste : il sert à ouvrir ou fermer une branche entière, ce
 * qu'on ne fait pas fiche par fiche. Les deux écrivent la même colonne, et le
 * même héritage à trois niveaux s'applique.
 */

export type ValeurPretable = boolean | null

const CLASSES_BASE =
  'flex-1 px-3 py-2 text-sm rounded-md border transition-colors flex items-center justify-center gap-1.5'

export default function ChoixPretable({
  valeur,
  onChange,
  /** Ce qui s'appliquerait si l'on laissait « hérité ». */
  heriteDe,
  /** Une catégorie ne peut pas hériter : c'est elle la valeur de référence. */
  sansHeritage = false,
  label = 'Disponible pour les manifestations',
}: {
  valeur: ValeurPretable
  onChange: (valeur: ValeurPretable) => void
  heriteDe?: { pretable: boolean; source: string }
  sansHeritage?: boolean
  label?: string
}) {
  const options: Array<{
    cle: string
    valeur: ValeurPretable
    libelle: string
    icone: React.ReactNode
  }> = [
    { cle: 'oui', valeur: true, libelle: 'Prêtable', icone: <Share2 className="w-4 h-4" /> },
    { cle: 'non', valeur: false, libelle: 'Non prêtable', icone: <Lock className="w-4 h-4" /> },
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

      <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
        {valeur === null && heriteDe
          ? `Suit ${heriteDe.source} : ${heriteDe.pretable ? 'prêtable' : 'non prêtable'}.`
          : 'Seul le matériel prêtable est proposé au choix dans une manifestation.'}
      </p>
    </div>
  )
}
