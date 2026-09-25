import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Building2, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { batimentsApi, type NatureRubrique, type RubriqueBatiment } from '@/lib/api'
import { useGestion } from '@/lib/gestion'
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  LoadingInline,
  Modal,
  ModalBody,
  ModalFooter,
  Select,
  TextArea,
  useConfirm,
} from '@/components/ui'
import { invaliderBatiments } from '@/components/batiments/cache'
import {
  libellePeriodicite,
  libelleRappel,
  NATURES,
  PERIODICITES,
  RAPPELS,
} from '@/components/batiments/libelles'

/**
 * Le catalogue des contrôles et des objets de document, commun à tous les
 * bâtiments.
 *
 * C'est ici qu'on dit « la vérification électrique, c'est tous les ans, et je
 * veux être prévenu deux mois avant ». La périodicité et le rappel se règlent
 * **dans le tableau**, d'un choix dans une liste : c'est le réglage qu'on vient
 * chercher, il ne doit pas être caché derrière un bouton « Modifier ».
 *
 * Un bâtiment peut ensuite surcharger ces valeurs pour lui seul — l'école dont
 * l'électricité se vérifie tous les deux ans — depuis sa propre page.
 */
export default function BatimentsSettingsPage() {
  const { gereLieux, chargement } = useGestion()
  const queryClient = useQueryClient()
  const confirmer = useConfirm()
  const [recherche, setRecherche] = useState('')
  const [voirInactives, setVoirInactives] = useState(false)
  const [edition, setEdition] = useState<RubriqueBatiment | 'nouvelle' | null>(null)

  const { data: rubriques = [], isLoading } = useQuery({
    queryKey: ['batiments', 'rubriques', 'toutes'],
    queryFn: async () => (await batimentsApi.rubriques(true)).data.rubriques,
    enabled: gereLieux,
  })

  const visibles = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    return rubriques.filter(
      (r) => (voirInactives || r.actif) && (!terme || r.libelle.toLowerCase().includes(terme))
    )
  }, [rubriques, recherche, voirInactives])

  const modifier = useMutation({
    mutationFn: ({ id, valeurs }: { id: number; valeurs: Record<string, unknown> }) =>
      batimentsApi.modifierRubrique(id, valeurs),
    onSuccess: () => {
      toast.success('Réglage enregistré')
      invaliderBatiments(queryClient)
    },
    onError: (erreur: any) => toast.error(erreur?.response?.data?.message ?? "L'enregistrement n'a pas abouti"),
  })

  const supprimer = useMutation({
    mutationFn: (id: number) => batimentsApi.supprimerRubrique(id),
    onSuccess: () => {
      toast.success('Objet supprimé')
      invaliderBatiments(queryClient)
    },
    onError: (erreur: any) => toast.error(erreur?.response?.data?.message ?? "La suppression n'a pas abouti"),
  })

  const appliquer = useMutation({
    mutationFn: (id: number) => batimentsApi.appliquerRubrique(id, { tous: true }),
    onSuccess: ({ data }) => {
      toast.success(
        data.crees === 0
          ? 'Tous les bâtiments suivent déjà ce contrôle'
          : `Contrôle ajouté à ${data.crees} bâtiment${data.crees > 1 ? 's' : ''}`
      )
      invaliderBatiments(queryClient)
    },
    onError: (erreur: any) => toast.error(erreur?.response?.data?.message ?? "L'ajout n'a pas abouti"),
  })

  const demanderApplication = async (r: RubriqueBatiment) => {
    const ok = await confirmer({
      title: `Suivre « ${r.libelle} » dans tous les bâtiments ?`,
      message: 'Chaque bâtiment actif qui ne le suit pas encore reçoit ce contrôle. Il se retire bâtiment par bâtiment.',
      confirmLabel: 'Ajouter partout',
    })
    if (ok) appliquer.mutate(r.id)
  }

  const demanderSuppression = async (r: RubriqueBatiment) => {
    const ok = await confirmer({
      title: `Supprimer « ${r.libelle} » ?`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    })
    if (ok) supprimer.mutate(r.id)
  }

  if (chargement) return <LoadingInline />
  if (!gereLieux) {
    return (
      <Alert type="info">
        <span className="text-sm">
          Le catalogue des contrôles est commun à tous les bâtiments : il se règle par un
          administrateur, un superviseur ou un gestionnaire de toute l'organisation. Les réglages
          propres à un bâtiment se font depuis sa page, dans le module Bâtiments.
        </span>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Building2 className="w-7 h-7 text-primary-600" />
            Bâtiments — contrôles et rappels
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Chaque objet dit tous les combien le contrôle revient, et combien de temps avant on en est
            prévenu. Un bâtiment peut surcharger ces valeurs pour lui seul.
          </p>
        </div>
        <Button icon={<Plus className="w-4 h-4" />} onClick={() => setEdition('nouvelle')} className="whitespace-nowrap flex-shrink-0">
          Nouvel objet
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex-1">
          <Input
            placeholder="Rechercher…"
            icon={<Search className="w-4 h-4" />}
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={voirInactives} onChange={(e) => setVoirInactives(e.target.checked)} />
          Afficher les objets désactivés
        </label>
      </div>

      {isLoading ? (
        <LoadingInline />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-left text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Objet</th>
                  <th className="px-4 py-3 font-medium">Revient</th>
                  <th className="px-4 py-3 font-medium">Me prévenir</th>
                  <th className="px-4 py-3 font-medium">Bâtiments</th>
                  <th className="px-4 py-3 font-medium">Actif</th>
                  <th className="px-4 py-3 font-medium sr-only">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {visibles.map((r) => (
                  <tr key={r.id} className={r.actif ? '' : 'opacity-60'}>
                    <td className="px-4 py-3 min-w-[16rem]">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{r.libelle}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {NATURES[r.nature]}
                        {r.referenceReglementaire ? ` · ${r.referenceReglementaire}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 min-w-[11rem]">
                      <Select
                        aria-label={`Périodicité de ${r.libelle}`}
                        value={r.periodiciteMois ?? ''}
                        onChange={(e) =>
                          modifier.mutate({
                            id: r.id,
                            valeurs: { periodiciteMois: e.target.value ? Number(e.target.value) : null },
                          })
                        }
                        options={optionsPeriodicite(r.periodiciteMois)}
                      />
                    </td>
                    <td className="px-4 py-3 min-w-[11rem]">
                      <Select
                        aria-label={`Délai de rappel de ${r.libelle}`}
                        value={r.rappelJours}
                        disabled={!r.periodiciteMois}
                        title={r.periodiciteMois ? undefined : 'Sans échéance, pas de rappel'}
                        onChange={(e) => modifier.mutate({ id: r.id, valeurs: { rappelJours: Number(e.target.value) } })}
                        options={optionsRappel(r.rappelJours)}
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-gray-700 dark:text-gray-300">{r.suivis}</span>
                      {r.periodiciteMois && r.actif && (
                        <Button variant="ghost" size="sm" className="ml-2" onClick={() => demanderApplication(r)}>
                          Tous
                        </Button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`${r.libelle} actif`}
                        checked={r.actif}
                        onChange={(e) => modifier.mutate({ id: r.id, valeurs: { actif: e.target.checked } })}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {r.systeme && <Badge size="sm" title="Livré avec l'application : se désactive, ne se supprime pas">Catalogue</Badge>}
                        <Button variant="ghost" size="sm" onClick={() => setEdition(r)} title="Modifier" aria-label="Modifier">
                          <Pencil className="w-4 h-4" />
                        </Button>
                        {!r.systeme && r.suivis + r.documents === 0 && (
                          <Button variant="ghost" size="sm" onClick={() => demanderSuppression(r)} title="Supprimer" aria-label="Supprimer">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {edition && <EditionRubrique rubrique={edition === 'nouvelle' ? null : edition} onFermer={() => setEdition(null)} />}
    </div>
  )
}

/** Les choix de la liste, plus la valeur actuelle si elle n'y figure pas. */
function optionsPeriodicite(actuelle: number | null) {
  const options = [{ value: '', label: 'Sans échéance' }, ...PERIODICITES.map((p) => ({ value: p.value, label: p.label }))]
  if (actuelle && !PERIODICITES.some((p) => p.value === actuelle)) {
    options.push({ value: actuelle, label: libellePeriodicite(actuelle) })
  }
  return options
}

function optionsRappel(actuel: number) {
  const options = RAPPELS.map((r) => ({ value: r.value, label: r.label }))
  if (!RAPPELS.some((r) => r.value === actuel)) options.push({ value: actuel, label: libelleRappel(actuel) })
  return options
}

function EditionRubrique({ rubrique, onFermer }: { rubrique: RubriqueBatiment | null; onFermer: () => void }) {
  const queryClient = useQueryClient()
  const [libelle, setLibelle] = useState(rubrique?.libelle ?? '')
  const [nature, setNature] = useState<NatureRubrique>(rubrique?.nature ?? 'controle')
  const [periodicite, setPeriodicite] = useState(rubrique?.periodiciteMois ? String(rubrique.periodiciteMois) : '12')
  const [rappel, setRappel] = useState(String(rubrique?.rappelJours ?? 30))
  const [reference, setReference] = useState(rubrique?.referenceReglementaire ?? '')
  const [description, setDescription] = useState(rubrique?.description ?? '')

  const enregistrer = useMutation({
    mutationFn: async () => {
      const valeurs = {
        libelle: libelle.trim(),
        nature,
        periodiciteMois: periodicite ? Number(periodicite) : null,
        rappelJours: Number(rappel),
        referenceReglementaire: reference.trim() || null,
        description: description.trim() || null,
      }
      return rubrique ? batimentsApi.modifierRubrique(rubrique.id, valeurs) : batimentsApi.creerRubrique(valeurs)
    },
    onSuccess: () => {
      toast.success(rubrique ? 'Objet modifié' : 'Objet ajouté au catalogue')
      invaliderBatiments(queryClient)
      onFermer()
    },
    onError: (erreur: any) => toast.error(erreur?.response?.data?.message ?? "L'enregistrement n'a pas abouti"),
  })

  return (
    <Modal isOpen onClose={onFermer} title={rubrique ? `Modifier — ${rubrique.libelle}` : 'Nouvel objet'} size="lg">
      <ModalBody className="space-y-4">
        <Input label="Libellé" value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="Contrôle des stores automatiques" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Select
            label="Nature"
            value={nature}
            onChange={(e) => setNature(e.target.value as NatureRubrique)}
            options={Object.entries(NATURES).map(([value, label]) => ({ value, label }))}
          />
          <Select
            label="Revient"
            value={periodicite}
            onChange={(e) => setPeriodicite(e.target.value)}
            options={optionsPeriodicite(periodicite ? Number(periodicite) : null).map((o) => ({ ...o, value: String(o.value) }))}
          />
          <Select
            label="Me prévenir"
            value={rappel}
            onChange={(e) => setRappel(e.target.value)}
            options={optionsRappel(Number(rappel)).map((o) => ({ ...o, value: String(o.value) }))}
          />
        </div>
        <Input label="Référence réglementaire (facultatif)" value={reference} onChange={(e) => setReference(e.target.value)} />
        <TextArea label="Description (facultatif)" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onFermer}>
          Annuler
        </Button>
        <Button onClick={() => enregistrer.mutate()} loading={enregistrer.isPending} disabled={!libelle.trim()}>
          Enregistrer
        </Button>
      </ModalFooter>
    </Modal>
  )
}
