import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, MapPin, Search, SlidersHorizontal } from 'lucide-react'
import { Card, CardBody, LoadingInline } from '@/components/ui'
import { mobilierUrbainApi, type Implantation } from '@/lib/api'
import {
  alerteDe,
  etat,
  familleExemplaire,
  jour,
  nomComplet,
  precision,
  source as gisement,
  SOURCES,
  statut,
} from '@/lib/mobilierUrbain'

/**
 * « J'ai créé un banc au catalogue. Où sont les vingt-trois bancs posés ? »
 *
 * C'est la question qui a fait naître le module, et c'est sur la fiche du
 * matériel qu'elle se pose — pas sur la carte. Quelqu'un qui ouvre « Banc
 * modèle Ville » veut savoir combien sont dehors, dans quel état, et lequel a
 * été repris récemment.
 *
 * Et la réponse ne s'arrête pas au trottoir. Un banc peut être scellé sur la
 * voie publique **ou** posé dans un parc : ce sont deux tables et deux modules,
 * mais un seul modèle et une seule question. Chercher à deux endroits, c'est
 * garantir qu'on cherchera à un seul et qu'on conclura faux — « il m'en reste
 * trois » alors qu'il y en a vingt-six.
 *
 * Ce que l'onglet n'est pas : un second écran de gestion. Chaque ligne renvoie
 * là où elle vit — la carte pour la voirie, la fiche du parc pour un espace
 * vert —, parce que c'est là qu'on voit ses voisins et son contexte.
 */

/**
 * Les implantations d'un modèle, les deux gisements confondus.
 *
 * Exporté pour que la fiche matériel puisse décider d'afficher l'onglet sans
 * lancer une seconde requête : React Query rend la même donnée aux deux
 * appelants sous la même clé.
 */
export function useImplantationsDuMateriel(objectId: number | undefined) {
  return useQuery({
    queryKey: ['implantations-par-modele', objectId],
    queryFn: async () => (await mobilierUrbainApi.parModele(Number(objectId))).data.data,
    enabled: Boolean(objectId),
  })
}

interface Props {
  objectId: number
  objectName?: string
}

