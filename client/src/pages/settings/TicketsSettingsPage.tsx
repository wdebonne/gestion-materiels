import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { LifeBuoy, Plus, Trash2, Info, Building2, Users } from 'lucide-react'
import {
  siteApi,
  ticketReferentielApi,
  type CategorieDemande,
  type StatutTicket,
} from '@/lib/api'
import api from '@/lib/api'
import {
  Badge,
  Button,
  Card,
  CardBody,
  Input,
  LoadingInline,
  Select,
  Tab,
  Tabs,
} from '@/components/ui'
import ReglesNotification from '@/components/tickets/ReglesNotification'
import Rattachements from '@/components/tickets/Rattachements'

/**
 * Réglages du module Tickets.
 *
 * Quatre onglets, qui répondent à quatre questions distinctes : quels états une
 * demande traverse, comment elle est acheminée, où elle peut être signalée, et
 * qui voit quoi.
 *
 * Deux réglages méritent d'être expliqués **dans l'écran** plutôt que dans une
 * documentation que personne n'ouvrira :
 *
 *   — **la visibilité** décide si les collègues d'un bâtiment voient la demande.
 *     C'est ce qui évite trois signalements pour un même rideau cassé, et ce
 *     qu'il ne faut surtout pas activer sur l'informatique ;
 *   — **le service destinataire** est ce qui fait qu'une demande part toute
 *     seule au bon endroit. Une catégorie sans service laisse la demande sans
 *     personne pour la voir : l'écran le signale en rouge.
 */

export default function TicketsSettingsPage() {
  const [onglet, setOnglet] = useState('statuts')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <LifeBuoy className="w-6 h-6 text-primary-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Tickets</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            États, acheminement des demandes, bâtiments et destinataires des courriels
          </p>
        </div>
      </div>

      <Tabs value={onglet} onChange={setOnglet}>
        <Tab value="statuts" label="États" />
        <Tab value="categories" label="Catégories et acheminement" />
        <Tab value="rattachements" label="Qui a droit à quoi" />
        <Tab value="batiments" label="Sites et bâtiments" />
        <Tab value="notifications" label="Notifications" />
      </Tabs>

      {onglet === 'statuts' && <ReglagesStatuts />}
      {onglet === 'categories' && <ReglagesCategories />}
      {onglet === 'rattachements' && <Rattachements />}
      {onglet === 'batiments' && <ReglagesBatiments />}
      {onglet === 'notifications' && <ReglesNotification />}
    </div>
  )
}

// ------------------------------------------------------------------- les états

