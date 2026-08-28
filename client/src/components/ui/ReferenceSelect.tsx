import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'
import { cn } from '@/lib/utils'

interface Entree {
  id: number
  name: string
}

interface ReferenceSelectProps {
  label?: string
  hint?: string
  /** Nom retenu. On stocke le libellé, pas l'identifiant, par compatibilité. */
  value: string
  onChange: (value: string) => void
  options: Entree[]
  placeholder?: string
  required?: boolean
  /** Crée une entrée dans le référentiel. Absent = pas d'ajout possible. */
  onCreate?: (nom: string) => Promise<void>
  /** Ce que désigne le référentiel, pour les libellés (« une station »…). */
  nomSingulier?: string
}

/**
 * Choix dans un référentiel, avec ajout réservé aux gestionnaires.
 *
 * Ces champs étaient des `<input list>` : un simple champ texte avec des
 * suggestions. La valeur tapée était enregistrée telle quelle, si bien que
 * « Total Pavilly », « TOTAL Pavilly » et « total pavilly » devenaient trois
 * stations distinctes — et fragmentaient les coûts dans le module Suivi.
 */
export default function ReferenceSelect({
  label,
  hint,
  value,
  onChange,
  options,
  placeholder = 'Choisir…',
  required,
  onCreate,
  nomSingulier = 'entrée',
}: ReferenceSelectProps) {
  const { canManage } = usePermissions()
  const conteneurRef = useRef<HTMLDivElement>(null)
  const champRef = useRef<HTMLInputElement>(null)

  const [ouvert, setOuvert] = useState(false)
  const [filtre, setFiltre] = useState('')
  const [creationEnCours, setCreationEnCours] = useState(false)

  useEffect(() => {
    const auClic = (e: MouseEvent) => {
      if (conteneurRef.current && !conteneurRef.current.contains(e.target as Node)) {
        setOuvert(false)
        setFiltre('')
      }
    }
    document.addEventListener('mousedown', auClic)
    return () => document.removeEventListener('mousedown', auClic)
  }, [])

  useEffect(() => {
    if (ouvert) champRef.current?.focus()
  }, [ouvert])

  const recherche = filtre.trim().toLowerCase()
  const filtrees = recherche
    ? options.filter((o) => o.name.toLowerCase().includes(recherche))
    : options

  // Proposer la création seulement si le nom saisi n'existe pas déjà,
  // en ignorant la casse et les espaces — c'est là que naissaient les doublons.
  const existeDeja = options.some((o) => o.name.trim().toLowerCase() === recherche)
  const peutCreer = Boolean(onCreate) && canManage && recherche.length >= 2 && !existeDeja

  const choisir = (nom: string) => {
    onChange(nom)
    setOuvert(false)
    setFiltre('')
  }

  const creer = async () => {
    if (!onCreate) return
    const nom = filtre.trim()
    setCreationEnCours(true)
    try {
      await onCreate(nom)
      choisir(nom)
    } finally {
      setCreationEnCours(false)
    }
  }

  return (
    <div ref={conteneurRef} className="relative">
      {label && (
        <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}

      <button
        type="button"
        onClick={() => setOuvert(!ouvert)}
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        className={cn(
          'flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
          'border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500'
        )}
      >
        <span className={cn('truncate', !value && 'text-gray-500 dark:text-gray-400')}>
          {value || placeholder}
        </span>
        <span className="flex flex-shrink-0 items-center gap-1">
          {value && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Effacer"
              title="Effacer"
              onClick={(e) => {
                e.stopPropagation()
                onChange('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  onChange('')
                }
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-600"
            >
              <X className="h-4 w-4" />
            </span>
          )}
          <ChevronDown className={cn('h-4 w-4 text-gray-500 transition-transform', ouvert && 'rotate-180')} />
        </span>
      </button>

      {hint && <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">{hint}</p>}

      {ouvert && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
          <div className="flex items-center gap-2 border-b border-gray-200 px-3 dark:border-gray-700">
            <Search className="h-4 w-4 flex-shrink-0 text-gray-500" />
            <input
              ref={champRef}
              type="text"
              value={filtre}
              onChange={(e) => setFiltre(e.target.value)}
              placeholder={`Filtrer ou nommer ${nomSingulier}…`}
              aria-label={`Filtrer ${nomSingulier}`}
              className="min-h-[44px] flex-1 border-0 bg-transparent text-gray-900 outline-none placeholder:text-gray-500 dark:text-gray-100"
            />
          </div>

          <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
            {filtrees.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.name === value}
                  onClick={() => choisir(o.name)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 text-left text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  <span className="truncate">{o.name}</span>
                  {o.name === value && <Check className="h-4 w-4 flex-shrink-0 text-primary-600" />}
                </button>
              </li>
            ))}

            {filtrees.length === 0 && !peutCreer && (
              <li className="px-3 py-4 text-center text-gray-600 dark:text-gray-400">
                {recherche
                  ? canManage
                    ? 'Aucun résultat'
                    : `Aucun résultat. Demandez à votre responsable d'ajouter ${nomSingulier}.`
                  : `Aucune ${nomSingulier} enregistrée`}
              </li>
            )}
          </ul>

          {peutCreer && (
            <button
              type="button"
              onClick={creer}
              disabled={creationEnCours}
              className="flex min-h-[44px] w-full items-center gap-2 border-t border-gray-200 px-3 text-left font-medium text-primary-600 hover:bg-primary-50 disabled:opacity-50 dark:border-gray-700 dark:text-primary-400 dark:hover:bg-primary-900/30"
            >
              <Plus className="h-4 w-4 flex-shrink-0" />
              {creationEnCours ? 'Ajout…' : `Ajouter « ${filtre.trim()} »`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
