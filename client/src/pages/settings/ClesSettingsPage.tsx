import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, KeyRound, ExternalLink, QrCode } from 'lucide-react'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  LoadingInline,
  TextArea,
} from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { FORMATS_AVERY, qrLisible, tailleQr } from '@/lib/formatsAvery'

/**
 * Réglages du plugin Clés.
 *
 * Deux choses s'y décident, et la seconde a une conséquence physique que rien
 * d'autre dans l'application ne rend visible :
 *
 *   le **message public** — ce que lit quelqu'un qui vient de ramasser un
 *   trousseau et n'a pas de compte. C'est le seul texte de l'application écrit
 *   pour un inconnu, et il doit dire quoi faire des clés, pas ce qu'elles
 *   ouvrent ;
 *
 *   l'**adresse courte** — elle décide de la densité du QR code, donc de sa
 *   lisibilité une fois imprimé. Sur une planche L6008 de dix millimètres de
 *   haut, quelques caractères de trop rendent le carré inutilisable. Le tableau
 *   du bas montre, pour chaque planche, si le QR passe à l'adresse choisie :
 *   sans lui, on ne s'en aperçoit qu'après avoir imprimé cent étiquettes.
 */

const CLES = [
  'cle_public_titre',
  'cle_public_message',
  'cle_public_contact',
  'cle_public_base_url',
] as const

type CleReglage = (typeof CLES)[number]

export default function ClesSettingsPage() {
  const queryClient = useQueryClient()

  const [valeurs, setValeurs] = useState<Record<CleReglage, string>>({
    cle_public_titre: '',
    cle_public_message: '',
    cle_public_contact: '',
    cle_public_base_url: '',
  })

  const { data: reglages, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data.settings,
  })

  useEffect(() => {
    if (!reglages) return
    setValeurs({
      cle_public_titre: reglages.cle_public_titre ?? '',
      cle_public_message: reglages.cle_public_message ?? '',
      cle_public_contact: reglages.cle_public_contact ?? '',
      cle_public_base_url: reglages.cle_public_base_url ?? '',
    })
  }, [reglages])

  const enregistrer = useMutation({
    mutationFn: async () => api.put('/settings', { settings: valeurs }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success('Réglages enregistrés')
    },
    onError: () => toast.error('Enregistrement impossible'),
  })

  /** Longueur de l'URL telle qu'elle sera encodée dans le QR, jeton compris. */
  const longueurUrl = useMemo(() => {
    const base = valeurs.cle_public_base_url.trim().replace(/\/+$/, '')
    if (base) return `${/^https?:\/\//i.test(base) ? base : `https://${base}`}/XXXXXXXX`.length
    return `${window.location.origin}/t/XXXXXXXX`.length
  }, [valeurs.cle_public_base_url])

  if (isLoading) return <LoadingInline />

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary-600" />
              Page publique des étiquettes
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
            Ce que voit quelqu'un qui scanne l'étiquette d'un trousseau trouvé, sans compte dans
            l'application. Un agent connecté y verra en plus le détenteur et la composition.
          </p>

          <div className="space-y-4">
            <Input
              label="Titre"
              value={valeurs.cle_public_titre}
              onChange={(e) => setValeurs({ ...valeurs, cle_public_titre: e.target.value })}
              placeholder="Trousseau de clés"
            />

            <TextArea
              label="Message"
              value={valeurs.cle_public_message}
              onChange={(e) => setValeurs({ ...valeurs, cle_public_message: e.target.value })}
              rows={4}
              placeholder="Clé de la ville de Pavilly. Merci de rapporter ce trousseau à la mairie ou à la police municipale."
              hint="Dites quoi faire des clés. N'indiquez pas ce qu'elles ouvrent : cette page est lisible par tous."
            />

            <TextArea
              label="Coordonnées"
              value={valeurs.cle_public_contact}
              onChange={(e) => setValeurs({ ...valeurs, cle_public_contact: e.target.value })}
              rows={3}
              placeholder="Mairie de Pavilly — 02 35 91 22 09&#10;Place du Général de Gaulle, 76570 Pavilly"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-primary-600" />
              Adresse des QR codes
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody>
          <Input
            label="Adresse courte"
            value={valeurs.cle_public_base_url}
            onChange={(e) => setValeurs({ ...valeurs, cle_public_base_url: e.target.value })}
            placeholder="pavilly.fr/t"
            icon={<ExternalLink className="h-4 w-4" />}
            hint="Facultatif. À vide, l'adresse du serveur est utilisée. Cette adresse doit rediriger vers /t/ de l'application."
          />

          <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">
            Adresse encodée : <code className="font-mono">{longueurUrl} caractères</code>. Plus elle
            est courte, plus le QR est lisible imprimé petit.
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-600 dark:border-gray-700 dark:text-gray-300">
                  <th className="py-2 pr-3 font-medium">Planche</th>
                  <th className="py-2 pr-3 font-medium">Étiquette</th>
                  <th className="py-2 pr-3 font-medium">QR</th>
                  <th className="py-2 font-medium">Résultat</th>
                </tr>
              </thead>
              <tbody>
                {FORMATS_AVERY.map((format) => {
                  const cote = tailleQr(format)
                  const lisible = qrLisible(cote, longueurUrl)

                  return (
                    <tr key={format.ref} className="border-b border-gray-100 dark:border-gray-700/50">
                      <td className="py-2 pr-3 font-mono text-gray-900 dark:text-gray-100">
                        {format.ref}
                      </td>
                      <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">
                        {format.largeur} × {format.hauteur} mm
                      </td>
                      <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">
                        {cote.toFixed(1)} mm
                      </td>
                      <td className="py-2">
                        {lisible ? (
                          <span className="text-green-600 dark:text-green-400">QR scannable</span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">
                            Numéro seul — QR trop dense
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => enregistrer.mutate()} disabled={enregistrer.isPending}>
          <Save className="mr-2 h-4 w-4" />
          Enregistrer
        </Button>
      </div>
    </div>
  )
}
