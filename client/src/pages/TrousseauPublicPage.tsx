import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { KeyRound, MapPin, User, Building2, Phone, ShieldCheck } from 'lucide-react'
import api from '@/lib/api'
import { LoadingScreen } from '@/components/ui'

/**
 * Ce que voit celui qui ramasse un trousseau.
 *
 * C'est la seule page de l'application accessible sans compte, et elle sert deux
 * publics avec la même adresse :
 *
 *   un passant lit la consigne de restitution, rédigée par l'administrateur, et
 *   rien d'autre — indiquer à qui vient de trouver une clé à qui elle appartient
 *   et ce qu'elle ouvre reviendrait à lui désigner la porte à essayer ;
 *
 *   un agent connecté et habilité voit en plus le détenteur et la composition,
 *   ce qui fait de l'étiquette un outil de tous les jours et pas seulement un
 *   filet en cas de perte.
 *
 * Le tri est fait par le serveur : cette page affiche ce qu'on lui donne. Elle
 * ne demande jamais à se connecter et ne montre aucun bouton de connexion —
 * quelqu'un qui vient de trouver des clés dans la rue n'a pas de compte, et lui
 * présenter un formulaire de connexion ferait passer la consigne au second plan.
 */

interface ReponsePublique {
  titre: string
  message: string
  contact: string
  commune: string
  logo: string
  connu: boolean
  detaille?: boolean
  materiel?: { id: number; nom: string; inventaire: string; image: string }
  detenteur?: any
  composition?: any[]
}

function nomDetenteur(detenteur: any): string {
  if (!detenteur) return ''
  if (detenteur.holder_type === 'user') {
    return [detenteur.holder_first_name, detenteur.holder_last_name].filter(Boolean).join(' ')
  }
  if (detenteur.holder_type === 'service') return detenteur.holder_service_name || ''
  if (detenteur.holder_type === 'ouvrant') {
    return [detenteur.holder_site_name, detenteur.holder_ouvrant_name].filter(Boolean).join(' — ')
  }
  return detenteur.holder_label || ''
}

export default function TrousseauPublicPage() {
  const { token } = useParams<{ token: string }>()

  const { data, isLoading } = useQuery<ReponsePublique>({
    queryKey: ['trousseau-public', token],
    queryFn: async () => {
      const res = await api.get(`/cles/public/${token}`)
      return res.data.data
    },
    // Un jeton inconnu renvoie une réponse valide : réessayer n'y changerait
    // rien et ferait patienter devant un écran vide.
    retry: false,
  })

  if (isLoading) return <LoadingScreen message="Chargement…" />

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
        <p className="text-gray-600 dark:text-gray-300">Page indisponible.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
      <div className="w-full max-w-lg space-y-4">
        <div className="rounded-2xl bg-white p-6 shadow-sm dark:bg-gray-800">
          <div className="flex items-center gap-3">
            {data.logo ? (
              <img src={data.logo} alt="" className="h-12 w-12 rounded-lg object-contain" />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-100 text-primary-600 dark:bg-primary-900/40">
                <KeyRound className="h-6 w-6" />
              </span>
            )}
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{data.titre}</h1>
              {data.commune && (
                <p className="text-sm text-gray-600 dark:text-gray-300">{data.commune}</p>
              )}
            </div>
          </div>

          <p className="mt-5 whitespace-pre-line text-base leading-relaxed text-gray-800 dark:text-gray-200">
            {data.message}
          </p>

          {data.contact && (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-700 dark:bg-gray-700/40 dark:text-gray-200">
              <Phone className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span className="whitespace-pre-line">{data.contact}</span>
            </p>
          )}
        </div>

        {/* Le détail n'apparaît que pour un compte habilité. Le serveur ne
            l'envoie pas aux autres : il n'y a rien à masquer ici. */}
        {data.detaille && data.materiel && (
          <div className="rounded-2xl bg-white p-6 shadow-sm dark:bg-gray-800">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium text-primary-600 dark:text-primary-400">
              <ShieldCheck className="h-4 w-4" />
              Informations réservées au personnel
            </div>

            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {data.materiel.nom}
              </h2>
              {data.materiel.inventaire && (
                <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-sm text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                  {data.materiel.inventaire}
                </span>
              )}
            </div>

            <div className="mt-4">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Détenteur
              </div>
              {data.detenteur ? (
                <div className="mt-1 flex items-center gap-2 text-gray-900 dark:text-gray-100">
                  {data.detenteur.holder_type === 'service' ? (
                    <Building2 className="h-4 w-4 text-gray-500" />
                  ) : data.detenteur.holder_type === 'ouvrant' ? (
                    <MapPin className="h-4 w-4 text-gray-500" />
                  ) : (
                    <User className="h-4 w-4 text-gray-500" />
                  )}
                  {nomDetenteur(data.detenteur)}
                </div>
              ) : (
                <div className="mt-1 text-gray-600 dark:text-gray-300">Non attribué</div>
              )}
            </div>

            {data.composition && data.composition.length > 0 && (
              <div className="mt-5">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Composition
                </div>
                <ul className="mt-2 space-y-2">
                  {data.composition.map((composant: any) => (
                    <li
                      key={composant.id}
                      className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                    >
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {composant.name}
                        {composant.quantity > 1 && (
                          <span className="ml-2 text-sm text-gray-600 dark:text-gray-300">
                            ×{composant.quantity}
                          </span>
                        )}
                      </div>
                      {composant.ouvre?.length > 0 && (
                        <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                          Ouvre :{' '}
                          {composant.ouvre
                            .map((o: any) =>
                              o.est_passe
                                ? `${o.site_name} (passe)`
                                : o.piece_name
                                  ? `${[o.piece_site_name, o.piece_name].filter(Boolean).join(' — ')} (pièce)`
                                  : [o.ouvrant_site_name, o.ouvrant_name].filter(Boolean).join(' — ')
                            )
                            .join(' · ')}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