export default function ImplantationsDuMateriel({ objectId, objectName }: Props) {
  const { data: items = [], isLoading } = useImplantationsDuMateriel(objectId)
  const [recherche, setRecherche] = useState('')
  const [lieu, setLieu] = useState('')
  const [ou, setOu] = useState('')

  /** Les lieux réellement occupés : « Voie publique », puis chaque parc. */
  const lieux = useMemo(() => {
    const vus = new Map<string, number>()
    for (const item of items) {
      vus.set(item.lieu, (vus.get(item.lieu) ?? 0) + 1)
    }
    return [...vus.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'))
  }, [items])

  const filtres = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    return items.filter((item) => {
      if (ou && item.source !== ou) return false
      if (lieu && item.lieu !== lieu) return false
      if (!terme) return true
      return [item.label, item.code, item.address, item.street, item.sector, item.lieu, item.notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(terme)
    })
  }, [items, recherche, lieu, ou])

  const bilan = useMemo(() => {
    const compter = (predicat: (item: Implantation) => boolean) => items.filter(predicat).length
    return {
      total: items.length,
      voirie: compter((i) => i.source === 'voirie'),
      espaces: compter((i) => i.source === 'espace_vert'),
      aReprendre: compter((i) => alerteDe(i) !== null),
      jamais: compter((i) => !i.last_intervention_date),
    }
  }, [items])

  if (isLoading) {
    return (
      <Card>
        <CardBody>
          <LoadingInline />
        </CardBody>
      </Card>
    )
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardBody className="py-12 text-center">
          <MapPin className="mx-auto mb-2 h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Aucun exemplaire de ce matériel n’est implanté.
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-gray-500 dark:text-gray-400">
            Un modèle acheté en série reste une seule fiche ici. Ses exemplaires se posent depuis la{' '}
            <Link to="/map" className="text-primary-600 underline dark:text-primary-400">
              cartographie
            </Link>{' '}
            pour la voie publique, ou depuis un{' '}
            <Link to="/espaces-verts" className="text-primary-600 underline dark:text-primary-400">
              espace vert
            </Link>{' '}
            — chacun avec sa position, son état et son historique.
          </p>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Ce que ce modèle représente dehors */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Chiffre valeur={bilan.total} libelle="Implantations" />
        <Chiffre valeur={bilan.voirie} libelle="Sur la voie publique" />
        <Chiffre valeur={bilan.espaces} libelle="Dans les espaces verts" ton="vert" />
        <Chiffre valeur={bilan.aReprendre} libelle="À reprendre" ton="orange" />
        <Chiffre valeur={bilan.jamais} libelle="Jamais entretenus" />
      </div>

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Numéro, code, adresse…"
                className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <select
              value={ou}
              onChange={(e) => setOu(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              aria-label="Filtrer par gisement"
            >
              <option value="">Partout ({items.length})</option>
              {SOURCES.map((s) => (
                <option key={s.valeur} value={s.valeur}>
                  {s.icone} {s.libelle}
                </option>
              ))}
            </select>
            <select
              value={lieu}
              onChange={(e) => setLieu(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              aria-label="Filtrer par lieu"
            >
              <option value="">Tous les lieux</option>
              {lieux.map(([nom, compte]) => (
                <option key={nom} value={nom}>
                  {nom} ({compte})
                </option>
              ))}
            </select>
            <Link
              to={`/map?materiel=${objectId}`}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-primary-500 px-3 text-sm font-medium text-primary-700 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/30"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Voir sur la carte
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="py-2 pr-3 font-medium">Exemplaire</th>
                  <th className="py-2 pr-3 font-medium">Lieu</th>
                  <th className="py-2 pr-3 font-medium">Statut</th>
                  <th className="py-2 pr-3 font-medium">État</th>
                  <th className="py-2 pr-3 font-medium">Dernier entretien</th>
                  <th className="py-2 font-medium">À revoir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filtres.map((item) => {
                  const famille = familleExemplaire(item)
                  const alerte = alerteDe(item)
                  // Chaque ligne renvoie là où elle vit : la carte sait ouvrir un
                  // mobilier de voirie, la fiche du parc sait tout du reste.
                  const destination =
                    item.source === 'voirie'
                      ? `/map?materiel=${item.object_id}&mobilier=${item.cle}`
                      : `/espaces-verts?espace=${item.green_space_id}`
                  return (
                    <tr key={item.cle} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <td className="py-2.5 pr-3">
                        <Link to={destination} className="flex items-center gap-2">
                          <span
                            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-sm"
                            style={{ background: `${famille.couleur}22` }}
                          >
                            {famille.icone}
                          </span>
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {nomComplet(item)}
                          </span>
                          {item.quantity > 1 && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              ×{item.quantity}
                            </span>
                          )}
                          {alerte && (
                            <AlertTriangle
                              className="h-3.5 w-3.5 flex-shrink-0"
                              style={{ color: alerte.couleur }}
                            />
                          )}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-300">
                        <span className="flex items-center gap-1">
                          <span>{gisement(item.source).icone}</span>
                          <span className="truncate">{item.street || item.lieu}</span>
                          {!precision(item.precision_position).sure && (
                            <span
                              className="text-amber-600 dark:text-amber-400"
                              title={precision(item.precision_position).libelle}
                            >
                              ≈
                            </span>
                          )}
                        </span>
                        {item.sector && (
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            {item.sector}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${statut(item.status).pastille}`}
                        >
                          {statut(item.status).libelle}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${etat(item.condition_state).pastille}`}
                        >
                          {etat(item.condition_state).libelle}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-300">
                        {jour(item.last_intervention_date)}
                      </td>
                      <td className="py-2.5 text-gray-600 dark:text-gray-300">
                        {jour(item.next_intervention_date)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {filtres.length === 0 && (
            <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              Aucun exemplaire ne correspond à cette recherche.
            </p>
          )}

          <p className="text-xs text-gray-500 dark:text-gray-400">
            {objectName ? `« ${objectName} » est un modèle` : 'Ce matériel est un modèle'} : ce qui
            est écrit sur une implantation — position, état, interventions — n’appartient qu’à
            elle.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}

function Chiffre({
  valeur,
  libelle,
  ton = 'neutre',
}: {
  valeur: number
  libelle: string
  ton?: 'neutre' | 'vert' | 'orange'
}) {
  const couleurs = {
    neutre: 'text-gray-900 dark:text-gray-100',
    vert: 'text-green-600 dark:text-green-400',
    orange: 'text-orange-600 dark:text-orange-400',
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800">
      <p className={`text-xl font-bold ${couleurs[ton]}`}>{valeur}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{libelle}</p>
    </div>
  )
}
