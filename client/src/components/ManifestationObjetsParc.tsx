import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, X, AlertTriangle, Truck } from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle, Input, Alert, Badge, Spinner } from '@/components/ui'
import { objetManifestationApi, type ObjetParc } from '@/lib/api'
import { BadgePrestation } from '@/components/ChoixPrestation'

/**
 * Choix du matériel **unique** d'une manifestation.
 *
 * Une manifestation demande deux natures de matériel : des quantités — 50 tables
 * d'un même modèle, qu'il serait absurde de saisir une par une — et des
 * exemplaires identifiés : le camion, le vidéoprojecteur n° 3. Ce composant
 * traite la seconde.
 *
 * Les matériels déjà pris restent **visibles**, en disant qui les retient :
 * savoir que le camion est sur la brocante permet de demander un décalage, ce
 * qu'une liste amputée ne permettrait pas. Ils restent sélectionnables, parce
 * qu'une commune arbitre — mais l'écran ne laisse pas ignorer le conflit.
 */

export interface ObjetChoisi {
  object_id: number
  object_name?: string
  reference?: string | null
  notes?: string | null
  /** Nombre demandé : utile pour un lot ou une prestation, toujours 1 pour un exemplaire. */
  quantity?: number
}

const formatDate = (valeur: string): string =>
  valeur ? new Date(valeur).toLocaleDateString('fr-FR') : '—'

export default function ManifestationObjetsParc({
  choisis,
  onChange,
  dateDebut,
  dateFin,
  exclure,
}: {
  choisis: ObjetChoisi[]
  onChange: (objets: ObjetChoisi[]) => void
  dateDebut?: string
  dateFin?: string
  /** Manifestation en cours de modification : elle ne doit pas se gêner elle-même. */
  exclure?: number
}) {
  const [recherche, setRecherche] = useState('')

  const { data: parc = [], isFetching } = useQuery({
    queryKey: ['parc-disponible', recherche, dateDebut, dateFin, exclure],
    queryFn: async () =>
      (
        await objetManifestationApi.rechercher({
          q: recherche || undefined,
          date_from: dateDebut,
          date_to: dateFin,
          exclude: exclure,
        })
      ).data.data,
    enabled: recherche.length >= 2,
  })

  const retenus = new Set(choisis.map((o) => o.object_id))

  const ajouter = (objet: ObjetParc) => {
    if (retenus.has(objet.id)) return
    onChange([
      ...choisis,
      {
        object_id: objet.id,
        object_name: objet.name,
        reference: objet.reference,
        quantity: 1,
      },
    ])
  }

  /** Change le nombre demandé d'une ligne, sans jamais descendre sous 1. */
  const changerQuantite = (objectId: number, quantite: number) =>
    onChange(
      choisis.map((o) =>
        o.object_id === objectId ? { ...o, quantity: Math.max(1, quantite || 1) } : o
      )
    )

  const retirer = (objectId: number) => onChange(choisis.filter((o) => o.object_id !== objectId))

  /** Conflits des matériels déjà retenus : c'est là qu'ils comptent vraiment. */
  const conflitsRetenus = parc.filter(
    (o) => retenus.has(o.id) && !o.disponible && o.nature === 'unique'
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Truck className="w-4 h-4" /> Matériel du parc
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Un <strong>exemplaire</strong> — un véhicule — ne peut pas être à deux endroits le même
          jour. Un <strong>lot</strong> se demande en nombre et s’impute sur son stock. Une{' '}
          <strong>prestation</strong> n’immobilise rien.
        </p>

        {choisis.length > 0 && (
          <div className="space-y-1">
            {choisis.map((objet) => {
              const fiche = parc.find((o) => o.id === objet.object_id)
              return (
                <div key={objet.object_id}
                  className="flex flex-wrap items-center gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800">
                  <span className="text-sm text-gray-900 dark:text-gray-100 flex-1 min-w-0 truncate">
                    {objet.object_name ?? fiche?.name ?? `Matériel #${objet.object_id}`}
                    {(objet.reference ?? fiche?.reference) && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                        ({objet.reference ?? fiche?.reference})
                      </span>
                    )}
                  </span>
                  {/* Un lot se demande en nombre, et l'écran dit combien il en
                      reste sur la période : choisir à l'aveugle ferait
                      découvrir le manque le jour de la livraison. */}
                  {fiche && (fiche.nature === 'lot' || fiche.nature === 'prestation') && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={objet.quantity ?? 1}
                        onChange={(e) => changerQuantite(objet.object_id, parseInt(e.target.value, 10))}
                        aria-label={`Nombre pour ${objet.object_name ?? objet.object_id}`}
                        className="w-20 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                      />
                      {fiche.nature === 'lot' && (
                        <span
                          className={`text-xs ${
                            (fiche.disponible_previsionnel ?? 0) < (objet.quantity ?? 1)
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-gray-500 dark:text-gray-400'
                          }`}
                        >
                          {fiche.disponible_previsionnel ?? 0} dispo. sur {fiche.quantity_total ?? 0}
                        </span>
                      )}
                    </div>
                  )}
                  {fiche && fiche.nature === 'unique' && !fiche.disponible && (
                    <Badge variant="warning">Déjà retenu</Badge>
                  )}
                  <button type="button" onClick={() => retirer(objet.object_id)}
                    aria-label={`Retirer ${objet.object_name ?? objet.object_id}`}
                    className="p-1 hover:text-red-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {conflitsRetenus.length > 0 && (
          <Alert type="warning">
            <div className="text-sm">
              <strong>Déjà retenu sur la période :</strong>
              <ul className="mt-1 list-disc list-inside">
                {conflitsRetenus.flatMap((objet) =>
                  objet.indisponibilites.map((conflit, i) => (
                    <li key={`${objet.id}-${i}`}>
                      {objet.name} — {conflit.origine === 'reservation' ? 'réservation' : 'manifestation'}
                      {' « '}{conflit.detail}{' » '}
                      du {formatDate(conflit.debut)} au {formatDate(conflit.fin)}
                    </li>
                  ))
                )}
              </ul>
            </div>
          </Alert>
        )}

        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            className="pl-9"
            value={recherche}
            placeholder="Chercher dans le parc (nom, référence, n° de série)…"
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>

        {recherche.length >= 2 && (
          isFetching ? (
            <div className="flex justify-center py-4"><Spinner /></div>
          ) : parc.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Aucun matériel trouvé.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-1">
              {parc.map((objet) => (
                <button
                  key={objet.id}
                  type="button"
                  disabled={retenus.has(objet.id)}
                  onClick={() => ajouter(objet)}
                  className="w-full text-left p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-gray-900 dark:text-gray-100">{objet.name}</span>
                    {objet.reference && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">{objet.reference}</span>
                    )}
                    {objet.category_name && <Badge variant="default">{objet.category_name}</Badge>}
                    {/* Une prestation ne se réserve pas : la reconnaître d'un
                        coup d'œil évite de la chercher parmi les exemplaires. */}
                    {objet.is_prestation ? <BadgePrestation /> : null}
                    {!objet.disponible && (
                      <span className="inline-flex items-center gap-1 text-xs text-yellow-700 dark:text-yellow-500">
                        <AlertTriangle className="w-3 h-3" /> déjà retenu
                      </span>
                    )}
                  </div>
                  {!objet.disponible && objet.indisponibilites[0] && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      « {objet.indisponibilites[0].detail} » du{' '}
                      {formatDate(objet.indisponibilites[0].debut)} au{' '}
                      {formatDate(objet.indisponibilites[0].fin)}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )
        )}
      </CardBody>
    </Card>
  )
}
