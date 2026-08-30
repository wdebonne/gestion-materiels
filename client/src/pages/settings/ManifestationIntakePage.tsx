import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, Copy, KeyRound, CheckCircle, XCircle, Link2, RefreshCw
} from 'lucide-react'
import {
  Card, CardBody, CardHeader, CardTitle, Input, Select, Button, Alert, Badge,
  Modal, ModalBody, ModalFooter, Spinner
} from '@/components/ui'
import { intakeApi, type IntakeSource } from '@/lib/api'
import EssaiWebhook from '@/components/EssaiWebhook'
import toast from 'react-hot-toast'

/**
 * Réception des demandes de manifestation.
 *
 * Une application de formulaires dépose ici ses demandes, signées. Le contrat
 * d'entrée n'est pas figé : chaque formulaire nomme ses champs à sa façon, et il
 * changera. La correspondance entre le JSON reçu et les champs d'une
 * manifestation est donc réglée ici, pas dans le code.
 *
 * Les chemins proposés sont ceux réellement présents dans la dernière demande
 * reçue : un champ de saisie libre laisserait passer la moindre faute de frappe
 * sans que rien ne le signale avant la prochaine demande perdue.
 */

const urlDeDepot = (slug: string): string =>
  `${window.location.origin}/api/manifestations/intake/${slug}`

const copier = (texte: string, quoi: string) => {
  navigator.clipboard.writeText(texte)
  toast.success(`${quoi} copié`)
}

const formatDate = (valeur: string | null): string =>
  valeur ? new Date(valeur).toLocaleString('fr-FR') : '—'

