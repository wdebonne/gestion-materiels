import { useState, useRef, useEffect, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Search, X, ChevronDown } from 'lucide-react'

interface Option {
  value: string | number
  label: string
}

interface AutocompleteProps {
  label?: string
  error?: string
  hint?: string
  options: Option[]
  value: string | number
  onChange: (value: string) => void
  placeholder?: string
  icon?: ReactNode
  disabled?: boolean
  className?: string
  emptyMessage?: string
}

export default function Autocomplete({
  label,
  error,
  hint,
  options,
  value,
  onChange,
  placeholder = 'Rechercher...',
  icon,
  disabled = false,
  className,
  emptyMessage = 'Aucun résultat'
}: AutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Trouver l'option sélectionnée
  const selectedOption = options.find(opt => String(opt.value) === String(value))

  // Filtrer les options selon le terme de recherche
  const filteredOptions = options.filter(option =>
    option.label.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Fermer le dropdown quand on clique à l'extérieur
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setSearchTerm('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Focus l'input quand le dropdown s'ouvre
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  const handleSelect = (option: Option) => {
    onChange(String(option.value))
    setIsOpen(false)
    setSearchTerm('')
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('')
    setSearchTerm('')
  }

  return (
    <div className={cn("w-full", className)} ref={containerRef}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">
          {label}
        </label>
      )}
      
      <div className="relative">
        {/* Bouton d'affichage / déclencheur */}
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={cn(
            "w-full flex items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-left",
            "focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none",
            "disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed",
            "transition-colors duration-200",
            error && "border-red-500 focus:border-red-500 focus:ring-red-500/20",
            isOpen && "border-primary-500 ring-2 ring-primary-500/20"
          )}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {icon && <span className="text-gray-600 dark:text-gray-300 flex-shrink-0">{icon}</span>}
            <span className={cn(
              "truncate",
              selectedOption ? "text-gray-900" : "text-gray-500"
            )}>
              {selectedOption?.label || placeholder}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {value && (
              <button
                type="button"
                onClick={handleClear}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-300 hover:text-gray-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <ChevronDown className={cn(
              "w-4 h-4 text-gray-600 transition-transform",
              isOpen && "rotate-180"
            )} />
          </div>
        </button>

        {/* Dropdown */}
        {isOpen && (
          <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
            {/* Champ de recherche */}
            <div className="p-2 border-b border-gray-100 dark:border-gray-700">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  ref={inputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Rechercher..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20"
                />
              </div>
            </div>

            {/* Liste des options */}
            <div className="max-h-60 overflow-y-auto">
              {filteredOptions.length === 0 ? (
                <div className="px-3 py-6 text-sm text-gray-500 dark:text-gray-400 text-center">
                  {emptyMessage}
                </div>
              ) : (
                filteredOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleSelect(option)}
                    className={cn(
                      "w-full px-3 py-2.5 text-sm text-left hover:bg-gray-50 transition-colors",
                      "focus:outline-none focus:bg-gray-50",
                      String(option.value) === String(value) && "bg-primary-50 text-primary-700 font-medium"
                    )}
                  >
                    {option.label}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-1.5 text-sm text-red-600">{error}</p>
      )}
      {hint && !error && (
        <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">{hint}</p>
      )}
    </div>
  )
}
