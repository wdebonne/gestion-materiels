import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowLeft,
  Building2,
  Send,
  User,
  Wrench,
  Lock,
  Paperclip,
  AlertTriangle,
  CircleDot,
  Clock,
  Trash2,
  Eye,
  CheckCircle2,
  Hourglass,
  Timer,
} from 'lucide-react'
import {
  ticketApi,
  ticketReferentielApi,
  type LigneFilTicket,
} from '@/lib/api'
import {
  Badge,
  Button,
  Card,
  CardBody,
  LoadingInline,
  Select,
  TextArea,
} from '@/components/ui'
import FileUpload, { type UploadedFile } from '@/components/ui/FileUpload'
import TerminerTicket from '@/components/tickets/TerminerTicket'
import BoutonFavori from '@/components/BoutonFavori'
import { formaterDuree, jourEnFrancais } from '@/lib/duree'

/**
 * La fiche d'une demande.
 *
 * Le cœur de l'écran est **le fil**, tel que GestSup l'affiche : une seule
 * colonne où se mêlent ce que le système constate — ouverture, changement de
 * statut, pièce déposée — et ce que les gens écrivent. C'est ce qui donne la
 * traçabilité d'un coup d'œil, sans avoir à recouper deux onglets.
 *
 * **Tout est en texte brut**, rendu en `whitespace-pre-wrap`. Le dépôt n'a ni
 * éditeur riche ni sanitiseur HTML ; accepter du HTML écrit par un demandeur et
 * l'afficher à un technicien ouvrirait une faille dans le module dont le
 * principe même est que des gens s'écrivent. Les images jointes à un message
 * s'affichent **en vignettes dans sa bulle** : visuellement, on a bien la photo
 * dans le message, sans jamais avoir stocké de balise.
 *
 * **Une note interne** a un fond ambré et un cadenas. Le demandeur ne la reçoit
 * pas — le serveur ne la lui envoie même pas, plutôt que de compter sur l'écran
 * pour la cacher.
 */

