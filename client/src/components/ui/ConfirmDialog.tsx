import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react'
import { AlertTriangle, HelpCircle } from 'lucide-react'
import Modal, { ModalBody, ModalFooter } from './Modal'
import Button from './Button'

export interface ConfirmOptions {
  /** Question posée, qui doit nommer l'élément concerné. */
  title: string
  /** Conséquence de l'action, en une phrase. */
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'primary'
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/**
 * Remplace `window.confirm()` : même usage (`if (await confirm(...))`),
 * mais une boîte lisible, aux couleurs de l'application, avec des boutons
 * assez grands pour être touchés avec des gants.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  const settle = useCallback((result: boolean) => {
    resolverRef.current?.(result)
    resolverRef.current = null
    setOptions(null)
  }, [])

  const isDanger = options?.variant !== 'primary'

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      <Modal
        isOpen={options !== null}
        onClose={() => settle(false)}
        size="sm"
        showCloseButton={false}
      >
        <ModalBody className="pt-6">
          <div className="flex gap-4">
            <div
              className={
                'flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ' +
                (isDanger
                  ? 'bg-red-50 dark:bg-red-900/30'
                  : 'bg-primary-50 dark:bg-primary-900/30')
              }
            >
              {isDanger ? (
                <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
              ) : (
                <HelpCircle className="w-6 h-6 text-primary-600 dark:text-primary-400" />
              )}
            </div>

            <div className="min-w-0">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {options?.title}
              </h2>
              {options?.message && (
                <p className="mt-2 text-gray-600 dark:text-gray-300">
                  {options.message}
                </p>
              )}
            </div>
          </div>
        </ModalBody>

        <ModalFooter className="dark:bg-gray-900/40 dark:border-gray-700">
          <Button variant="secondary" onClick={() => settle(false)}>
            {options?.cancelLabel ?? 'Annuler'}
          </Button>
          <Button
            variant={isDanger ? 'danger' : 'primary'}
            onClick={() => settle(true)}
            autoFocus
          >
            {options?.confirmLabel ?? (isDanger ? 'Supprimer' : 'Confirmer')}
          </Button>
        </ModalFooter>
      </Modal>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext)
  if (!confirm) {
    throw new Error('useConfirm doit être utilisé à l\'intérieur de <ConfirmProvider>')
  }
  return confirm
}