function ReglagesStatuts() {
  const queryClient = useQueryClient()
  const [nouveau, setNouveau] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', 'statuts', 'tous'],
    queryFn: async () => (await ticketReferentielApi.statuts(true)).data,
  })

  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ['tickets'] })

  const creer = useMutation({
    mutationFn: () => ticketReferentielApi.creerStatut({ nom: nouveau, ouvert: true }),
    onSuccess: () => {
      setNouveau('')
      rafraichir()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Création impossible'),
  })

  const modifier = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      ticketReferentielApi.modifierStatut(id, data),
    onSuccess: rafraichir,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Modification impossible'),
  })

  const supprimer = useMutation({
    mutationFn: (id: number) => ticketReferentielApi.supprimerStatut(id),
    onSuccess: rafraichir,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Suppression impossible'),
  })

  if (isLoading) return <LoadingInline />

  return (
    <Card>
      <CardBody className="space-y-4">
        <p className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-primary-600" />
          <span>
            <strong>Ouvert</strong> compte la demande comme à traiter.{' '}
            <strong>Par défaut</strong> est l'état d'une demande qui vient d'être ouverte — un seul
            statut peut le porter. <strong>Final</strong> clôt la demande et pose sa date de
            clôture. « En attente de retour » est ouvert sans être le défaut ; « refusé » est final
            sans être une résolution.
          </span>
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="py-2">Nom</th>
                <th className="py-2 text-center">Ouvert</th>
                <th className="py-2 text-center">Par défaut</th>
                <th className="py-2 text-center">Final</th>
                <th className="py-2 text-center">Actif</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {(data?.statuts ?? []).map((s: StatutTicket) => (
                <tr key={s.id}>
                  <td className="py-2">
                    <input
                      defaultValue={s.nom}
                      onBlur={(e) =>
                        e.target.value !== s.nom &&
                        modifier.mutate({ id: s.id, data: { nom: e.target.value } })
                      }
                      className="bg-transparent border-b border-transparent hover:border-gray-300 focus:border-primary-500 outline-none text-gray-900 dark:text-white"
                    />
                    {s.systeme && (
                      <Badge variant="default" className="ml-2 text-xs">
                        système
                      </Badge>
                    )}
                  </td>
                  {(['ouvert', 'defaut', 'final', 'actif'] as const).map((champ) => (
                    <td key={champ} className="py-2 text-center">
                      <input
                        type="checkbox"
                        checked={s[champ]}
                        onChange={(e) => modifier.mutate({ id: s.id, data: { [champ]: e.target.checked } })}
                        className="rounded border-gray-300"
                      />
                    </td>
                  ))}
                  <td className="py-2 text-right">
                    {/* Un statut système se renomme et se recolore, jamais ne
                        se supprime : le code a besoin d'un point de départ et
                        d'un point d'arrivée. */}
                    {!s.systeme && (
                      <button
                        onClick={() => supprimer.mutate(s.id)}
                        className="text-gray-400 hover:text-red-600"
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex gap-2">
          <Input
            value={nouveau}
            onChange={(e: any) => setNouveau(e.target.value)}
            placeholder="Nouvel état…"
            className="flex-1"
          />
          <Button
            icon={<Plus className="w-4 h-4" />}
            disabled={nouveau.trim().length === 0}
            onClick={() => creer.mutate()}
          >
            Ajouter
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

// -------------------------------------------------------------- les catégories

function ReglagesCategories() {
  const queryClient = useQueryClient()
  const [nouvelle, setNouvelle] = useState('')
  const [parentId, setParentId] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', 'categories', 'toutes'],
    queryFn: async () => (await ticketReferentielApi.categories(true)).data,
  })

  const { data: services } = useQuery({
    queryKey: ['services'],
    queryFn: async () => (await api.get('/services')).data,
  })

  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ['tickets'] })

  const creer = useMutation({
    mutationFn: () => ticketReferentielApi.creerCategorie({ nom: nouvelle, parentId }),
    onSuccess: () => {
      setNouvelle('')
      rafraichir()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Création impossible'),
  })

  const modifier = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      ticketReferentielApi.modifierCategorie(id, data),
    onSuccess: rafraichir,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Modification impossible'),
  })

  const appliquer = useMutation({
    mutationFn: (id: number) => ticketReferentielApi.appliquerVisibilite(id),
    onSuccess: ({ data }) => {
      toast.success(`${data.modifiees} demande(s) mise(s) à jour`)
      rafraichir()
    },
  })

  const supprimer = useMutation({
    mutationFn: (id: number) => ticketReferentielApi.supprimerCategorie(id),
    onSuccess: rafraichir,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Suppression impossible'),
  })

  if (isLoading) return <LoadingInline />

  const categories = data?.categories ?? []
  const racines = categories.filter((c: CategorieDemande) => c.parentId === null)
  const listeServices = services?.data ?? services?.services ?? []

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <p className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-primary-600" />
            <span>
              Le <strong>service</strong> d'une catégorie décide à qui la demande part, sans qu'on
              ait à le demander au demandeur. La <strong>visibilité</strong> décide si les collègues
              du bâtiment la voient : « partagée » évite trois signalements pour un même rideau
              cassé, « privée » convient à l'informatique. Une sous-catégorie laissée sur
              « hérite » reprend le réglage de sa catégorie.
            </span>
          </p>
        </CardBody>
      </Card>

      {racines.map((c: CategorieDemande) => (
        <Card key={c.id}>
          <CardBody className="space-y-3">
            <FicheCategorie
              categorie={c}
              services={listeServices}
              racine
              onModifier={(data) => modifier.mutate({ id: c.id, data })}
              onAppliquer={() => appliquer.mutate(c.id)}
              onSupprimer={() => supprimer.mutate(c.id)}
            />

            <div className="pl-6 border-l-2 border-gray-100 dark:border-gray-700 space-y-3">
              {categories
                .filter((sc: CategorieDemande) => sc.parentId === c.id)
                .map((sc: CategorieDemande) => (
                  <FicheCategorie
                    key={sc.id}
                    categorie={sc}
                    services={listeServices}
                    onModifier={(data) => modifier.mutate({ id: sc.id, data })}
                    onAppliquer={() => appliquer.mutate(sc.id)}
                    onSupprimer={() => supprimer.mutate(sc.id)}
                  />
                ))}
            </div>
          </CardBody>
        </Card>
      ))}

      <Card>
        <CardBody className="flex flex-col sm:flex-row gap-2">
          <Select
            value={parentId ?? ''}
            onChange={(e: any) => setParentId(e.target.value ? Number(e.target.value) : null)}
            options={[
              { value: '', label: 'Nouvelle catégorie' },
              ...racines.map((c: CategorieDemande) => ({
                value: String(c.id),
                label: `Sous-catégorie de ${c.nom}`,
              })),
            ]}
            className="sm:w-64"
          />
          <Input
            value={nouvelle}
            onChange={(e: any) => setNouvelle(e.target.value)}
            placeholder="Nom…"
            className="flex-1"
          />
          <Button
            icon={<Plus className="w-4 h-4" />}
            disabled={nouvelle.trim().length === 0}
            onClick={() => creer.mutate()}
          >
            Ajouter
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}

function FicheCategorie({
  categorie,
  services,
  racine,
  onModifier,
  onAppliquer,
  onSupprimer,
}: {
  categorie: CategorieDemande
  services: any[]
  racine?: boolean
  onModifier: (data: Record<string, unknown>) => void
  onAppliquer: () => void
  onSupprimer: () => void
}) {
  const sansService = categorie.serviceId === null && racine

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <input
          defaultValue={categorie.nom}
          onBlur={(e) => e.target.value !== categorie.nom && onModifier({ nom: e.target.value })}
          className={`bg-transparent border-b border-transparent hover:border-gray-300 focus:border-primary-500 outline-none text-gray-900 dark:text-white ${
            racine ? 'font-semibold' : 'text-sm'
          }`}
        />
        <button onClick={onSupprimer} className="text-gray-400 hover:text-red-600" title="Supprimer">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Une catégorie racine sans service laisse la demande sans personne pour
          la voir : on le dit, au lieu de laisser le découvrir. */}
      {sansService && (
        <p className="text-xs text-red-600">
          Aucun service destinataire : les demandes de cette catégorie n'iront à personne.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Select
          label="Service destinataire"
          value={categorie.serviceId ?? ''}
          onChange={(e: any) => onModifier({ serviceId: e.target.value || null })}
          options={[
            { value: '', label: racine ? 'Aucun' : 'Hérite de la catégorie' },
            ...services.map((s: any) => ({ value: String(s.id), label: s.name })),
          ]}
        />
        <Select
          label="Visibilité"
          value={categorie.visibilite ?? ''}
          onChange={(e: any) => onModifier({ visibilite: e.target.value || null })}
          options={[
            { value: '', label: racine ? 'Privée' : 'Hérite de la catégorie' },
            { value: 'privee', label: 'Privée' },
            { value: 'site', label: 'Partagée avec le bâtiment' },
          ]}
        />
        <Select
          label="Matériel"
          value={categorie.materielMode ?? ''}
          onChange={(e: any) => onModifier({ materielMode: e.target.value || null })}
          options={[
            { value: '', label: racine ? 'Aucun' : 'Hérite de la catégorie' },
            { value: 'aucun', label: 'Non demandé' },
            { value: 'optionnel', label: 'Proposé' },
            { value: 'requis', label: 'Obligatoire' },
          ]}
        />
        <Select
          label="Bâtiment"
          value={categorie.siteMode ?? ''}
          onChange={(e: any) => onModifier({ siteMode: e.target.value || null })}
          options={[
            { value: '', label: racine ? 'Selon la personne' : 'Hérite de la catégorie' },
            { value: 'auto', label: 'Selon la personne' },
            { value: 'requis', label: 'Toujours demandé' },
            { value: 'masque', label: 'Jamais demandé' },
          ]}
        />
        <Input
          label="Délai de prise en charge (min)"
          type="number"
          defaultValue={categorie.slaPriseEnChargeMinutes ?? ''}
          onBlur={(e: any) => onModifier({ slaPriseEnChargeMinutes: e.target.value || null })}
        />
        <Input
          label="Délai de résolution (min)"
          type="number"
          defaultValue={categorie.slaResolutionMinutes ?? ''}
          onBlur={(e: any) => onModifier({ slaResolutionMinutes: e.target.value || null })}
        />
      </div>

      {/* Le réglage ne rétroagit pas : basculer en partagé n'expose pas d'un
          coup des demandes écrites quand elles étaient privées. Ce bouton est
          le geste explicite qui le rattrape. */}
      <Button variant="outline" size="sm" onClick={onAppliquer}>
        Appliquer la visibilité aux demandes existantes
      </Button>
    </div>
  )
}

// ------------------------------------------------------------- les bâtiments

function ReglagesBatiments() {
  const queryClient = useQueryClient()
  const [nouveau, setNouveau] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['sites', 'tous'],
    queryFn: async () => (await siteApi.liste(true)).data,
  })

  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ['sites'] })

  const creer = useMutation({
    mutationFn: () => siteApi.creer({ nom: nouveau }),
    onSuccess: () => {
      setNouveau('')
      rafraichir()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Création impossible'),
  })

  const modifier = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      siteApi.modifier(id, data),
    onSuccess: rafraichir,
  })

  const supprimer = useMutation({
    mutationFn: (id: number) => siteApi.supprimer(id),
    onSuccess: rafraichir,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Suppression impossible'),
  })

  if (isLoading) return <LoadingInline />

  return (
    <Card>
      <CardBody className="space-y-4">
        <p className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-primary-600" />
          <span>
            Ces bâtiments sont ceux du module Clés : ils servent aux deux, et se tiennent à jour au
            même endroit. Un bâtiment cité par une demande ne peut plus être supprimé — l'historique
            perdrait son lieu — mais il se <strong>désactive</strong>, ce qui le retire des
            formulaires sans toucher au passé.
          </span>
        </p>

        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {(data?.sites ?? []).map((s) => (
            <li key={s.id} className="py-2 flex items-center gap-3">
              <Building2 className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                defaultValue={s.nom}
                onBlur={(e) => e.target.value !== s.nom && modifier.mutate({ id: s.id, data: { nom: e.target.value } })}
                className="flex-1 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-primary-500 outline-none text-gray-900 dark:text-white"
              />
              <label className="inline-flex items-center gap-2 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={s.actif}
                  onChange={(e) => modifier.mutate({ id: s.id, data: { actif: e.target.checked } })}
                  className="rounded border-gray-300"
                />
                actif
              </label>
              <button
                onClick={() => supprimer.mutate(s.id)}
                className="text-gray-400 hover:text-red-600"
                title="Supprimer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>

        <div className="flex gap-2">
          <Input
            value={nouveau}
            onChange={(e: any) => setNouveau(e.target.value)}
            placeholder="Nouveau bâtiment…"
            className="flex-1"
          />
          <Button
            icon={<Plus className="w-4 h-4" />}
            disabled={nouveau.trim().length === 0}
            onClick={() => creer.mutate()}
          >
            Ajouter
          </Button>
        </div>

        <p className="flex items-start gap-2 text-xs text-gray-500">
          <Users className="w-4 h-4 mt-0.5 shrink-0" />
          Le rattachement des personnes à leurs bâtiments, et le droit de lire les demandes d'un
          bâtiment, se règlent sur la fiche de chaque compte dans Paramètres › Utilisateurs.
        </p>
      </CardBody>
    </Card>
  )
}
