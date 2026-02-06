import { cn } from '@/lib/utils'
import { ReactNode } from 'react'

interface Tab {
  id: string
  label: string
  count?: number
}

interface TabsProps {
  tabs?: Tab[]
  activeTab?: string
  value?: string
  onChange: (tabId: string) => void
  className?: string
  children?: ReactNode
}

interface TabProps {
  value: string
  label: string
  icon?: ReactNode
  count?: number
}

// Composant Tab individuel (utilisé comme enfant de Tabs)
export function Tab({ value, label, icon, count }: TabProps) {
  // Ce composant est juste pour la déclaration, le rendu est fait par Tabs
  return null
}

export default function Tabs({ tabs, activeTab, value, onChange, className, children }: TabsProps) {
  // Si on utilise la nouvelle interface avec children
  if (children) {
    const childrenArray = Array.isArray(children) ? children : [children]
    const tabItems = childrenArray
      .filter((child: any) => child?.type === Tab)
      .map((child: any) => ({
        id: child.props.value,
        label: child.props.label,
        icon: child.props.icon,
        count: child.props.count
      }))
    
    const currentValue = value || activeTab || ''

    return (
      <div className={cn("border-b border-gray-200 overflow-x-auto scrollbar-hide", className)}>
        <nav className="flex gap-3 sm:gap-6 -mb-px min-w-max">
          {tabItems.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={cn(
                "py-3 px-1 border-b-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 sm:gap-2",
                currentValue === tab.id
                  ? "border-primary-600 text-primary-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              )}
            >
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && (
                <span className={cn(
                  "px-1.5 sm:px-2 py-0.5 rounded-full text-xs",
                  currentValue === tab.id
                    ? "bg-primary-100 text-primary-700"
                    : "bg-gray-100 text-gray-600"
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>
    )
  }

  // Interface classique avec tabs array
  const currentTab = activeTab || value || ''
  
  return (
    <div className={cn("border-b border-gray-200 overflow-x-auto scrollbar-hide", className)}>
      <nav className="flex gap-3 sm:gap-6 -mb-px min-w-max">
        {tabs?.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              "py-3 px-1 border-b-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap",
              currentTab === tab.id
                ? "border-primary-600 text-primary-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={cn(
                "ml-1.5 sm:ml-2 px-1.5 sm:px-2 py-0.5 rounded-full text-xs",
                currentTab === tab.id
                  ? "bg-primary-100 text-primary-700"
                  : "bg-gray-100 text-gray-600"
              )}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  )
}
