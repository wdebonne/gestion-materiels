import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, EyeOff, Pencil, Plus, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button, Card, CardBody, Input, LoadingInline, useConfirm } from '@/components/ui'
import { CategorieTemps, planningApi } from '@/lib/api'
import { EMPLACEMENTS_COULEUR, PALETTE, couleurDe } from '@/lib/paletteCategories'
import { useThemeSombre } from '@/lib/useThemeSombre'
import { cn } from '@/lib/utils'

/**
 * Le référentiel des catégories de temps.
 *
 * Il vit **dans le module** et non dans les paramètres, parce que c'est l'agent
 * de terrain qui découvre qu'il manque « Livraison Manifestation » — et que la
 * barre des paramètres ne s'ouvre qu'au superviseur et à l'administrateur.
 * L'y enfermer reviendrait à lui faire choisir « Autre », c'est-à-dire à vider
 * de son sens la statistique qu'on cherche à bâtir.
 *
 * La couleur ne se choisit pas librement : les huit teintes de la palette ont
 * été vérifiées ensemble pour rester distinguables dans les deux thèmes, y
 * compris en vision déficiente. Un sélecteur de couleur libre laisserait poser
 * deux verts voisins, et le camembert cesserait d'être lisible sans que
 * personne ne sache pourquoi.
 */

interface CategoriesProps {
  peutModifier: boolean
  peutDesactiver: boolean
}

