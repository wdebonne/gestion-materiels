import { AlertCircle, CheckCircle2, Info, XCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ReactNode } from 'react'

interface AlertProps {
  type?: 'info' | 'success' | 'warning' | 'error'
  title?: string
  children: ReactNode
  onClose?: () => void
  className?: string
}

export default function Alert({ type = 'info', title, children, onClose, className }: AlertProps) {
  const config = {
    info: {
      icon: Info,
      bgColor: 'bg-blue-50 dark:bg-blue-900/25',
      borderColor: 'border-blue-200 dark:border-blue-800',
      iconColor: 'text-blue-600 dark:text-blue-400',
      titleColor: 'text-blue-800 dark:text-blue-200',
      textColor: 'text-blue-700 dark:text-blue-300'
    },
    success: {
      icon: CheckCircle2,
      bgColor: 'bg-green-50 dark:bg-green-900/25',
      borderColor: 'border-green-200 dark:border-green-800',
      iconColor: 'text-green-600 dark:text-green-400',
      titleColor: 'text-green-800 dark:text-green-200',
      textColor: 'text-green-700 dark:text-green-300'
    },
    warning: {
      icon: AlertCircle,
      bgColor: 'bg-yellow-50 dark:bg-yellow-900/25',
      borderColor: 'border-yellow-200 dark:border-yellow-800',
      iconColor: 'text-yellow-600 dark:text-yellow-400',
      titleColor: 'text-yellow-800 dark:text-yellow-200',
      textColor: 'text-yellow-700 dark:text-yellow-300'
    },
    error: {
      icon: XCircle,
      bgColor: 'bg-red-50 dark:bg-red-900/25',
      borderColor: 'border-red-200 dark:border-red-800',
      iconColor: 'text-red-600 dark:text-red-400',
      titleColor: 'text-red-800 dark:text-red-200',
      textColor: 'text-red-700 dark:text-red-300'
    }
  }

  const { icon: Icon, bgColor, borderColor, iconColor, titleColor, textColor } = config[type]

  return (
    <div className={cn(
      "rounded-lg border p-4 flex gap-3",
      bgColor,
      borderColor,
      className
    )}>
      <Icon className={cn("w-5 h-5 flex-shrink-0 mt-0.5", iconColor)} />
      <div className="flex-1">
        {title && (
          <h4 className={cn("font-medium", titleColor)}>{title}</h4>
        )}
        <div className={cn("text-sm", textColor, title && "mt-1")}>
          {children}
        </div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className={cn("p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors", iconColor)}
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
