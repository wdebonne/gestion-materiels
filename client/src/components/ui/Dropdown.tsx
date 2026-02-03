import { cn } from '@/lib/utils'
import { MoreHorizontal, Edit2, Trash2, Eye, Copy, Download } from 'lucide-react'
import { useState, useRef, useEffect, ReactNode } from 'react'

interface DropdownItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  variant?: 'default' | 'danger'
  disabled?: boolean
}

interface DropdownProps {
  items: DropdownItem[]
  trigger?: ReactNode
  align?: 'left' | 'right'
  className?: string
}

export default function Dropdown({ items, trigger, align = 'right', className }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={dropdownRef} className={cn("relative", className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
      >
        {trigger || <MoreHorizontal className="w-5 h-5" />}
      </button>

      {isOpen && (
        <div className={cn(
          "absolute top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[160px]",
          align === 'right' ? 'right-0' : 'left-0'
        )}>
          {items.map((item, index) => (
            <button
              key={index}
              onClick={() => {
                item.onClick()
                setIsOpen(false)
              }}
              disabled={item.disabled}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left",
                item.variant === 'danger'
                  ? "text-red-600 hover:bg-red-50"
                  : "text-gray-700 hover:bg-gray-50",
                item.disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              {item.icon && <span className="w-4 h-4">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Raccourcis pour les icônes courantes
export const DropdownIcons = {
  view: <Eye className="w-4 h-4" />,
  edit: <Edit2 className="w-4 h-4" />,
  delete: <Trash2 className="w-4 h-4" />,
  copy: <Copy className="w-4 h-4" />,
  download: <Download className="w-4 h-4" />
}