export default function ManifestationIntakePage() {
  const queryClient = useQueryClient()
  const [sourceOuverte, setSourceOuverte] = useState<IntakeSource | null>(null)
  const [creationOuverte, setCreationOuverte] = useState(false)
  const [secretRevele, setSecretRevele] = useState<{ nom: string; secret: string } | null>(null)
  const [filtreJournal, setFiltreJournal] = useState('')

  const { data: sources = [], isLoading } = useQuery({
    queryKey: ['intake-sources'],
    queryFn: async () => (await intakeApi.getSources()).data.data,
  })

  const { data: demandes = [] } = useQuery({
    queryKey: ['intake-requests', filtreJournal],
    queryFn: async () =>
      (await intakeApi.getRequests(filtreJournal ? { status: filtreJournal } : undefined)).data.data,
  })

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['intake-sources'] })
    queryClient.invalidateQueries({ queryKey: ['intake-requests'] })
  }

  const creation = useMutation({
    mutationFn: (data: { name: string; slug: string }) => intakeApi.createSource(data),
    onSuccess: (res) => {
      rafraichir()
      setCreationOuverte(false)
      // Le secret n'est montré qu'ici : il n'est plus jamais renvoyé ensuite.
      setSecretRevele({ nom: res.data.data.name, secret: res.data.data.secret })
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  const suppression = useMutation({
    mutationFn: (id: number) => intakeApi.deleteSource(id),
    onSuccess: () => {
      rafraichir()
      toast.success('Source supprimée')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  const regeneration = useMutation({
    mutationFn: (source: IntakeSource) => intakeApi.regenerateSecret(source.id),
    onSuccess: (res, source) => {
      rafraichir()
      setSecretRevele({ nom: source.name, secret: res.data.data.secret })
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  const bascule = useMutation({
    mutationFn: (source: IntakeSource) =>
      intakeApi.updateSource(source.id, { name: source.name, is_active: !source.is_active }),
    onSuccess: () => {
      rafraichir()
      toast.success('Source mise à jour')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Les demandes déposées ici arrivent en « À confirmer » et réservent le matériel au prévisionnel.
        </p>
        <Button icon={<Plus className="w-4 h-4" />} onClick={() => setCreationOuverte(true)}>
          Nouvelle source
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : sources.length === 0 ? (
        <Alert type="info">
          <span className="text-sm">
            Aucune source déclarée. Créez-en une pour obtenir l'adresse de dépôt et le secret
            à renseigner dans votre application de formulaires.
          </span>
        </Alert>
      ) : (
        <div className="space-y-3">
          {sources.map((source) => (
            <Card key={source.id}>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{source.name}</span>
                      <Badge variant={source.is_active ? 'success' : 'default'}>
                        {source.is_active ? 'Active' : 'Désactivée'}
                      </Badge>
                      {source.last_status === 'rejected' && (
                        <Badge variant="danger">Dernière demande refusée</Badge>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => copier(urlDeDepot(source.slug), 'Adresse de dépôt')}
                      className="mt-1 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-primary-600 break-all text-left"
                    >
                      <Link2 className="w-3 h-3 shrink-0" />
                      {urlDeDepot(source.slug)}
                      <Copy className="w-3 h-3 shrink-0" />
                    </button>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Dernière réception : {formatDate(source.last_received_at)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setSourceOuverte(source)}>
                      Correspondance
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => bascule.mutate(source)}>
                      {source.is_active ? 'Désactiver' : 'Activer'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<KeyRound className="w-4 h-4" />}
                      onClick={() => regeneration.mutate(source)}
                    >
                      Nouveau secret
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<Trash2 className="w-4 h-4 text-red-500" />}
                      onClick={() => suppression.mutate(source.id)}
                      aria-label={`Supprimer ${source.name}`}
                    />
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <EssaiWebhook sources={sources} />

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle className="text-sm">Demandes reçues</CardTitle>
          <div className="flex items-center gap-2">
            <Select
              value={filtreJournal}
              onChange={(e) => setFiltreJournal(e.target.value)}
              options={[
                { value: '', label: 'Toutes' },
                { value: 'accepted', label: 'Acceptées' },
                { value: 'rejected', label: 'Refusées' },
                { value: 'duplicate', label: 'Doublons' },
              ]}
            />
            <Button
              size="sm"
              variant="outline"
              icon={<RefreshCw className="w-4 h-4" />}
              onClick={rafraichir}
              aria-label="Rafraîchir"
            />
          </div>
        </CardHeader>
        <CardBody>
          {demandes.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Aucune demande reçue.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b dark:border-gray-700 text-left text-xs text-gray-500 dark:text-gray-400">
                    <th className="pb-2">Reçue le</th>
                    <th className="pb-2">Source</th>
                    <th className="pb-2">Résultat</th>
                    <th className="pb-2">Manifestation</th>
                  </tr>
                </thead>
                <tbody>
                  {demandes.map((demande) => (
                    <tr key={demande.id} className="border-b dark:border-gray-700">
                      <td className="py-2 whitespace-nowrap">{formatDate(demande.received_at)}</td>
                      <td className="py-2">{demande.source_name || '—'}</td>
                      <td className="py-2">
                        {demande.status === 'accepted' ? (
                          <span className="inline-flex items-center gap-1 text-green-600">
                            <CheckCircle className="w-4 h-4" /> Acceptée
                          </span>
                        ) : demande.status === 'duplicate' ? (
                          <span className="text-gray-500 dark:text-gray-400">Doublon ignoré</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-600" title={demande.error || undefined}>
                            <XCircle className="w-4 h-4" /> {demande.error || 'Refusée'}
                          </span>
                        )}
                      </td>
                      <td className="py-2">{demande.manifestation_title || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {creationOuverte && (
        <ModaleCreation
          loading={creation.isPending}
          onClose={() => setCreationOuverte(false)}
          onSave={(data) => creation.mutate(data)}
        />
      )}

      {secretRevele && (
        <Modal isOpen onClose={() => setSecretRevele(null)} title={`Secret — ${secretRevele.nom}`}>
          <ModalBody>
            <Alert type="warning">
              <span className="text-sm">
                Ce secret ne sera plus jamais affiché. Copiez-le maintenant dans votre application
                de formulaires : elle doit signer chaque envoi avec.
              </span>
            </Alert>
            <div className="mt-4">
              <code className="block p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs break-all">
                {secretRevele.secret}
              </code>
            </div>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              L'en-tête attendu est <code>X-Webhook-Signature: sha256=&lt;HMAC-SHA256 du corps&gt;</code>.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" onClick={() => copier(secretRevele.secret, 'Secret')}>
              Copier
            </Button>
            <Button onClick={() => setSecretRevele(null)}>J'ai noté le secret</Button>
          </ModalFooter>
        </Modal>
      )}

      {sourceOuverte && (
        <ModaleCorrespondance source={sourceOuverte} onClose={() => setSourceOuverte(null)} />
      )}
    </div>
  )
}

// ==================== CRÉATION ====================

function ModaleCreation({ onClose, onSave, loading }: {
  onClose: () => void
  onSave: (data: { name: string; slug: string }) => void
  loading: boolean
}) {
  const [nom, setNom] = useState('')
  const [slug, setSlug] = useState('')

  // Le slug est dans l'URL publique : il est proposé depuis le nom, et reste
  // modifiable tant que la source n'existe pas.
  const proposerSlug = (valeur: string) =>
    valeur
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

  return (
    <Modal isOpen onClose={onClose} title="Nouvelle source de réception">
      <ModalBody>
        <div className="space-y-4">
          <Input
            label="Nom"
            value={nom}
            placeholder="Formulaire de demande de manifestation"
            onChange={(e) => {
              setNom(e.target.value)
              setSlug(proposerSlug(e.target.value))
            }}
          />
          <Input
            label="Identifiant dans l'adresse"
            value={slug}
            placeholder="formulaire-manifestations"
            onChange={(e) => setSlug(proposerSlug(e.target.value))}
          />
          {slug && (
            <p className="text-xs text-gray-500 dark:text-gray-400 break-all">
              Adresse de dépôt : {urlDeDepot(slug)}
            </p>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>Annuler</Button>
        <Button loading={loading} disabled={!nom || !slug} onClick={() => onSave({ name: nom, slug })}>
          Créer
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// ==================== CORRESPONDANCE ====================

function ModaleCorrespondance({ source, onClose }: { source: IntakeSource; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [correspondance, setCorrespondance] = useState<Record<string, string> | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['intake-champs', source.id],
    queryFn: async () => {
      const res = (await intakeApi.getChamps(source.id)).data.data
      setCorrespondance(res.correspondance)
      return res
    },
  })

  const enregistrement = useMutation({
    mutationFn: () =>
      intakeApi.updateSource(source.id, {
        name: source.name,
        field_mapping: correspondance,
        is_active: Boolean(source.is_active),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intake-sources'] })
      toast.success('Correspondance enregistrée')
      onClose()
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  const chemins = data?.chemins ?? []
  const aucuneDemande = chemins.length === 0

  return (
    <Modal isOpen onClose={onClose} title={`Correspondance — ${source.name}`} size="lg">
      <ModalBody>
        {isLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : aucuneDemande ? (
          <Alert type="info">
            <span className="text-sm">
              Aucune demande n'a encore été reçue de cette source. Envoyez-en une : les champs
              qu'elle contient seront alors proposés ici, et reconnus automatiquement quand leur
              nom le permet.
            </span>
          </Alert>
        ) : (
          <>
            <Alert type={data?.origine === 'detectee' ? 'info' : 'success'}>
              <span className="text-sm">
                {data?.origine === 'detectee'
                  ? "Ces correspondances sont déduites du nom des champs reçus. Vérifiez-les, puis enregistrez : votre réglage l'emportera ensuite sur la détection."
                  : 'Correspondances réglées à la main. Elles l’emportent sur la détection automatique.'}
              </span>
            </Alert>

            <div className="mt-4 space-y-3">
              {data?.champs.map((champ) => (
                <div key={champ.champ} className="flex flex-wrap items-center gap-3">
                  <div className="w-56 shrink-0">
                    <span className="text-sm text-gray-900 dark:text-gray-100">{champ.libelle}</span>
                    {champ.obligatoire && <span className="text-red-500 ml-1">*</span>}
                  </div>
                  <div className="flex-1 min-w-[14rem]">
                    <Select
                      value={correspondance?.[champ.champ] ?? ''}
                      onChange={(e) => {
                        const suivant = { ...(correspondance ?? {}) }
                        if (e.target.value) suivant[champ.champ] = e.target.value
                        else delete suivant[champ.champ]
                        setCorrespondance(suivant)
                      }}
                      options={[
                        { value: '', label: '— non renseigné —' },
                        ...chemins.map((c) => ({ value: c, label: c })),
                      ]}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>Fermer</Button>
        <Button
          loading={enregistrement.isPending}
          disabled={aucuneDemande}
          onClick={() => enregistrement.mutate()}
        >
          Enregistrer
        </Button>
      </ModalFooter>
    </Modal>
  )
}
