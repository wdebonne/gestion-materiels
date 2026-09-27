import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CheckCircle2, Circle, Download, RotateCcw, Send, Undo2, XCircle, AlertTriangle, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button, Card, CardBody, CardHeader, CardTitle, LoadingInline, useConfirm } from '@/components/ui'
import {
  comptaApi,
  enregistrerBlob,
  instantFr,
  jourFr,
  type DroitsCompta,
  type ExportComptable,
  type ResultatLot,
  type SortieListee,
} from '@/lib/comptabilite'
import { cn } from '@/lib/utils'

const FILTRES = [
  { valeur: 'a_envoyer', libelle: 'À envoyer' },
  { valeur: 'a_integrer', libelle: 'Envoyées, à intégrer' },
  { valeur: 'integrees', libelle: 'Intégrées' },
  { valeur: 'hors_compta', libelle: 'Sans n° comptable' },
  { valeur: 'toutes', libelle: 'Toutes' },
]

const message = (e: any, repli: string) => e?.response?.data?.message ?? repli

/** Les trois étapes d'une sortie, datées : déclarée, envoyée, intégrée. */
export function EtapesSortie({
  declareeLe,
  declareePar,
  envoyeeLe,
  integreeLe,
  integreePar,
  horsCompta,
}: {
  declareeLe: string | null
  declareePar?: string | null
  envoyeeLe: string | null
  integreeLe: string | null
  integreePar?: string | null
  horsCompta?: boolean
}) {
  const etapes = [
    { libelle: 'Déclarée', le: declareeLe, par: declareePar },
    { libelle: 'Envoyée à la compta', le: envoyeeLe, par: null },
    { libelle: 'Intégrée dans Ciril', le: integreeLe, par: integreePar },
  ]
  if (horsCompta) {
    return <span className="text-xs text-gray-500 dark:text-gray-400">Sans numéro comptable : la compta n’est pas concernée</span>
  }
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {etapes.map((e, i) => (
        <li key={e.libelle} className={cn('flex items-center gap-1', e.le ? 'text-green-700 dark:text-green-300' : 'text-gray-500 dark:text-gray-400')}>
          {e.le ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <Circle className="h-3.5 w-3.5" aria-hidden />}
          <span>
            {e.libelle}
            {e.le ? ` le ${jourFr(e.le)}` : ' — en attente'}
            {e.le && e.par ? ` (${e.par})` : ''}
          </span>
          {i < etapes.length - 1 && <span aria-hidden className="text-gray-300 dark:text-gray-600">→</span>}
        </li>
      ))}
    </ol>
  )
}

function Statut({ nom, statut }: { nom: string; statut: ExportComptable['nextcloud'] }) {
  if (!statut) return null
  const ok = statut === 'ok'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
        ok
          ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
          : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
      )}
    >
      {ok ? <Check className="h-3 w-3" aria-hidden /> : <XCircle className="h-3 w-3" aria-hidden />}
      {nom}
      {statut === 'retenu' ? ' (suspendu)' : ''}
    </span>
  )
}

function annoncer(r: ResultatLot) {
  if (r.lignes === 0) return toast('Aucune sortie en attente : rien à envoyer.')
  if (!r.envoye) return toast.error(`Envoi impossible : ${r.erreurs.join(' — ')}. Les sorties restent dans la file.`)
  const parts = [r.nextcloud === 'ok' ? 'déposé sur Nextcloud' : null, r.mail === 'ok' ? 'envoyé par mail' : null].filter(Boolean)
  toast.success(`${r.lignes} sortie(s) : ${parts.join(' et ')}`)
  if (r.erreurs.length) toast.error(r.erreurs.join(' — '))
}

