import { useState } from 'react'
import { AlertTriangle, MapPinned } from 'lucide-react'
import { Modal, ModalBody, ModalFooter, Button } from '@/components/ui'
import { formaterSurface } from './geometrie'
import { getImageUrl } from '@/lib/espacesVerts'
import type { ContourPropose } from './types'

/**
 * Les contours qu'OpenStreetMap connaît sous le plan qu'on vient de capturer.
 *
 * Le contour d'un parc communal est très souvent déjà cartographié, relevé sur
 * place et au mètre près. Le redessiner à la souris prend dix minutes et donne
 * un polygone moins juste. Quand la donnée existe, la proposer évite ce
 * travail — sans jamais l'imposer : elle est contribuée par des bénévoles, elle
 * peut dater d'avant les derniers travaux ou désigner le square d'à côté. C'est
 * pourquoi l'écran montre la forme avant de faire quoi que ce soit.
 *
 * Le contour retenu repart ensuite par le chemin habituel d'une zone tracée à
 * la main : même fenêtre, même qualification, même rattachement à un matériau
 * du parc. Rien de particulier n'est enregistré du fait qu'il vient d'OSM.
 */
export default function ContoursProposes({
  contours, planImage, onFermer, onRetenir,
}: {
  contours: ContourPropose[]
  planImage: string
  onFermer: () => void
  onRetenir: (contour: ContourPropose) => void
}) {
  const [choisi, setChoisi] = useState(0)
  const contour = contours[choisi]

  return (
    <Modal isOpen onClose={onFermer} title="OpenStreetMap connaît déjà ce lieu" size="lg">
      <ModalBody>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          {contours.length === 1
            ? 'Un contour est cartographié sous le plan que vous venez de créer.'
            : `${contours.length} contours sont cartographiés sous le plan que vous venez de créer.`}{' '}
          Le retenir évite de le tracer à la main. Vous pourrez le retoucher sommet par
          sommet ensuite, comme n’importe quelle zone.
        </p>

        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <div className="space-y-1.5">
            {contours.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setChoisi(i)}
                aria-pressed={i === choisi}
                className={`flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                  i === choisi
                    ? 'border-green-600 bg-green-50 dark:border-green-500 dark:bg-green-900/30'
                    : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50'
                }`}
              >
                <MapPinned className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {c.nom || `Contour sans nom (${c.nature})`}
                  </span>
                  <span className="block text-xs text-gray-600 dark:text-gray-400">
                    {c.nature} · {formaterSurface(c.surface_m2)} · {c.points.length} sommets
                  </span>
                  {c.deborde && (
                    <span className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                      Dépasse du cadre : la surface affichée est tronquée. Recadrez plus
                      large et recapturez pour l’obtenir en entier.
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>

          {/* La forme, sur le plan réel : c'est ce qui permet de reconnaître
              le parc plutôt que de faire confiance à un nom.

              `self-start` n'est pas cosmétique : sans lui la grille étire la
              colonne à la hauteur de la liste, le tracé se cale sur le cadre
              étiré et non sur l'image, et le contour débordait sous la photo
              en désignant le mauvais endroit. */}
          <div className="relative self-start overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-900">
            <img src={getImageUrl(planImage)} alt="" className="block w-full" />
            {contour && (
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full"
              >
                <polygon
                  points={contour.points.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="rgba(34,197,94,0.32)"
                  stroke="#16a34a"
                  strokeWidth="0.6"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" onClick={onFermer}>Je le tracerai moi-même</Button>
        <Button onClick={() => contour && onRetenir(contour)} disabled={!contour}>
          Retenir ce contour
        </Button>
      </ModalFooter>
    </Modal>
  )
}
