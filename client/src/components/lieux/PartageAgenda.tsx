import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Link2, Plus, XCircle } from 'lucide-react'
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
  useConfirm,
} from '@/components/ui'
import Can from '@/components/Can'
import api from '@/lib/api'
import toast from 'react-hot-toast'

/**
 * Partager l'agenda d'une salle, à l'intérieur comme à l'extérieur.
 *
 * Le régisseur des salles, l'élu aux associations et l'amicale qui occupe le
 * préau tous les mardis ne se connecteront pas à l'application pour savoir si
 * une salle est libre : ils ont déjà un agenda, et c'est là qu'ils regardent.
 * On leur donne donc une adresse à coller chez eux, et le flux se tient à jour
 * tout seul.
 *
 * **Une adresse par destinataire.** Retirer l'accès à une association qui
 * n'occupe plus la salle ne doit pas casser l'abonnement du régisseur, qui n'y
 * est pour rien. Une adresse unique obligerait à la régénérer, donc à prévenir
 * tout le monde de recoller une nouvelle URL — et personne ne le ferait, si bien
 * qu'on ne révoquerait jamais.
 *
 * **Le mode d'emploi est affiché.** Un lien ICS sans la marche à suivre ne sert
 * personne : l'écran serait juste, et la salle resterait partagée avec personne.
 */

interface Jeton {
  id: number
  site_id: number
  piece_id: number | null
  token: string
  label: string | null
  revoked_at: string | null
  created_at: string | null
  site_name: string | null
  piece_name: string | null
}

interface Piece {
  id: number
  name: string
}

interface SiteArbre {
  id: number
  name: string
  pieces: Piece[]
}

/** L'adresse publique du flux, telle qu'on la colle dans un agenda. */
const urlDuFlux = (token: string): string =>
  `${window.location.origin}/api/lieux/public/agenda/${token}.ics`