function horodatage(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'))
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Ce qu'un événement raconte, en une phrase lisible. */
function phraseEvenement(ligne: LigneFilTicket): string {
  const qui = ligne.auteur.nom ?? 'Le système'
  switch (ligne.action) {
    case 'ouverture':
      return `${qui} a ouvert la demande`
    case 'statut':
      return `${qui} a changé le statut : ${ligne.ancienne || '—'} → ${ligne.nouvelle || '—'}`
    case 'piece_jointe':
      return `${qui} a joint ${ligne.nouvelle}`
    case 'modification':
      // Une valeur retirée (un technicien désaffecté) se lit « Tom Tech → — » :
      // n'afficher que le nom du champ laisserait deviner ce qui a changé.
      return `${qui} a modifié ${ligne.champ}${
        ligne.ancienne || ligne.nouvelle ? ` : ${ligne.ancienne || '—'} → ${ligne.nouvelle || '—'}` : ''
      }`
    case 'import':
      // La demande vient d'un autre outil : le dire, pour qu'on ne cherche pas
      // pourquoi son fil commence au milieu.
      return ligne.nouvelle ?? 'Demande reprise d’un autre outil'
    case 'echeance_signalee':
      return `Le ${ligne.nouvelle ?? 'délai'} est dépassé`
    default:
      return `${qui} — ${ligne.action}`
  }
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()

  const [message, setMessage] = useState('')
  const [interne, setInterne] = useState(false)
  const [pieces, setPieces] = useState<UploadedFile[]>([])
  const [cloture, setCloture] = useState<null | 'terminer' | 'valider'>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', 'fiche', id],
    queryFn: async () => (await ticketApi.lire(id!)).data,
    enabled: Boolean(id),
  })

  const { data: referentiel } = useQuery({
    queryKey: ['tickets', 'statuts'],
    queryFn: async () => (await ticketReferentielApi.statuts()).data,
  })

  const envoi = useMutation({
    mutationFn: async () => {
      // Les pièces sont déposées d'abord, puis rattachées au message par leurs
      // identifiants : c'est ce qui les fait apparaître dans sa bulle plutôt
      // que dans la liste du bas.
      const piecesIds: number[] = []
      for (const piece of pieces) {
        if (!piece.file) continue
        const { data: depot } = await ticketApi.joindre(Number(id), piece.file)
        piecesIds.push(depot.document.id)
      }
      await ticketApi.ecrire(Number(id), { body: message, interne, piecesIds })
    },
    onSuccess: () => {
      setMessage('')
      setPieces([])
      setInterne(false)
      queryClient.invalidateQueries({ queryKey: ['tickets', 'fiche', id] })
    },
    onError: (erreur: any) =>
      toast.error(erreur?.response?.data?.message ?? "Le message n'a pas pu être envoyé"),
  })

  // Seuls les intervenants réaffectent ; la liste vient du serveur, qui ne
  // propose que les personnes à qui il accepterait de confier la demande.
  const categorieId = data?.ticket.categorie?.id ?? null
  const peutReaffecter = Boolean(data?.droits?.intervenant && categorieId)
  const { data: intervenants } = useQuery({
    queryKey: ['tickets', 'intervenants', categorieId, Number(id)],
    queryFn: async () => (await ticketApi.intervenants(categorieId!, Number(id))).data.intervenants,
    enabled: peutReaffecter,
  })

  const reaffectation = useMutation({
    mutationFn: (technicienId: number | null) => ticketApi.modifier(Number(id), { technicienId }),
    onSuccess: () => {
      toast.success('Demande réaffectée')
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
    },
    onError: (erreur: any) =>
      toast.error(erreur?.response?.data?.message ?? 'La demande n’a pas pu être réaffectée'),
  })

  // Le temps passé, lu au planning : c'est là qu'il vit, pas sur la demande.
  const { data: temps } = useQuery({
    queryKey: ['tickets', 'cloture', Number(id)],
    queryFn: async () => (await ticketApi.cloture(id!)).data,
    enabled: Boolean(data?.droits?.intervenant),
  })

  const changementStatut = useMutation({
    mutationFn: (statutId: number) => ticketApi.changerStatut(Number(id), statutId),
    onSuccess: () => {
      toast.success('Statut mis à jour')
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
    },
    onError: (erreur: any) =>
      toast.error(erreur?.response?.data?.message ?? 'Le statut n’a pas pu être changé'),
  })

  if (isLoading) return <LoadingInline />
  if (!data?.ticket) {
    return (
      <Card>
        <CardBody className="py-12 text-center text-gray-500">Demande introuvable</CardBody>
      </Card>
    )
  }

  const t = data.ticket
  const droits = data.droits
  const statutActuel = referentiel?.statuts.find((s) => s.id === t.statut.id)
  const enValidation = Boolean(t.statut.validation)
  const close = Boolean(statutActuel?.final)

  /*
   * Les états que le sélecteur propose : ceux que le serveur accepterait.
   * « À valider » n'y figure jamais — on y arrive par *Terminer* — et la
   * résolution sans temps passé reste au superviseur.
   */
  const statutsProposes = (referentiel?.statuts ?? []).filter((s) => {
    if (s.id === t.statut.id) return true
    if (s.validation) return false
    if (s.final && s.systeme && !droits?.superviseur) return false
    if (s.final && !droits?.superviseur && !droits?.autonome) return false
    return true
  })

  return (
    <div className="space-y-6">
      <Link
        to="/tickets"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
      >
        <ArrowLeft className="w-4 h-4" /> Retour aux demandes
      </Link>

      {/* ------------------------------------------------------------ l'entête */}
      <Card>
        <CardBody>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-mono text-gray-400">{t.reference}</p>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t.titre}</h1>
                </div>
                <BoutonFavori type="ticket" cibleId={t.id} quoi="ce ticket" />
              </div>

              {/*
                Ce que le demandeur a écrit.

                Le titre dit de quoi il s'agit, la description dit ce qui se
                passe — « bloqué depuis lundi », « ça grince quand il pleut ».
                C'est le renseignement pour lequel un technicien ouvre la fiche,
                et il n'a pas à descendre dans le fil pour le trouver. En texte
                brut, rendu tel qu'il a été saisi.
              */}
              {t.description && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
                  {t.description}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-600 dark:text-gray-300">
                {t.demandeur && (
                  <span className="inline-flex items-center gap-1.5">
                    <User className="w-4 h-4 text-gray-400" /> {t.demandeur.nom}
                  </span>
                )}
                {t.site && (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-gray-400" /> {t.site.nom}
                  </span>
                )}
                {t.materiel && (
                  <span className="inline-flex items-center gap-1.5">
                    <Wrench className="w-4 h-4 text-gray-400" />
                    {t.materiel.id ? (
                      <Link to={`/objects/${t.materiel.id}`} className="hover:underline">
                        {t.materiel.nom}
                      </Link>
                    ) : (
                      // Le matériel existe mais le lecteur n'a pas le droit de
                      // le nommer : on le dit, plutôt que de masquer la ligne.
                      <span className="italic text-gray-400">{t.materiel.nom}</span>
                    )}
                  </span>
                )}
                {t.categorie && (
                  <Badge variant="default">
                    {t.categorie.nom}
                    {t.sousCategorie ? ` › ${t.sousCategorie.nom}` : ''}
                  </Badge>
                )}
              </div>

              {t.enRetard && (
                <p className="mt-3 inline-flex items-center gap-2 text-sm text-red-600">
                  <AlertTriangle className="w-4 h-4" />
                  Échéance dépassée&nbsp;: {horodatage(t.echeanceResolution!)}
                </p>
              )}
            </div>

            <div className="sm:w-56 shrink-0 space-y-3">
              {/*
                Le demandeur suit sa demande, il ne la déclare pas résolue :
                le serveur refuse, l'écran ne propose donc pas.
              */}
              {droits?.peutChangerStatut && (!enValidation || droits.peutValider) ? (
                <Select
                  label="Statut"
                  value={t.statut.id}
                  onChange={(e: any) => changementStatut.mutate(Number(e.target.value))}
                  options={statutsProposes.map((s) => ({
                    value: String(s.id),
                    label: s.nom,
                  }))}
                />
              ) : (
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Statut</p>
                  <Badge variant="default">
                    {/* Pour le demandeur, c'est réglé : la relecture est interne. */}
                    {enValidation && !droits?.intervenant ? 'Résolue — en cours de validation' : t.statut.nom}
                  </Badge>
                </div>
              )}
              {droits?.peutTerminer && !enValidation && !close && (
                <Button
                  className="w-full"
                  icon={<CheckCircle2 className="w-4 h-4" />}
                  onClick={() => setCloture('terminer')}
                >
                  Terminer
                </Button>
              )}
              {peutReaffecter && (
                <Select
                  label="Confiée à"
                  value={t.technicien?.id ?? ''}
                  onChange={(e: any) => reaffectation.mutate(e.target.value ? Number(e.target.value) : null)}
                  options={[
                    { value: '', label: 'Non affectée' },
                    // L'actuel reste dans la liste même s'il n'y figurerait plus :
                    // sans lui, le Select afficherait un autre nom que le vrai.
                    ...(t.technicien && !(intervenants ?? []).some((i) => i.id === t.technicien!.id)
                      ? [{ value: String(t.technicien.id), label: t.technicien.nom }]
                      : []),
                    ...(intervenants ?? []).map((i) => ({ value: String(i.id), label: i.nom })),
                  ]}
                />
              )}
              <div className="text-xs text-gray-500 space-y-1">
                {peutReaffecter ? null : t.technicien ? (
                  <p>Confiée à {t.technicien.nom}</p>
                ) : (
                  <p className="italic">Non affectée</p>
                )}
                {t.service && <p>{t.service.nom}</p>}
                <p className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Ouverte le {horodatage(t.creeLe)}
                </p>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------------------ à valider */}
      {enValidation && droits?.intervenant && (
        <Card>
          <CardBody className="flex flex-col sm:flex-row sm:items-center gap-3 text-sm">
            <Hourglass className="w-5 h-5 shrink-0 text-teal-600" />
            <p className="flex-1 text-gray-700 dark:text-gray-300">
              {droits.peutValider
                ? 'Un agent a terminé cette demande : relisez le temps passé et les personnes qui ont travaillé, puis validez.'
                : 'Terminée, cette demande attend la validation d’un superviseur de la catégorie.'}
            </p>
            {droits.peutValider && (
              <Button icon={<CheckCircle2 className="w-4 h-4" />} onClick={() => setCloture('valider')}>
                Contrôler et valider
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      {/* ---------------------------------------------------- temps passé */}
      {temps && temps.taches.length > 0 && (
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
                <Timer className="w-4 h-4" /> Temps passé
              </h2>
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                {formaterDuree(temps.minutes)}
              </span>
            </div>
            <ul className="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
              {temps.taches.map((tache) => (
                <li key={tache.id} className="py-2 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-gray-700 dark:text-gray-300">
                    {jourEnFrancais(tache.jour, { day: 'numeric', month: 'long' })} — {tache.titulaire.nom}
                    {tache.participants.length > 0 && (
                      <span className="text-gray-500">
                        {' '}avec{' '}
                        {tache.participants
                          .map((p) => `${p.personne?.nom ?? p.libelle} (${formaterDuree(p.minutes)})`)
                          .join(', ')}
                      </span>
                    )}
                  </span>
                  <span className="text-gray-500">
                    {formaterDuree(tache.minutes)}
                    {tache.minutesMobilisees !== tache.minutes &&
                      ` · ${formaterDuree(tache.minutesMobilisees)} mobilisées`}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {cloture && droits && (
        <TerminerTicket
          ticket={t}
          droits={droits}
          mode={cloture}
          ouvert
          onClose={() => setCloture(null)}
        />
      )}

      {/* Visible au titre du bâtiment : on explique pourquoi c'est amputé. */}
      {data.acces === 'voisinage' && (
        <Card>
          <CardBody className="flex items-start gap-3 text-sm text-gray-600 dark:text-gray-300">
            <Eye className="w-5 h-5 shrink-0 text-amber-500" />
            <p>{data.message}</p>
          </CardBody>
        </Card>
      )}

      {data.acces === 'complet' && (
        <>
          {/* ---------------------------------------------------------- le fil */}
          <Card>
            <CardBody className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                Suivi
              </h2>

              <div className="space-y-3">
                {data.fil.map((ligne) =>
                  ligne.type === 'evenement' ? (
                    <div
                      key={`e${ligne.id}`}
                      className="flex items-center gap-3 text-xs text-gray-500"
                    >
                      <CircleDot className="w-4 h-4 shrink-0 text-gray-300" />
                      <span>{phraseEvenement(ligne)}</span>
                      <span className="text-gray-400">· {horodatage(ligne.date)}</span>
                    </div>
                  ) : (
                    <div
                      key={`m${ligne.id}`}
                      className={`rounded-lg p-3 border ${
                        ligne.interne
                          ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                          : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                        <span className="font-medium text-gray-700 dark:text-gray-200">
                          {ligne.auteur.nom ?? 'Compte supprimé'}
                        </span>
                        {ligne.serviceNom && <Badge variant="default">{ligne.serviceNom}</Badge>}
                        {ligne.interne && (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                            <Lock className="w-3 h-3" /> note interne
                          </span>
                        )}
                        <span>· {horodatage(ligne.date)}</span>
                      </div>

                      {/* Texte brut : aucun HTML n'est interprété. */}
                      <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                        {ligne.body}
                      </p>

                      {/* Les pièces du message, en vignettes dans sa bulle. */}
                      {(ligne.pieces?.length ?? 0) > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {ligne.pieces!.map((piece) =>
                            piece.mime?.startsWith('image/') ? (
                              <a key={piece.id} href={piece.url} target="_blank" rel="noreferrer">
                                <img
                                  src={piece.url}
                                  alt={piece.nom}
                                  className="h-24 w-24 object-cover rounded border border-gray-200 dark:border-gray-700"
                                />
                              </a>
                            ) : (
                              <a
                                key={piece.id}
                                href={piece.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline"
                              >
                                <Paperclip className="w-3 h-3" /> {piece.nom}
                              </a>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>

              {/* ------------------------------------------------- le composeur */}
              <div className="pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
                <TextArea
                  value={message}
                  onChange={(e: any) => setMessage(e.target.value)}
                  rows={3}
                  placeholder={interne ? 'Note visible des seuls intervenants…' : 'Écrire une réponse…'}
                />

                <FileUpload
                  value={pieces}
                  onChange={setPieces}
                  maxFiles={5}
                  maxSize={25}
                  accept="image/*,.pdf,.doc,.docx,.odt"
                  televerser={async (fichier) => ({
                    url: URL.createObjectURL(fichier),
                    filename: fichier.name,
                    originalName: fichier.name,
                    mimetype: fichier.type,
                    size: fichier.size,
                    file: fichier,
                  })}
                />

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  {/* La bascule n'est proposée qu'aux intervenants : le
                      demandeur n'a personne à qui adresser une note interne. */}
                  {data.intervenant && (
                    <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={interne}
                        onChange={(e) => setInterne(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      Note interne (le demandeur ne la verra pas)
                    </label>
                  )}
                  <Button
                    className="ml-auto"
                    icon={<Send className="w-4 h-4" />}
                    disabled={message.trim().length === 0 || envoi.isPending}
                    onClick={() => envoi.mutate()}
                  >
                    {envoi.isPending ? 'Envoi…' : 'Envoyer'}
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* --------------------------------------------- les pièces du ticket */}
          {data.pieces.length > 0 && (
            <Card>
              <CardBody>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400 mb-3">
                  Documents
                </h2>
                <ul className="space-y-2">
                  {data.pieces.map((piece: any) => (
                    <li key={piece.id} className="flex items-center justify-between gap-3 text-sm">
                      <a
                        href={piece.file_path}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 text-primary-600 hover:underline min-w-0"
                      >
                        <Paperclip className="w-4 h-4 shrink-0" />
                        <span className="truncate">{piece.name}</span>
                      </a>
                      <button
                        onClick={async () => {
                          await ticketApi.retirerPiece(Number(id), piece.id)
                          queryClient.invalidateQueries({ queryKey: ['tickets', 'fiche', id] })
                        }}
                        className="text-gray-400 hover:text-red-600"
                        title="Retirer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
