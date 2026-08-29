import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PackageCheck, ChevronRight, ChevronDown, Check, X, CornerDownRight } from 'lucide-react'
import { Card, CardBody, Alert, Badge, Spinner } from '@/components/ui'
import {
  materielPretableApi,
  type CategoriePretable,
  type Disponibilite,
} from '@/lib/api'
import toast from 'react-hot-toast'

/**
 * Quel matériel du parc peut être prêté pour une manifestation.
 *
 * Le sélecteur proposait tout le parc. Or une catégorie ne se prête pas d'un
 * bloc : un réfrigérateur de la catégorie Électroménager part volontiers pour
 * une brocante, le grill de la même catégorie non.
 *
 * Trois niveaux, le plus précis l'emporte. Une sous-catégorie et un matériel ont
 * **trois** états — oui, non, hérite — et non deux : sans le troisième, ouvrir
 * une catégorie obligerait à recocher chacun de ses matériels, et personne ne le
 * ferait.
 */

/** Bouton à trois états, ou à deux pour une catégorie qui ne peut pas hériter. */
function ChoixDisponibilite({ valeur, heritable, herite, onChange, disabled }: {
  valeur: Disponibilite
  /** Une catégorie ne peut pas hériter : elle n'a que deux états. */
  heritable: boolean
  /** Ce qui s'appliquerait si l'on héritait, pour que « Hérite » soit lisible. */
  herite?: boolean
  onChange: (valeur: Disponibilite) => void
  disabled?: boolean
}) {
  const bouton = (cible: Disponibilite, libelle: string, actifClasse: string) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(cible)}
      className={`px-2 py-1 text-xs rounded transition-colors disabled:opacity-50 ${
        valeur === cible
          ? actifClasse
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      {libelle}
    </button>
  )

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 p-0.5">
      {bouton(1, 'Prêtable', 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400')}
      {bouton(0, 'Exclu', 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400')}
      {heritable &&
        bouton(
          null,
          herite === undefined ? 'Hérite' : `Hérite (${herite ? 'prêtable' : 'exclu'})`,
          'bg-gray-200 text-gray-800 dark:bg-gray-600 dark:text-gray-100'
        )}
    </div>
  )
}

export default function MaterielPretablePage() {
  const queryClient = useQueryClient()
  const [ouvertes, setOuvertes] = useState<Set<number>>(new Set())

  const { data: arbre = [], isLoading } = useQuery({
    queryKey: ['pretable-tree'],
    queryFn: async () => (await materielPretableApi.getTree()).data.data,
  })

  const reglage = useMutation({
    mutationFn: ({ niveau, id, available }: {
      niveau: 'category' | 'subcategory' | 'object'
      id: number
      available: Disponibilite
    }) => materielPretableApi.regler(niveau, id, available),
    onSuccess: (_res, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pretable-tree'] })
      // Le résultat effectif d'un matériel dépend des niveaux au-dessus :
      // changer une catégorie change ce qu'affichent ses matériels.
      queryClient.invalidateQueries({ queryKey: ['pretable-objects'] })
      if (variables.niveau === 'category') toast.success('Catégorie mise à jour')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  const basculer = (id: number) => {
    const suivant = new Set(ouvertes)
    if (suivant.has(id)) suivant.delete(id)
    else suivant.add(id)
    setOuvertes(suivant)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <PackageCheck className="w-5 h-5" /> Matériel prêtable
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Ce que le parc peut prêter pour une manifestation. Ne concerne pas le stock dédié
          (tables, chaises), qui est prêtable par définition.
        </p>
      </div>

      <Alert type="info">
        <span className="text-sm">
          Le réglage le plus précis l'emporte : une catégorie donne le ton, une sous-catégorie
          l'affine, un matériel fait exception. Un réfrigérateur peut partir pour une brocante quand
          le grill de la même catégorie reste à la cuisine.
        </span>
      </Alert>

      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : arbre.length === 0 ? (
        <Alert type="warning">
          <span className="text-sm">
            Aucune catégorie. Tant que le parc n'est pas classé, tout son matériel reste prêtable
            par défaut et aucun service ne sera sollicité pour lui.
          </span>
        </Alert>
      ) : (
        <div className="space-y-2">
          {arbre.map((categorie) => (
            <LigneCategorie
              key={categorie.id}
              categorie={categorie}
              ouverte={ouvertes.has(categorie.id)}
              onBasculer={() => basculer(categorie.id)}
              onRegler={(niveau, id, available) => reglage.mutate({ niveau, id, available })}
              enCours={reglage.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function LigneCategorie({ categorie, ouverte, onBasculer, onRegler, enCours }: {
  categorie: CategoriePretable
  ouverte: boolean
  onBasculer: () => void
  onRegler: (niveau: 'category' | 'subcategory' | 'object', id: number, v: Disponibilite) => void
  enCours: boolean
}) {
  const categorieOuverte = categorie.available_for_manifestations === 1

  const { data: objets = [], isLoading } = useQuery({
    queryKey: ['pretable-objects', categorie.id],
    queryFn: async () => (await materielPretableApi.getObjects(categorie.id)).data.data,
    enabled: ouverte,
  })

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={onBasculer}
            className="flex items-center gap-2 min-w-0 text-left">
            {ouverte ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
            <span className="font-medium text-gray-900 dark:text-gray-100">{categorie.name}</span>
            <Badge variant="default">{categorie.objets_directs} matériel(s)</Badge>
          </button>

          <ChoixDisponibilite
            valeur={categorie.available_for_manifestations}
            heritable={false}
            disabled={enCours}
            onChange={(v) => onRegler('category', categorie.id, v)}
          />
        </div>

        {ouverte && (
          <div className="pl-6 space-y-3 border-l-2 border-gray-100 dark:border-gray-700">
            {categorie.subcategories.length > 0 && (
              <div className="space-y-1">
                {categorie.subcategories.map((sc) => (
                  <div key={sc.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
                      <CornerDownRight className="w-3 h-3 text-gray-400" />
                      {sc.name}
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {sc.objets} matériel(s)
                      </span>
                    </span>
                    <ChoixDisponibilite
                      valeur={sc.available_for_manifestations}
                      heritable
                      herite={categorieOuverte}
                      disabled={enCours}
                      onChange={(v) => onRegler('subcategory', sc.id, v)}
                    />
                  </div>
                ))}
              </div>
            )}

            {isLoading ? (
              <div className="flex justify-center py-4"><Spinner /></div>
            ) : objets.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Aucun matériel dans cette catégorie.
              </p>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Exceptions matériel par matériel :
                </p>
                {objets.map((objet) => (
                  <div key={objet.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2 min-w-0">
                      {objet.pretable ? (
                        <Check className="w-3 h-3 text-green-600 shrink-0" />
                      ) : (
                        <X className="w-3 h-3 text-red-500 shrink-0" />
                      )}
                      <span className="truncate">{objet.name}</span>
                      {objet.reference && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">{objet.reference}</span>
                      )}
                      {objet.subcategory_name && (
                        <Badge variant="default">{objet.subcategory_name}</Badge>
                      )}
                    </span>
                    <ChoixDisponibilite
                      valeur={objet.available_for_manifestations}
                      heritable
                      disabled={enCours}
                      onChange={(v) => onRegler('object', objet.id, v)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