export default function Categories({ peutModifier, peutDesactiver }: CategoriesProps) {
  const sombre = useThemeSombre()
  const confirmer = useConfirm()
  const queryClient = useQueryClient()

  const [nouvelle, setNouvelle] = useState('')
  const [enEdition, setEnEdition] = useState<number | null>(null)
  const [nomEdite, setNomEdite] = useState('')

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['plannings', 'categories', 'toutes'],
    queryFn: async () => (await planningApi.categories(true)).data.data,
  })

  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ['plannings'] })

  const creer = useMutation({
    mutationFn: (nom: string) => planningApi.creerCategorie(nom),
    onSuccess: () => {
      setNouvelle('')
      rafraichir()
      toast.success('Catégorie ajoutée')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? "L'ajout n'a pas abouti."),
  })

  const modifier = useMutation({
    mutationFn: ({ id, ...data }: { id: number; nom?: string; couleur?: string }) =>
      planningApi.modifierCategorie(id, data),
    onSuccess: () => {
      setEnEdition(null)
      rafraichir()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? "La modification n'a pas abouti."),
  })

  const activer = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => planningApi.activerCategorie(id, active),
    onSuccess: rafraichir,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Action impossible'),
  })

  const supprimer = useMutation({
    mutationFn: (id: number) => planningApi.supprimerCategorie(id),
    onSuccess: () => {
      rafraichir()
      toast.success('Catégorie supprimée')
    },
    // Le serveur refuse une catégorie encore employée et dit combien de tâches
    // s'en servent : son message vaut mieux qu'un « Erreur » qui n'apprend rien.
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Suppression impossible'),
  })

  if (isLoading) return <LoadingInline />

  const actives = categories.filter((c) => c.active)
  const inactives = categories.filter((c) => !c.active)

  return (
    <div className="space-y-4">
      {peutModifier && (
        <Card>
          <CardBody>
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault()
                if (nouvelle.trim().length >= 2) creer.mutate(nouvelle.trim())
              }}
            >
              <Input
                label="Ajouter une catégorie"
                placeholder="Ex. : Livraison Manifestation"
                value={nouvelle}
                onChange={(e) => setNouvelle(e.target.value)}
              />
              <Button
                type="submit"
                icon={<Plus className="h-4 w-4" />}
                loading={creer.isPending}
                disabled={nouvelle.trim().length < 2}
              >
                Ajouter
              </Button>
            </form>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="space-y-1">
          <h3 className="mb-2 text-base font-medium text-gray-900 dark:text-white">
            Catégories proposées à la saisie
          </h3>

          {actives.length === 0 ? (
            <p className="py-6 text-center text-gray-600 dark:text-gray-400">
              Aucune catégorie active. La première saisie en créera une.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {actives.map((categorie) => (
                <LigneCategorie
                  key={categorie.id}
                  categorie={categorie}
                  sombre={sombre}
                  peutModifier={peutModifier}
                  peutDesactiver={peutDesactiver}
                  enEdition={enEdition === categorie.id}
                  nomEdite={nomEdite}
                  onNomEdite={setNomEdite}
                  onOuvrirEdition={() => {
                    setEnEdition(categorie.id)
                    setNomEdite(categorie.nom)
                  }}
                  onFermerEdition={() => setEnEdition(null)}
                  onRenommer={() => modifier.mutate({ id: categorie.id, nom: nomEdite.trim() })}
                  onCouleur={(couleur) => modifier.mutate({ id: categorie.id, couleur })}
                  onDesactiver={() => activer.mutate({ id: categorie.id, active: false })}
                  onSupprimer={async () => {
                    const oui = await confirmer({
                      title: `Supprimer « ${categorie.nom} » ?`,
                      message: "Si des heures y sont rattachées, la suppression sera refusée : désactivez-la plutôt.",
                      confirmLabel: 'Supprimer',
                      variant: 'danger',
                    })
                    if (oui) supprimer.mutate(categorie.id)
                  }}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {inactives.length > 0 && (
        <Card>
          <CardBody className="space-y-1">
            <h3 className="mb-1 text-base font-medium text-gray-900 dark:text-white">Retirées des propositions</h3>
            <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
              Elles ne sont plus proposées à la saisie, mais les heures déjà enregistrées les gardent.
            </p>
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {inactives.map((categorie) => (
                <li key={categorie.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <span
                      className="h-3 w-3 rounded-full opacity-50"
                      style={{ backgroundColor: couleurDe(categorie.couleur, sombre) }}
                      aria-hidden
                    />
                    {categorie.nom}
                  </span>
                  {peutDesactiver && (
                    <Button variant="outline" size="sm" onClick={() => activer.mutate({ id: categorie.id, active: true })}>
                      Reproposer
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

function LigneCategorie({
  categorie,
  sombre,
  peutModifier,
  peutDesactiver,
  enEdition,
  nomEdite,
  onNomEdite,
  onOuvrirEdition,
  onFermerEdition,
  onRenommer,
  onCouleur,
  onDesactiver,
  onSupprimer,
}: {
  categorie: CategorieTemps
  sombre: boolean
  peutModifier: boolean
  peutDesactiver: boolean
  enEdition: boolean
  nomEdite: string
  onNomEdite: (nom: string) => void
  onOuvrirEdition: () => void
  onFermerEdition: () => void
  onRenommer: () => void
  onCouleur: (couleur: string) => void
  onDesactiver: () => void
  onSupprimer: () => void
}) {
  const [palette, setPalette] = useState(false)

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!peutModifier}
          onClick={() => setPalette((v) => !v)}
          aria-label={`Changer la couleur de ${categorie.nom}`}
          className="h-6 w-6 flex-shrink-0 rounded-full ring-offset-2 focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-default dark:ring-offset-gray-800"
          style={{ backgroundColor: couleurDe(categorie.couleur, sombre) }}
        />

        {enEdition ? (
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (nomEdite.trim().length >= 2) onRenommer()
            }}
          >
            <Input value={nomEdite} onChange={(e) => onNomEdite(e.target.value)} size="sm" autoFocus />
            <Button type="submit" size="icon" variant="ghost" aria-label="Enregistrer">
              <Check className="h-4 w-4" />
            </Button>
            <Button type="button" size="icon" variant="ghost" aria-label="Annuler" onClick={onFermerEdition}>
              <X className="h-4 w-4" />
            </Button>
          </form>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-gray-100">{categorie.nom}</span>
            <div className="flex flex-shrink-0 gap-1">
              {peutModifier && (
                <Button variant="ghost" size="icon" aria-label={`Renommer ${categorie.nom}`} onClick={onOuvrirEdition}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {peutDesactiver && (
                <>
                  <Button variant="ghost" size="icon" aria-label={`Retirer ${categorie.nom} des propositions`} onClick={onDesactiver}>
                    <EyeOff className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Supprimer ${categorie.nom}`} onClick={onSupprimer}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {palette && peutModifier && (
        <div className="mt-2 flex flex-wrap gap-2 pl-9">
          {EMPLACEMENTS_COULEUR.map((nom) => (
            <button
              key={nom}
              type="button"
              title={PALETTE[nom].libelle}
              aria-label={PALETTE[nom].libelle}
              onClick={() => {
                onCouleur(nom)
                setPalette(false)
              }}
              className={cn(
                'h-7 w-7 rounded-full ring-offset-2 focus-visible:ring-2 focus-visible:ring-primary-500 dark:ring-offset-gray-800',
                categorie.couleur === nom && 'ring-2 ring-gray-900 dark:ring-white'
              )}
              style={{ backgroundColor: couleurDe(nom, sombre) }}
            />
          ))}
        </div>
      )}
    </li>
  )
}
