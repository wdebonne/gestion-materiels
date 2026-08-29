import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, X, MinusCircle, Send, UserPlus, Trash2, Clock } from 'lucide-react'
import {
  Card, CardBody, CardHeader, CardTitle, Input, Select, Button, Alert, Badge, TextArea
} from '@/components/ui'
import {
  serviceApi, suiviApi,
  type Approbation, type StatutApprobation, type Service,
} from '@/lib/api'
import { usePermissions } from '@/lib/permissions'
import { useAuthStore } from '@/stores/auth.store'
import toast from 'react-hot-toast'

/**
 * Suivi partagé d'une manifestation : approbations, échanges, copies.
 *
 * Une manifestation municipale engage plusieurs services. Ce panneau est
 * l'endroit où ils se répondent, et où reste la trace de qui a approuvé quoi et
 * quand — jusqu'à l'archivage, et au-delà en cas de litige.
 *
 * Un service ne voit ici que les manifestations qui le concernent : le filtrage
 * est fait par le serveur (`manifestationScope.ts`), jamais par cet écran.
 */

const LIBELLES_STATUT: Record<StatutApprobation, string> = {
  pending: 'En attente',
  approved: 'Approuvé',
  rejected: 'Refusé',
  not_concerned: 'Non concerné',
}

const COULEURS_STATUT: Record<StatutApprobation, string> = {
  pending: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  not_concerned: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
}

const formatDate = (valeur: string | null): string =>
  valeur ? new Date(valeur).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

export default function ManifestationSuivi({ manifestationId }: { manifestationId: number }) {
  const queryClient = useQueryClient()
  const { canManage, role } = usePermissions()
  const utilisateur = useAuthStore((s) => s.user)

  const { data: approbations = [] } = useQuery({
    queryKey: ['manifestation-approvals', manifestationId],
    queryFn: async () => (await suiviApi.getApprovals(manifestationId)).data.data,
  })

  const { data: messages = [] } = useQuery({
    queryKey: ['manifestation-messages', manifestationId],
    queryFn: async () => (await suiviApi.getMessages(manifestationId)).data.data,
  })

  const { data: mesServices = [] } = useQuery({
    queryKey: ['mes-services'],
    queryFn: async () => (await serviceApi.getMine()).data.data,
  })

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['manifestation-approvals', manifestationId] })
    queryClient.invalidateQueries({ queryKey: ['manifestation-messages', manifestationId] })
    queryClient.invalidateQueries({ queryKey: ['manifestation-history', manifestationId] })
    queryClient.invalidateQueries({ queryKey: ['manifestations'] })
  }

  const attendues = approbations.filter((a) => a.kind === 'approbation' && a.status === 'pending')

  return (
    <div className="space-y-4">
      <Approbations
        manifestationId={manifestationId}
        approbations={approbations}
        attendues={attendues}
        mesServices={mesServices}
        peutSolliciter={canManage}
        estAdmin={role === 'admin'}
        monId={utilisateur?.id}
        onChange={rafraichir}
      />

      <Conversation
        manifestationId={manifestationId}
        messages={messages}
        onChange={rafraichir}
      />

      {canManage && <Copies manifestationId={manifestationId} />}
    </div>
  )
}

// ==================== APPROBATIONS ====================