export default function OngletSorties({ droits, estAdmin, userId }: { droits: DroitsCompta; estAdmin: boolean; userId: number }) {
  const queryClient = useQueryClient()
  const confirmer = useConfirm()
  const [filtre, setFiltre] = useState('a_envoyer')

  const { data: sorties = [], isLoading } = useQuery({
    queryKey: ['comptabilite', 'sorties', filtre],
    queryFn: () => comptaApi.sorties(filtre),
  })
  const { data: exports = [] } = useQuery({ queryKey: ['comptabilite', 'exports'], queryFn: comptaApi.exports })

  const invalider = () => queryClient.invalidateQueries({ queryKey: ['comptabilite'] })

  const envoyer = useMutation({
    mutationFn: comptaApi.envoyer,
    onSuccess: (r) => {
      annoncer(r)
      invalider()
    },
    onError: (e) => toast.error(message(e, 'Envoi impossible')),
  })

  const telecharger = useMutation({
    mutationFn: comptaApi.telechargerLot,
    onSuccess: (reponse) => {
      enregistrerBlob(reponse as any, 'sorties.csv')
      toast.success('Fichier téléchargé : les sorties sont marquées envoyées')
      invalider()
    },
    onError: async (e: any) => {
      // La réponse d'erreur arrive en blob : on la relit pour son message.
      const texte = await e?.response?.data?.text?.().catch(() => '')
      let lu = ''
      try {
        lu = JSON.parse(texte || '{}').message ?? ''
      } catch {
        lu = ''
      }
      toast.error(lu || 'Téléchargement impossible')
    },
  })

  const action = (fn: () => Promise<any>, succes: string) =>
    fn()
      .then(() => {
        toast.success(succes)
        invalider()
      })
      .catch((e) => toast.error(message(e, 'Action impossible')))

  const aEnvoyer = filtre === 'a_envoyer' ? sorties.length : null

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Sorties d’inventaire</CardTitle>
          {droits.envoyer && (
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={async () => {
                  if (await confirmer({ title: 'Envoyer maintenant ?', message: 'Toutes les sorties en attente partent à la compta, dans un seul fichier.', confirmLabel: 'Envoyer' }))
                    envoyer.mutate()
                }}
                disabled={envoyer.isPending}
              >
                <Send className="mr-2 h-4 w-4" aria-hidden />
                {envoyer.isPending ? 'Envoi…' : 'Envoyer maintenant à la compta'}
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  if (
                    await confirmer({
                      title: 'Télécharger le lot ?',
                      message: 'Le fichier contient toutes les sorties en attente ; elles seront marquées envoyées. À vous de le transmettre à la compta.',
                      confirmLabel: 'Télécharger',
                    })
                  )
                    telecharger.mutate()
                }}
                disabled={telecharger.isPending}
              >
                <Download className="mr-2 h-4 w-4" aria-hidden /> Télécharger le fichier
              </Button>
            </div>
          )}
        </CardHeader>
        <CardBody className="space-y-4">
          <div role="group" aria-label="Filtrer les sorties" className="flex flex-wrap gap-1.5">
            {FILTRES.map((f) => (
              <button
                key={f.valeur}
                type="button"
                aria-pressed={filtre === f.valeur}
                onClick={() => setFiltre(f.valeur)}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm',
                  filtre === f.valeur
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700'
                )}
              >
                {f.libelle}
              </button>
            ))}
          </div>

          {aEnvoyer !== null && aEnvoyer > 0 && (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {aEnvoyer} sortie{aEnvoyer > 1 ? 's' : ''} partiront ensemble, dans un seul fichier, au prochain envoi.
            </p>
          )}

          {isLoading ? (
            <LoadingInline />
          ) : sorties.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">Aucune sortie dans cette liste.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {sorties.map((s: SortieListee) => (
                <li key={s.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{s.libelle ?? s.objet}</span>
                      {s.numero && <span className="ml-2 font-mono text-gray-600 dark:text-gray-300">n° {s.numero}</span>}
                      <span className="ml-2 text-gray-600 dark:text-gray-300">
                        — {s.motifLibelle.toLowerCase()} le {jourFr(s.date)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {[s.categorie, s.localisation, s.inventaireInterne].filter(Boolean).join(' — ')}
                    </div>
                  </div>
                  {s.commentaire && <p className="mt-0.5 text-xs italic text-gray-600 dark:text-gray-300">« {s.commentaire} »</p>}
                  <div className="mt-1">
                    <EtapesSortie
                      declareeLe={s.declareeLe}
                      declareePar={s.declareePar}
                      envoyeeLe={s.envoyeeLe}
                      integreeLe={s.integreeLe}
                      integreePar={s.integreePar}
                      horsCompta={!s.numero}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Envois à la compta</CardTitle>
        </CardHeader>
        <CardBody>
          {exports.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">Aucun envoi pour l’instant.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {exports.map((e) => {
                const echoue = !e.envoyeLe && e.origine !== 'telechargement'
                const partiel = Boolean(e.envoyeLe) && (e.nextcloud === 'echec' || e.mail === 'echec')
                return (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 space-y-1 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{e.nomFichier}</span>
                        <span className="text-gray-600 dark:text-gray-300">
                          {e.lignes} bien{e.lignes > 1 ? 's' : ''} —{' '}
                          {e.origine === 'automatique' ? 'envoi automatique' : e.origine === 'telechargement' ? `téléchargé${e.par ? ` par ${e.par}` : ''}` : `envoyé par ${e.par ?? '—'}`}{' '}
                          le {instantFr(e.creeLe)}
                        </span>
                        <Statut nom="Nextcloud" statut={e.nextcloud} />
                        <Statut nom="Mail" statut={e.mail} />
                      </div>
                      {e.erreur && (
                        <p className="flex items-start gap-1 text-xs text-red-700 dark:text-red-300">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                          {e.erreur}
                          {echoue ? ' — les sorties sont restées dans la file.' : ''}
                        </p>
                      )}
                      {!echoue && (
                        <p className={cn('text-xs', e.integreLe ? 'text-green-700 dark:text-green-300' : 'text-amber-800 dark:text-amber-200')}>
                          {e.integreLe
                            ? `Intégré dans Ciril le ${instantFr(e.integreLe)}${e.integrePar ? ` par ${e.integrePar}` : ''}`
                            : 'Pas encore intégré dans Ciril'}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {e.fichierDisponible && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            comptaApi
                              .fichier(e.id)
                              .then((r) => enregistrerBlob(r as any, e.nomFichier))
                              .catch(() => toast.error('Fichier indisponible'))
                          }
                        >
                          <Download className="mr-1 h-4 w-4" aria-hidden /> Fichier
                        </Button>
                      )}
                      {partiel && droits.envoyer && (
                        <Button size="sm" variant="ghost" onClick={() => comptaApi.renvoyer(e.id).then((r) => { annoncer(r); invalider() }).catch((x) => toast.error(message(x, 'Renvoi impossible')))}>
                          <RotateCcw className="mr-1 h-4 w-4" aria-hidden /> Renvoyer
                        </Button>
                      )}
                      {!echoue && !e.integreLe && droits.integrer && (
                        <Button size="sm" onClick={() => action(() => comptaApi.confirmerIntegration(e.id), 'Intégration confirmée')}>
                          <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden /> Intégré dans Ciril
                        </Button>
                      )}
                      {e.integreLe && droits.integrer && (estAdmin || e.integreParId === userId) && (
                        <Button size="sm" variant="ghost" onClick={() => action(() => comptaApi.annulerIntegration(e.id), 'Confirmation retirée')}>
                          <Undo2 className="mr-1 h-4 w-4" aria-hidden /> Pas encore intégré
                        </Button>
                      )}
                      {estAdmin && !echoue && !e.integreLe && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Annuler l’envoi : ses sorties reviennent dans la file"
                          onClick={async () => {
                            if (
                              await confirmer({
                                title: 'Annuler cet envoi ?',
                                message: 'Ses sorties reviennent dans la file et repartiront au prochain envoi. À faire seulement si la compta n’a pas reçu ou ne peut pas utiliser ce fichier.',
                                confirmLabel: 'Annuler l’envoi',
                                variant: 'danger',
                              })
                            )
                              action(() => comptaApi.annulerExport(e.id), 'Envoi annulé')
                          }}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                          <span className="sr-only">Annuler l’envoi</span>
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
