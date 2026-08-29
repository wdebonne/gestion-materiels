import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Lecture de QR code par la caméra.
 *
 * L'application savait générer des QR codes depuis le début, mais pas les lire :
 * un mécanicien devant un véhicule devait sortir de l'application, ouvrir
 * l'appareil photo, scanner, puis revenir. On utilise `BarcodeDetector`, natif
 * sur Chrome et Android — donc sans dépendance supplémentaire sur le parc type
 * d'une collectivité.
 */

/** `BarcodeDetector` n'est pas encore dans les types standard du DOM. */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>
}

declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats: string[] }): BarcodeDetectorLike
      getSupportedFormats?: () => Promise<string[]>
    }
  }
}

export function isQrScanSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.BarcodeDetector === 'function' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  )
}

function messageErreur(err: unknown): string {
  const nom = (err as DOMException)?.name
  if (nom === 'NotAllowedError') {
    return "Accès à la caméra refusé. Autorisez-le dans les réglages du navigateur."
  }
  if (nom === 'NotFoundError' || nom === 'OverconstrainedError') {
    return "Aucune caméra arrière n'a été trouvée sur cet appareil."
  }
  if (nom === 'NotReadableError') {
    return "La caméra est déjà utilisée par une autre application."
  }
  return "Impossible de démarrer la caméra."
}

export function useQrScanner(onDecode: (valeur: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fluxRef = useRef<MediaStream | null>(null)
  const boucleRef = useRef<number | null>(null)
  const decodeRef = useRef(onDecode)

  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Garde la dernière closure sans relancer la caméra à chaque rendu.
  useEffect(() => {
    decodeRef.current = onDecode
  }, [onDecode])

  const stop = useCallback(() => {
    if (boucleRef.current !== null) {
      cancelAnimationFrame(boucleRef.current)
      boucleRef.current = null
    }
    fluxRef.current?.getTracks().forEach((piste) => piste.stop())
    fluxRef.current = null
    setScanning(false)
  }, [])

  const start = useCallback(async () => {
    setError(null)

    if (!isQrScanSupported()) {
      setError("Ce navigateur ne sait pas lire les QR codes. Utilisez la recherche.")
      return
    }

    try {
      const flux = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      fluxRef.current = flux

      const video = videoRef.current
      if (!video) {
        flux.getTracks().forEach((p) => p.stop())
        return
      }

      video.srcObject = flux
      await video.play()
      setScanning(true)

      const detecteur = new window.BarcodeDetector!({ formats: ['qr_code'] })

      const analyser = async () => {
        if (!fluxRef.current || !videoRef.current) return
        try {
          const codes = await detecteur.detect(videoRef.current)
          if (codes.length > 0 && codes[0].rawValue) {
            decodeRef.current(codes[0].rawValue)
            stop()
            return
          }
        } catch {
          // Image illisible sur cette frame : on retente à la suivante.
        }
        boucleRef.current = requestAnimationFrame(analyser)
      }

      boucleRef.current = requestAnimationFrame(analyser)
    } catch (err) {
      setError(messageErreur(err))
      stop()
    }
  }, [stop])

  // Toujours relâcher la caméra en quittant l'écran.
  useEffect(() => stop, [stop])

  return { videoRef, start, stop, scanning, error, supported: isQrScanSupported() }
}

/**
 * Extrait l'identifiant de matériel d'un QR code.
 * Le serveur encode `${APP_URL}/objects/:id` (voir `qrcode.routes.ts`).
 */
export function extraireIdMateriel(valeur: string): number | null {
  const correspondance = valeur.match(/\/objects\/(\d+)/)
  if (correspondance) return Number(correspondance[1])

  // Étiquette ne contenant que le numéro
  if (/^\d+$/.test(valeur.trim())) return Number(valeur.trim())

  return null
}