function Approbations({
  manifestationId, approbations, attendues, mesServices, peutSolliciter, estAdmin, monId, onChange,
}: {
  manifestationId: number
  approbations: Approbation[]
  attendues: Approbation[]
  mesServices: Service[]
  peutSolliciter: boolean
  estAdmin: boolean
  monId?: number
  onChange: () => void
}) {
  const [sollicitationOuverte, setSollicitationOuverte] = useState(false)

  const decision = useMutation({
    mutationFn: ({ id, status, comment, delivery_date, recovery_date }: {
      id: number; status: StatutApprobation; comment?: string
      delivery_date?: string; recovery_date?: string
    }) => suiviApi.decide(manifestationId, id, { status, comment, delivery_date, recovery_date }),
    onSuccess: () => {
      onChange()
      toast.success('Décision enregistrée')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  /**
   * Ai-je le droit de répondre pour cette sollicitation ?
   *
   * Le serveur tranche de toute façon ; masquer les boutons évite qu'on remplisse
   * un formulaire pour rien.
   */
  const peutRepondre = (a: Approbation): boolean => {
    if (estAdmin) return true
    if (a.service_id) return mesServices.some((s) => s.id === a.service_id)
    return a.user_id === monId
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="text-sm">Approbations des services</CardTitle>
        {peutSolliciter && (
          <Button size="sm" variant="outline" icon={<UserPlus className="w-4 h-4" />}
            onClick={() => setSollicitationOuverte(!sollicitationOuverte)}>
            Solliciter
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-3">
        {attendues.length > 0 && (
          <Alert type="warning">
            <span className="text-sm">
              En attente de : {attendues.map((a) => a.service_name || 'un destinataire').join(', ')}.
              La manifestation ne peut pas être validée tant qu'un service concerné n'a pas répondu.
            </span>
          </Alert>
        )}

        {approbations.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Aucun service sollicité. Les services sont sollicités automatiquement dès qu'une
            manifestation demande du matériel relevant de leur périmètre.
          </p>
        ) : (
          <div className="space-y-2">
            {approbations.map((a) => (
              <LigneApprobation
                key={a.id}
                approbation={a}
                peutRepondre={peutRepondre(a)}
                enCours={decision.isPending}
                onDecide={(status, comment, delivery_date, recovery_date) =>
                  decision.mutate({ id: a.id, status, comment, delivery_date, recovery_date })
                }
              />
            ))}
          </div>
        )}

        {sollicitationOuverte && (
          <FormulaireSollicitation
            manifestationId={manifestationId}
            onDone={() => {
              setSollicitationOuverte(false)
              onChange()
            }}
          />
        )}
      </CardBody>
    </Card>
  )
}

function LigneApprobation({ approbation, peutRepondre, enCours, onDecide }: {
  approbation: Approbation
  peutRepondre: boolean
  enCours: boolean
  onDecide: (s: StatutApprobation, c?: string, d?: string, r?: string) => void
}) {
  const [ouvert, setOuvert] = useState(false)
  const [commentaire, setCommentaire] = useState('')
  const [livraison, setLivraison] = useState(approbation.delivery_date || '')
  const [recuperation, setRecuperation] = useState(approbation.recovery_date || '')

  const nom = approbation.service_name || approbation.user_name || 'Destinataire'

  return (
    <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{nom}</span>
          {approbation.kind === 'information' && (
            <Badge variant="default" className="ml-2">Pour information</Badge>
          )}
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            <Clock className="w-3 h-3 inline mr-1" />
            Sollicité le {formatDate(approbation.requested_at)}
            {approbation.decided_at && ` · Répondu le ${formatDate(approbation.decided_at)}`}
            {approbation.decided_by_name && ` par ${approbation.decided_by_name}`}
          </div>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${COULEURS_STATUT[approbation.status]}`}>
          {LIBELLES_STATUT[approbation.status]}
        </span>
      </div>

      {approbation.comment && (
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 italic">« {approbation.comment} »</p>
      )}

      {(approbation.delivery_date || approbation.recovery_date) && (
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          Livraison : {approbation.delivery_date || '—'} · Récupération : {approbation.recovery_date || '—'}
        </p>
      )}

      {peutRepondre && approbation.status === 'pending' && (
        <div className="mt-3">
          {!ouvert ? (
            <Button size="sm" variant="outline" onClick={() => setOuvert(true)}>Répondre</Button>
          ) : (
            <div className="space-y-2">
              <TextArea
                rows={2}
                value={commentaire}
                placeholder="Précisions, conditions, réserves…"
                onChange={(e) => setCommentaire(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <div className="w-40">
                  <Input label="Ma livraison" type="date" size="sm" value={livraison}
                    onChange={(e) => setLivraison(e.target.value)} />
                </div>
                <div className="w-40">
                  <Input label="Ma récupération" type="date" size="sm" value={recuperation}
                    onChange={(e) => setRecuperation(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" loading={enCours} icon={<Check className="w-4 h-4" />}
                  onClick={() => onDecide('approved', commentaire, livraison, recuperation)}>
                  Approuver
                </Button>
                <Button size="sm" variant="outline" icon={<X className="w-4 h-4 text-red-600" />}
                  onClick={() => onDecide('rejected', commentaire)}>
                  Refuser
                </Button>
                <Button size="sm" variant="outline" icon={<MinusCircle className="w-4 h-4" />}
                  onClick={() => onDecide('not_concerned', commentaire)}>
                  Non concerné
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOuvert(false)}>Annuler</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FormulaireSollicitation({ manifestationId, onDone }: {
  manifestationId: number
  onDone: () => void
}) {
  const [serviceId, setServiceId] = useState('')
  const [type, setType] = useState<'approbation' | 'information'>('approbation')
  const [commentaire, setCommentaire] = useState('')

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: async () => (await serviceApi.getAll()).data.data,
  })

  const envoi = useMutation({
    mutationFn: () =>
      suiviApi.requestApproval(manifestationId, {
        service_id: Number(serviceId),
        kind: type,
        comment: commentaire.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success(type === 'information' ? 'Demande envoyée' : 'Approbation demandée')
      onDone()
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  return (
    <div className="p-3 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Select
          label="Service"
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          options={[
            { value: '', label: '— Choisir —' },
            ...services.filter((s) => s.is_active).map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <Select
          label="Nature"
          value={type}
          onChange={(e) => setType(e.target.value as 'approbation' | 'information')}
          options={[
            { value: 'approbation', label: 'Approbation (bloque la validation)' },
            { value: 'information', label: 'Pour information (ne bloque pas)' },
          ]}
        />
      </div>
      <TextArea rows={2} value={commentaire} placeholder="Ce que vous attendez de ce service"
        onChange={(e) => setCommentaire(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" loading={envoi.isPending} disabled={!serviceId} onClick={() => envoi.mutate()}>
          Envoyer
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Annuler</Button>
      </div>
    </div>
  )
}

// ==================== CONVERSATION ====================

function Conversation({ manifestationId, messages, onChange }: {
  manifestationId: number
  messages: Array<{ id: number; author_name: string | null; service_name: string | null; body: string; created_at: string }>
  onChange: () => void
}) {
  const [saisie, setSaisie] = useState('')

  const envoi = useMutation({
    mutationFn: (body: string) => suiviApi.postMessage(manifestationId, body),
    onSuccess: () => {
      setSaisie('')
      onChange()
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Échanges entre services</CardTitle></CardHeader>
      <CardBody className="space-y-3">
        {messages.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Aucun échange. C'est ici que se signalent un changement de date, un matériel
            à ajouter ou à retirer — et tout reste dans le suivi de la manifestation.
          </p>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {messages.map((m) => (
              <div key={m.id} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                    {m.author_name || 'Compte supprimé'}
                  </span>
                  {m.service_name && <Badge variant="default">{m.service_name}</Badge>}
                  <span className="text-xs text-gray-500 dark:text-gray-400">{formatDate(m.created_at)}</span>
                </div>
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{m.body}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <TextArea
              rows={2}
              value={saisie}
              placeholder="Écrire aux services concernés…"
              onChange={(e) => setSaisie(e.target.value)}
            />
          </div>
          <Button
            loading={envoi.isPending}
            disabled={!saisie.trim()}
            icon={<Send className="w-4 h-4" />}
            onClick={() => envoi.mutate(saisie.trim())}
          >
            Envoyer
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

// ==================== COPIES ====================

function Copies({ manifestationId }: { manifestationId: number }) {
  const queryClient = useQueryClient()
  const [serviceId, setServiceId] = useState('')

  const { data: suiveurs = [] } = useQuery({
    queryKey: ['manifestation-watchers', manifestationId],
    queryFn: async () => (await suiviApi.getWatchers(manifestationId)).data.data,
  })

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: async () => (await serviceApi.getAll()).data.data,
  })

  const rafraichir = () =>
    queryClient.invalidateQueries({ queryKey: ['manifestation-watchers', manifestationId] })

  const ajout = useMutation({
    mutationFn: (id: number) => suiviApi.addWatcher(manifestationId, { service_id: id }),
    onSuccess: () => {
      rafraichir()
      setServiceId('')
      toast.success('Mis en copie')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  const retrait = useMutation({
    mutationFn: (id: number) => suiviApi.removeWatcher(manifestationId, id),
    onSuccess: rafraichir,
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">En copie du suivi</CardTitle></CardHeader>
      <CardBody className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Une direction générale, un maire ou un élu peut suivre l'intégralité des échanges
          sans avoir à approuver quoi que ce soit.
        </p>

        {suiveurs.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suiveurs.map((s) => (
              <span key={s.id}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">
                {s.service_name || s.user_name || 'Inconnu'}
                <button type="button" onClick={() => retrait.mutate(s.id)}
                  aria-label={`Retirer ${s.service_name || s.user_name}`} className="hover:text-red-600">
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            options={[
              { value: '', label: '— Ajouter un service en copie —' },
              ...services.filter((s) => s.is_active).map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
          <Button size="sm" variant="outline" disabled={!serviceId} loading={ajout.isPending}
            onClick={() => ajout.mutate(Number(serviceId))}>
            Ajouter
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
