import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export default function Spinner({ size = 'md', className }: SpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  }

  return (
    <Loader2 
      className={cn("animate-spin text-primary-600 dark:text-primary-400", sizeClasses[size], className)} 
    />
  )
}

// Composant de chargement pleine page
interface LoadingScreenProps {
  message?: string
}

export function LoadingScreen({ message = 'Chargement...' }: LoadingScreenProps) {
  return (
    <div className="fixed inset-0 bg-white dark:bg-gray-900 flex flex-col items-center justify-center z-50">
      <Spinner size="lg" />
      <p className="mt-4 text-gray-600 dark:text-gray-300">{message}</p>
    </div>
  )
}

// Composant de chargement inline
export function LoadingInline({ message }: { message?: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center">
        <Spinner size="lg" />
        {message && (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{message}</p>
        )}
      </div>
    </div>
  )
}
