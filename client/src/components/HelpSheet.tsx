import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { Modal, ModalBody, ModalFooter, Button } from '@/components/ui'

interface HelpSheetProps {
  titre: string
  /** Cinq points maximum : au-delà, ce n'est plus une aide mais un manuel. */
  points: string[]
}

/**
 * Aide de l'écran courant.
 *
 * L'application ne comportait aucune aide : ni visite guidée, ni page d'aide,
 * ni lien de documentation — seulement des infobulles `title`, invisibles au
 * doigt. Un agent qui découvre un écran n'avait aucun moyen de comprendre à
 * quoi il sert sans demander à quelqu'un.
 */
export default function HelpSheet({ titre, points }: HelpSheetProps) {
  const [ouvert, setOuvert] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        aria-label={`Aide : ${titre}`}
        title="Aide"
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100"
      >
        <HelpCircle className="h-5 w-5" />
      </button>

      <Modal isOpen={ouvert} onClose={() => setOuvert(false)} title={titre} size="sm">
        <ModalBody>
          <ul className="space-y-3">
            {points.map((point, index) => (
              <li key={index} className="flex gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-medium text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                  {index + 1}
                </span>
                <span className="text-gray-700 dark:text-gray-200">{point}</span>
              </li>
            ))}
          </ul>
        </ModalBody>
        <ModalFooter className="dark:bg-gray-900/40 dark:border-gray-700">
          <Button onClick={() => setOuvert(false)}>J'ai compris</Button>
        </ModalFooter>
      </Modal>
    </>
  )
}
