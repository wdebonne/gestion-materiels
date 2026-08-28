import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface CardProps {
  children: ReactNode
  className?: string
  onClick?: () => void
  hoverable?: boolean
}

export default function Card({ children, className, onClick, hoverable = false }: CardProps) {
  return (
    <div
      className={cn(
        "bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden dark:bg-gray-800 dark:border-gray-700",
        hoverable && "transition-all duration-300 hover:shadow-medium hover:-translate-y-1 cursor-pointer",
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 dark:border-gray-700", className)}>
      {children}
    </div>
  )
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={cn("text-lg font-semibold text-gray-900 dark:text-gray-100", className)}>
      {children}
    </h3>
  )
}

export function CardDescription({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-sm text-gray-500 mt-1 dark:text-gray-400", className)}>
      {children}
    </p>
  )
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("px-4 sm:px-6 py-3 sm:py-4", className)}>
      {children}
    </div>
  )
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100", className)}>
      {children}
    </div>
  )
}

// Card avec image pour les catégories/objets
interface ImageCardProps {
  title: string
  description?: string
  image?: string
  icon?: ReactNode
  count?: number
  onClick?: () => void
  className?: string
}

export function ImageCard({ title, description, image, icon, count, onClick, className }: ImageCardProps) {
  return (
    <Card 
      className={cn("group", className)} 
      onClick={onClick}
      hoverable
    >
      {/* Image ou placeholder avec icône */}
      <div className="aspect-[4/3] bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden">
        {image ? (
          <img 
            src={image} 
            alt={title}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : icon ? (
          <div className="w-full h-full flex items-center justify-center text-gray-600 dark:text-gray-300">
            <div className="w-16 h-16">{icon}</div>
          </div>
        ) : null}
        
        {/* Badge compteur */}
        {count !== undefined && count > 0 && (
          <div className="absolute top-3 right-3 bg-primary-600 text-white text-xs font-medium px-2.5 py-1 rounded-full">
            {count}
          </div>
        )}
      </div>

      {/* Contenu */}
      <div className="p-4 text-center">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-primary-600 transition-colors">
          {title}
        </h3>
        {description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
            {description}
          </p>
        )}
      </div>
    </Card>
  )
}

// Stat Card pour le dashboard
interface StatCardProps {
  title: string
  value: string | number
  icon: ReactNode
  change?: {
    value: number
    type: 'increase' | 'decrease'
  }
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'emerald'
  className?: string
}

export function StatCard({ title, value, icon, change, color = 'blue', className }: StatCardProps) {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    yellow: 'bg-yellow-100 text-yellow-600',
    red: 'bg-red-100 text-red-600',
    purple: 'bg-purple-100 text-purple-600',
    emerald: 'bg-emerald-100 text-emerald-600'
  }

  return (
    <Card className={className}>
      <CardBody>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{value}</p>
            {change && (
              <div className={cn(
                "flex items-center gap-1 text-sm mt-2",
                change.type === 'increase' ? 'text-green-600' : 'text-red-600'
              )}>
                <span>{change.type === 'increase' ? '↑' : '↓'}</span>
                <span>{Math.abs(change.value)}%</span>
                <span className="text-gray-600 dark:text-gray-300">vs mois dernier</span>
              </div>
            )}
          </div>
          <div className={cn("p-3 rounded-xl", colorClasses[color])}>
            {icon}
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
