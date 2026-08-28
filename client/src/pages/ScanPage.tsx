import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QrCode, Search, AlertTriangle } from 'lucide-react'
import { useQrScanner, extraireIdMateriel } from '@/lib/useQrScanner'
import { Button } from '@/components/ui'
import toast from 'react-hot-toast'

/**
 * Scanner d'étiquettes.
 *
 * Le geste attendu sur le terrain : sortir le téléphone devant un véhicule ou
 * une tondeuse, viser l'étiquette, arriver sur la fiche. C'était jusqu'ici
 * impossible depuis l'application.
 */
export default function ScanPage() {
  const navigate = useNavigate()
  const [dernierCode, setDernierCode] = useState<string | null>(null)

  const { videoRef, start, stop, scanning, error, supported } = useQrScanner((valeur) => {
    const id = extraireIdMateriel(valeur)
    if (id !== null) {
      navigate(`/objects/${id}`)
      return
    }
    // Étiquette lue, mais qui ne désigne pas un matériel de cette application.
    setDernierCode(valeur)
    toast.error("Cette étiquette ne correspond à aucun matériel.")
  })

  // Démarrer dès l'ouverture : l'agent est venu pour scanner.
  useEffect(() => {
    if (supported) start()
    return stop
  }, [supported, start, stop])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
          <QrCode className="h-7 w-7 text-primary-600" />
          Scanner une étiquette
        </h1>
        <p className="mt-1 text-gray-600 dark:text-gray-300">
          Visez le QR code collé sur le matériel.
        </p>
      </div>

      {supported ? (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-black dark:border-gray-700">
          <div className="relative">
            <video
              ref={videoRef}
              playsInline
              muted
              className="aspect-[3/4] w-full object-cover sm:aspect-video"
            />
            {/* Viseur : aide à cadrer sans masquer l'image */}
            {scanning && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-48 w-48 rounded-2xl border-4 border-white/80 shadow-[0_0_0_100vmax_rgba(0,0,0,0.35)]" />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/30">
          <div className="flex gap-3">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-200">
                Ce navigateur ne sait pas lire les QR codes
              </p>
              <p className="mt-1 text-amber-800 dark:text-amber-300">
                Utilisez la recherche pour retrouver le matériel par son nom ou sa référence.
              </p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      {dernierCode && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Dernière étiquette lue : <span className="break-all">{dernierCode}</span>
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {supported && !scanning && (
          <Button size="lg" className="flex-1" onClick={start}>
            <QrCode className="mr-2 h-5 w-5" />
            Relancer le scan
          </Button>
        )}
        <Button size="lg" variant="secondary" className="flex-1" onClick={() => navigate('/categories')}>
          <Search className="mr-2 h-5 w-5" />
          Chercher sans scanner
        </Button>
      </div>
    </div>
  )
}
