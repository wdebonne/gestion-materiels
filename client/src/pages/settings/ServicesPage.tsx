import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, Plus, Trash2, Eye, UserPlus, X, Crown, Star, UserCheck } from 'lucide-react'
import {
  Card, CardBody, CardHeader, CardTitle, Input, Select, Button, Alert, Badge,
  Modal, ModalBody, ModalFooter, Spinner, TextArea
} from '@/components/ui'
import api, { serviceApi, delegationApi, type Service } from '@/lib/api'
import toast from 'react-hot-toast'

/**
 * Services concernés par les manifestations.
 *
 * Un service est un groupe de personnes **et** un périmètre de catégories de
 * matériel. C'est ce périmètre qui décide qui est sollicité : sans matériel de
 * ses catégories dans une demande, un service n'est ni alerté, ni destinataire,
 * et ne voit pas la manifestation.
 *
 * Un service *observateur* — direction générale, élus — n'a pas de périmètre :
 * il suit tout, sans rien approuver.
 */

export default function ServicesPage() {
  const queryClient = useQueryClient()
  const [creationOuverte, setCreationOuverte] = useState(false)
  const [serviceOuvert, setServiceOuvert] = useState<number | null>(null)

  const { data: services = [], isLoading } = useQuery({
    queryKey: ['services'],
    queryFn: async () => (await serviceApi.getAll()).data.data,
  })

  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ['services'] })

  const creation = useMutation({
    mutationFn: (data: {
      name: string
      email?: string
      description?: string
      is_observer?: boolean
      is_coordinator?: boolean
    }) => serviceApi.create(data),
    onSuccess: (res) => {
      rafraichir()
      setCreationOuverte(false)
      setServiceOuvert(res.data.data.id)
      toast.success('Service créé')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  const suppression = useMutation({
    mutationFn: (id: number) => serviceApi.remove(id),
    onSuccess: (res) => {
      rafraichir()
      // Un service qui a rendu des décisions est désactivé, pas supprimé :
      // l'effacer réécrirait la traçabilité d'une manifestation.
      toast.success(res.data.message || 'Service supprimé')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Building2 className="w-5 h-5" /> Services
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Un service n'est sollicité que si une manifestation demande du matériel de son périmètre.
          </p>
        </div>
        <Button icon={<Plus className="w-4 h-4" />} onClick={() => setCreationOuverte(true)}>
          Nouveau service
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : services.length === 0 ? (
        <Alert type="info">
          <span className="text-sm">
            Aucun service. Créez-en un par métier concerné — festivités, informatique,
            restauration — et donnez-lui les catégories de matériel dont il répond.
          </span>
        </Alert>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {services.map((service) => (
            <Card key={service.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{service.name}</span>
                      {service.is_coordinator ? (
                        <Badge variant="success"><Crown className="w-3 h-3 inline mr-1" />Coordinateur</Badge>
                      ) : null}
                      {service.is_observer ? (
                        <Badge variant="info"><Eye className="w-3 h-3 inline mr-1" />Observateur</Badge>
                      ) : null}
                      {!service.is_active && <Badge variant="default">Désactivé</Badge>}
                    </div>
                    {service.email && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{service.email}</p>
                    )}
                    <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                      {service.members_count ?? 0} membre(s)
                      {!service.is_observer && ` · ${service.categories_count ?? 0} catégorie(s)`}
                    </p>
                    {!service.is_observer && !service.is_coordinator && (service.categories_count ?? 0) === 0 && (
                      <p className="text-xs text-yellow-700 dark:text-yellow-500 mt-1">
                        Sans catégorie, ce service ne sera jamais sollicité.
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => setServiceOuvert(service.id)}>
                      Configurer
                    </Button>
                    <Button size="sm" variant="outline" aria-label={`Supprimer ${service.name}`}
                      icon={<Trash2 className="w-4 h-4 text-red-500" />}
                      onClick={() => suppression.mutate(service.id)} />
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {creationOuverte && (
        <ModaleCreation
          loading={creation.isPending}
          onClose={() => setCreationOuverte(false)}
          onSave={(data) => creation.mutate(data)}
        />
      )}

      {serviceOuvert !== null && (
        <ModaleConfiguration
          serviceId={serviceOuvert}
          onClose={() => {
            setServiceOuvert(null)
            rafraichir()
          }}
        />
      )}
    </div>
  )
}

function ModaleCreation({ onClose, onSave, loading }: {
  onClose: () => void
  onSave: (data: {
    name: string
    email?: string
    description?: string
    is_observer?: boolean
    is_coordinator?: boolean
  }) => void
  loading: boolean
}) {
  const [nom, setNom] = useState('')
  const [email, setEmail] = useState('')
  const [description, setDescription] = useState('')
  const [observateur, setObservateur] = useState(false)
  const [coordinateur, setCoordinateur] = useState(false)

  return (
    <Modal isOpen onClose={onClose} title="Nouveau service">
      <ModalBody>
        <div className="space-y-4">
          <Input label="Nom" value={nom} placeholder="Service informatique"
            onChange={(e) => setNom(e.target.value)} />
          <Input label="Boîte partagée (facultatif)" type="email" value={email}
            placeholder="informatique@ville.fr"
            onChange={(e) => setEmail(e.target.value)} />
          <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2">
            Une boîte partagée survit aux départs, contrairement à l'adresse d'un agent.
            Les membres reçoivent les messages dans tous les cas.
          </p>
          <TextArea label="Description" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} />
          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" className="mt-1" checked={observateur}
              onChange={(e) => setObservateur(e.target.checked)} />
            <span>
              <strong>Observateur</strong> — suit toutes les manifestations sans rien approuver.
              C'est la case d'une direction générale ou d'élus.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" className="mt-1" checked={coordinateur}
              onChange={(e) => setCoordinateur(e.target.checked)} />
            <span>
              <strong>Coordinateur</strong> — pilote toutes les manifestations : il est sollicité
              sur chacune, reçoit tout, et son approbation prononce la validation. Un seul service
              à la fois.
            </span>
          </label>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>Annuler</Button>
        <Button loading={loading} disabled={!nom.trim()}
          onClick={() =>
            onSave({
              name: nom.trim(),
              email: email.trim() || undefined,
              description,
              is_observer: observateur,
              is_coordinator: coordinateur,
            })
          }>
          Créer
        </Button>
      </ModalFooter>
    </Modal>
  )
}

function ModaleConfiguration({ serviceId, onClose }: { serviceId: number; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [membreId, setMembreId] = useState('')

  const { data: service, isLoading } = useQuery({
    queryKey: ['service', serviceId],
    queryFn: async () => (await serviceApi.getById(serviceId)).data.data,
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories-simple'],
    queryFn: async () => {
      const res = await api.get('/categories')
      return (res.data.categories || res.data.data || []) as Array<{ id: number; name: string }>
    },
  })

  const { data: utilisateurs = [] } = useQuery({
    queryKey: ['users-simple'],
    queryFn: async () => {
      const res = await api.get('/users')
      return (res.data.users || res.data.data || []) as Array<{
        id: number; email: string; first_name: string; last_name: string
      }>
    },
  })

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['service', serviceId] })
    queryClient.invalidateQueries({ queryKey: ['services'] })
  }

  const surErreur = (err: any) => toast.error(err.response?.data?.message || 'Erreur')

  const perimetre = useMutation({
    mutationFn: (ids: number[]) => serviceApi.setCategories(serviceId, ids),
    onSuccess: rafraichir,
    onError: surErreur,
  })

  const reglages = useMutation({
    mutationFn: (champs: Partial<Service>) =>
      serviceApi.update(serviceId, { ...(service as Service), ...champs, name: service!.name }),
    onSuccess: rafraichir,
    onError: surErreur,
  })

  const ajoutMembre = useMutation({
    mutationFn: (userId: number) => serviceApi.addMember(serviceId, userId),
    onSuccess: () => {
      rafraichir()
      setMembreId('')
    },
    onError: surErreur,
  })

  const responsable = useMutation({
    mutationFn: ({ userId, is_manager }: { userId: number; is_manager: boolean }) =>
      delegationApi.definirResponsable(serviceId, userId, is_manager),
    onSuccess: rafraichir,
    onError: surErreur,
  })

  const retraitMembre = useMutation({
    mutationFn: (userId: number) => serviceApi.removeMember(serviceId, userId),
    onSuccess: rafraichir,
    onError: surErreur,
  })

  const categoriesRetenues = new Set((service?.categories ?? []).map((c) => c.id))

  const basculerCategorie = (id: number) => {
    const suivant = new Set(categoriesRetenues)
    if (suivant.has(id)) suivant.delete(id)
    else suivant.add(id)
    perimetre.mutate([...suivant])
  }

  const DECLENCHEURS: Array<{ champ: keyof Service; libelle: string; aide: string }> = [
    { champ: 'notify_new_request', libelle: 'Sollicitation', aide: 'Quand ce service est sollicité pour approbation' },
    { champ: 'notify_status_change', libelle: 'Statut et dates', aide: 'Décisions, changements de date, rappels de livraison' },
    { champ: 'notify_material_change', libelle: 'Matériel', aide: 'Ajout ou retrait de matériel sur une manifestation suivie' },
    { champ: 'notify_message', libelle: 'Messages', aide: 'Échanges dans le fil de la manifestation' },
  ]

  return (
    <Modal isOpen onClose={onClose} title={service ? `Configurer — ${service.name}` : 'Configurer'} size="lg">
      <ModalBody>
        {isLoading || !service ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Rôle du service</CardTitle></CardHeader>
              <CardBody className="space-y-2">
                <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={Boolean(service.is_coordinator)}
                    onChange={(e) => reglages.mutate({ is_coordinator: e.target.checked ? 1 : 0 })}
                  />
                  <span>
                    <strong>Coordinateur des manifestations</strong> — sollicité sur chacune, même
                    celles qui ne touchent pas son périmètre. Il reçoit tout, voit tout, et son
                    approbation <strong>prononce la validation</strong> une fois les services
                    concernés ont répondu. Le désigner retire ce rôle au service qui l'avait.
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={Boolean(service.is_observer)}
                    onChange={(e) => reglages.mutate({ is_observer: e.target.checked ? 1 : 0 })}
                  />
                  <span>
                    <strong>Observateur</strong> — suit tout sans rien approuver. Direction
                    générale, maire, élus.
                  </span>
                </label>
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Périmètre de matériel</CardTitle></CardHeader>
              <CardBody>
                {service.is_observer ? (
                  <Alert type="info">
                    <span className="text-sm">
                      Ce service est observateur : il suit toutes les manifestations, sans périmètre
                      ni approbation à rendre.
                    </span>
                  </Alert>
                ) : (
                  <>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                      Ce service sera sollicité dès qu'une manifestation demande du matériel de
                      l'une de ces catégories — et de personne d'autre.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {categories.map((c) => (
                        <label key={c.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                          <input
                            type="checkbox"
                            checked={categoriesRetenues.has(c.id)}
                            onChange={() => basculerCategorie(c.id)}
                          />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Membres</CardTitle></CardHeader>
              <CardBody className="space-y-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Tous les membres reçoivent les avis du service. Seul le <strong>responsable</strong>
                  approuve en son nom — et lui seul peut déléguer.
                </p>

                {(service.members ?? []).length > 0 && (
                  <div className="space-y-1">
                    {service.members!.map((membre) => (
                      <div key={membre.id}
                        className="flex flex-wrap items-center gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800">
                        <span className="text-sm text-gray-900 dark:text-gray-100 flex-1 min-w-0 truncate">
                          {membre.first_name} {membre.last_name}
                          <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">{membre.email}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => responsable.mutate({ userId: membre.id, is_manager: !membre.is_manager })}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${
                            membre.is_manager
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
                          title={membre.is_manager ? 'Retirer le rôle de responsable' : 'Désigner responsable'}
                        >
                          <Star className={`w-3 h-3 ${membre.is_manager ? 'fill-current' : ''}`} />
                          {membre.is_manager ? 'Responsable' : 'Désigner'}
                        </button>
                        <button type="button" onClick={() => retraitMembre.mutate(membre.id)}
                          aria-label={`Retirer ${membre.first_name} ${membre.last_name}`}
                          className="p-1 hover:text-red-600">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {(service.members ?? []).length > 0 && !(service.members ?? []).some((m) => m.is_manager) && (
                  <Alert type="warning">
                    <span className="text-sm">
                      Aucun responsable désigné : ce service ne peut rien approuver, et une
                      manifestation qui l'attend restera bloquée.
                    </span>
                  </Alert>
                )}
                <div className="flex gap-2">
                  <Select
                    value={membreId}
                    onChange={(e) => setMembreId(e.target.value)}
                    options={[
                      { value: '', label: '— Ajouter une personne —' },
                      ...utilisateurs
                        .filter((u) => !(service.members ?? []).some((m) => m.id === u.id))
                        .map((u) => ({ value: u.id, label: `${u.first_name} ${u.last_name} (${u.email})` })),
                    ]}
                  />
                  <Button size="sm" variant="outline" icon={<UserPlus className="w-4 h-4" />}
                    disabled={!membreId} loading={ajoutMembre.isPending}
                    onClick={() => ajoutMembre.mutate(Number(membreId))}>
                    Ajouter
                  </Button>
                </div>
              </CardBody>
            </Card>

            <Delegations serviceId={serviceId} membres={service.members ?? []} />

            <Card>
              <CardHeader><CardTitle className="text-sm">Ce que ce service reçoit</CardTitle></CardHeader>
              <CardBody className="space-y-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Ces réglages ne concernent que les manifestations qui touchent déjà ce service.
                </p>
                {DECLENCHEURS.map(({ champ, libelle, aide }) => (
                  <label key={String(champ)} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={Boolean(service[champ])}
                      onChange={(e) => reglages.mutate({ [champ]: e.target.checked ? 1 : 0 } as Partial<Service>)}
                    />
                    <span><strong>{libelle}</strong> — {aide}</span>
                  </label>
                ))}
              </CardBody>
            </Card>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose}>Fermer</Button>
      </ModalFooter>
    </Modal>
  )
}

/**
 * Délégations d'approbation d'un service.
 *
 * Approuver engage la collectivité : la décision revient au responsable. Quand
 * il s'absente, il désigne lui-même qui décide à sa place — et lui seul, car une
 * délégation qui se redéléguerait rendrait la chaîne de responsabilité
 * inconnaissable.
 */
function Delegations({ serviceId, membres }: {
  serviceId: number
  membres: Array<{ id: number; first_name: string; last_name: string; email: string; is_manager: number }>
}) {
  const queryClient = useQueryClient()
  const [destinataire, setDestinataire] = useState('')
  const [debut, setDebut] = useState('')
  const [fin, setFin] = useState('')

  const { data: delegations = [], isError } = useQuery({
    queryKey: ['service-delegations', serviceId],
    queryFn: async () => (await delegationApi.lister(serviceId)).data.data,
    // Un compte qui n'est pas responsable reçoit un 403 : ce n'est pas une
    // panne, il n'a simplement rien à gérer ici.
    retry: false,
  })

  const rafraichir = () =>
    queryClient.invalidateQueries({ queryKey: ['service-delegations', serviceId] })

  const accorder = useMutation({
    mutationFn: () =>
      delegationApi.accorder(serviceId, {
        delegate_user_id: Number(destinataire),
        start_date: debut || undefined,
        end_date: fin || undefined,
      }),
    onSuccess: () => {
      rafraichir()
      setDestinataire('')
      setDebut('')
      setFin('')
      toast.success('Délégation accordée')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  const revoquer = useMutation({
    mutationFn: (id: number) => delegationApi.revoquer(serviceId, id),
    onSuccess: () => {
      rafraichir()
      toast.success('Délégation révoquée')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  if (isError) return null

  const formatDate = (valeur: string | null) =>
    valeur ? new Date(valeur).toLocaleDateString('fr-FR') : null

  const periode = (d: { start_date: string | null; end_date: string | null }) => {
    const debutTexte = formatDate(d.start_date)
    const finTexte = formatDate(d.end_date)
    if (!debutTexte && !finTexte) return "jusqu'à révocation"
    if (debutTexte && finTexte) return `du ${debutTexte} au ${finTexte}`
    return debutTexte ? `à partir du ${debutTexte}` : `jusqu'au ${finTexte}`
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <UserCheck className="w-4 h-4" /> Délégations d'approbation
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Le délégataire approuve à la place du responsable pendant la période indiquée. Sans dates,
          la délégation vaut jusqu'à révocation — le cas d'un adjoint permanent.
        </p>

        {delegations.length > 0 && (
          <div className="space-y-1">
            {delegations.map((d) => (
              <div key={d.id}
                className="flex flex-wrap items-center gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800">
                <span className="text-sm text-gray-900 dark:text-gray-100 flex-1 min-w-0">
                  {d.delegate_name}
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">{periode(d)}</span>
                </span>
                <button type="button" onClick={() => revoquer.mutate(d.id)}
                  aria-label={`Révoquer la délégation de ${d.delegate_name}`}
                  className="p-1 hover:text-red-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[12rem]">
            <Select
              label="Déléguer à"
              value={destinataire}
              onChange={(e) => setDestinataire(e.target.value)}
              options={[
                { value: '', label: '— Choisir un membre —' },
                ...membres
                  .filter((m) => !m.is_manager)
                  .map((m) => ({ value: m.id, label: `${m.first_name} ${m.last_name}` })),
              ]}
            />
          </div>
          <div className="w-36">
            <Input label="Du (facultatif)" type="date" size="sm" value={debut}
              onChange={(e) => setDebut(e.target.value)} />
          </div>
          <div className="w-36">
            <Input label="Au (facultatif)" type="date" size="sm" value={fin}
              onChange={(e) => setFin(e.target.value)} />
          </div>
          <Button size="sm" variant="outline" disabled={!destinataire} loading={accorder.isPending}
            onClick={() => accorder.mutate()}>
            Déléguer
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