export default function PartageAgenda() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()

  const [siteId, setSiteId] = useState('')
  const [form, setForm] = useState<{ pieceId: string; label: string } | null>(null)
  const [copie, setCopie] = useState<number | null>(null)

  const { data: sites = [] } = useQuery<SiteArbre[]>({
    queryKey: ['lieux-arbre'],
    queryFn: async () => (await api.get('/sites/arbre')).data.sites,
  })

  const { data: jetons = [], isLoading } = useQuery<Jeton[]>({
    queryKey: ['lieux-agenda', siteId],
    enabled: Boolean(siteId),
    queryFn: async () => (await api.get(`/sites/${siteId}/agenda`)).data.jetons,
  })

  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ['lieux-agenda', siteId] })

  const creer = useMutation({
    mutationFn: async (valeurs: { pieceId: string; label: string }) =>
      api.post(`/sites/${siteId}/agenda`, {
        pieceId: valeurs.pieceId ? Number(valeurs.pieceId) : null,
        label: valeurs.label,
      }),
    onSuccess: () => {
      setForm(null)
      rafraichir()
    },
    meta: { successMessage: 'Adresse d’abonnement créée' },
  })

  const revoquer = async (jeton: Jeton) => {
    const ok = await confirm({
      title: `Révoquer l’accès de « ${jeton.label ?? 'cet abonné'} » ?`,
      message:
        'Son agenda cessera de se mettre à jour. Les autres abonnements de ce bâtiment ne sont pas touchés.',
      confirmLabel: 'Révoquer',
      variant: 'danger',
    })
    if (!ok) return

    try {
      await api.delete(`/sites/agenda/${jeton.id}`)
      toast.success('Abonnement révoqué')
      rafraichir()
    } catch (erreur: any) {
      toast.error(erreur?.response?.data?.message ?? 'Révocation impossible')
    }
  }

  const copier = async (jeton: Jeton) => {
    try {
      await navigator.clipboard.writeText(urlDuFlux(jeton.token))
      setCopie(jeton.id)
      setTimeout(() => setCopie(null), 2000)
      toast.success('Adresse copiée')
    } catch {
      // `navigator.clipboard` n'existe pas hors HTTPS : plutôt que d'échouer en
      // silence, on montre l'adresse pour qu'elle se sélectionne à la main.
      toast.error('Copie impossible — sélectionnez l’adresse affichée')
    }
  }

  const piecesDuSite = sites.find((s) => String(s.id) === siteId)?.pieces ?? []
  const actifs = jetons.filter((j) => !j.revoked_at)
  const revoques = jetons.filter((j) => j.revoked_at)

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Select
              label="Bâtiment"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              options={[
                { value: '', label: 'Choisir un bâtiment…' },
                ...sites.map((s) => ({ value: String(s.id), label: s.name })),
              ]}
            />
          </div>
          <Can manage>
            <Button disabled={!siteId} onClick={() => setForm({ pieceId: '', label: '' })}>
              <Plus className="mr-2 h-4 w-4" />
              Partager un agenda
            </Button>
          </Can>
        </div>
      </Card>

      {!siteId ? (
        <Card className="p-6 text-center text-gray-600 dark:text-gray-300">
          Choisissez un bâtiment pour voir qui est abonné à ses agendas.
        </Card>
      ) : isLoading ? (
        <LoadingInline />
      ) : jetons.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-gray-700 dark:text-gray-200">Aucun agenda partagé pour ce bâtiment.</p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Créez une adresse par destinataire — le régisseur, un élu, une association — pour
            qu'ils voient les occupations dans leur propre agenda.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {[...actifs, ...revoques].map((jeton) => (
            <Card key={jeton.id} className={`p-4 ${jeton.revoked_at ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-start gap-3">
                <Link2 className="mt-1 h-4 w-4 flex-shrink-0 text-primary-600" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {jeton.label ?? 'Sans nom'}
                    </span>
                    <Badge variant="info" size="sm">
                      {jeton.piece_name ?? `${jeton.site_name} (bâtiment entier)`}
                    </Badge>
                    {jeton.revoked_at && (
                      <Badge variant="danger" size="sm">
                        Révoqué
                      </Badge>
                    )}
                  </div>

                  {!jeton.revoked_at && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded bg-gray-100 px-2 py-1 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                        {urlDuFlux(jeton.token)}
                      </code>
                      <button
                        onClick={() => copier(jeton)}
                        className="touch-target rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                        title="Copier l'adresse"
                      >
                        {copie === jeton.id ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {!jeton.revoked_at && (
                  <Can manage>
                    <button
                      onClick={() => revoquer(jeton)}
                      className="touch-target rounded p-2 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                      title="Révoquer cet abonnement"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  </Can>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {siteId && (
        <Alert type="info" title="Comment s’abonner">
          <ul className="mt-1 space-y-1 text-sm">
            <li>
              <strong>Google Agenda</strong> — Autres agendas → « + » → À partir de l'URL, puis
              collez l'adresse.
            </li>
            <li>
              <strong>Outlook</strong> — Ajouter un calendrier → S'abonner à partir du web.
            </li>
            <li>
              <strong>Apple Calendrier</strong> — Fichier → Nouvel abonnement à un calendrier.
            </li>
          </ul>
          <p className="mt-2 text-sm">
            L'abonnement est en lecture seule et se met à jour tout seul, en général une fois par
            heure. Ce que l'abonné écrit dans son propre agenda ne revient jamais ici.
          </p>
        </Alert>
      )}

      {form && (
        <Modal isOpen onClose={() => setForm(null)} title="Partager un agenda">
          <ModalBody>
            <div className="space-y-4">
              <Select
                label="Lieu"
                value={form.pieceId}
                onChange={(e) => setForm({ ...form, pieceId: e.target.value })}
                options={[
                  { value: '', label: 'Tout le bâtiment' },
                  ...piecesDuSite.map((p) => ({ value: String(p.id), label: p.name })),
                ]}
                hint="L'agenda d'une pièce montre aussi les jours où tout le bâtiment est réservé."
              />
              <Input
                label="Pour qui"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Régisseur des salles, Amicale du préau, M. le Maire…"
                hint="Le nom sert à savoir quel accès retirer le jour venu. Sans lui, la liste devient illisible."
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              Annuler
            </Button>
            <Button onClick={() => creer.mutate(form)} disabled={creer.isPending}>
              Créer l'adresse
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
