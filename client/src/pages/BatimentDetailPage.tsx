import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowLeft,
  Building2,
  ClipboardCheck,
  Download,
  Layers,
  Eye,
  FileText,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  batimentsApi,
  type DocumentBatiment,
  type EtatSuivi,
  type RubriqueBatiment,
  type StatutDocumentBatiment,
} from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
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
  Tab,
  Tabs,
  TextArea,
  useConfirm,
} from '@/components/ui'
import Autocomplete from '@/components/ui/Autocomplete'
import BadgeEcheance from '@/components/batiments/BadgeEcheance'
import ClassementDocument from '@/components/batiments/ClassementDocument'
import { invaliderBatiments } from '@/components/batiments/cache'
import FormulaireDepot from '@/components/batiments/FormulaireDepot'
import OngletPlans from '@/components/batiments/plans/OngletPlans'
import { ouvrirFichier } from '@/components/batiments/ouvrirFichier'
import {
  jourFr,
  libellePeriodicite,
  libelleRappel,
  PERIODICITES,
  RAPPELS,
  RESULTATS,
  STATUTS_DOCUMENT,
  tailleLisible,
} from '@/components/batiments/libelles'

/**
 * Un bâtiment : ses contrôles obligatoires et ses documents.
 *
 * Deux publics sur le même écran. Le **gestionnaire** règle les suivis, valide
 * et reclasse. Le **responsable** — la directrice d'école — voit tout, dépose
 * ses rapports, et c'est tout : ses dépôts attendent la validation d'un
 * gestionnaire, et l'écran le lui dit plutôt que de lui montrer des boutons que
 * le serveur refuserait.
 */

const ONGLETS = ['controles', 'plans', 'documents'] as const
type Onglet = (typeof ONGLETS)[number]

export default function BatimentDetailPage() {
  const siteId = Number(useParams().id)
  const [parametres, setParametres] = useSearchParams()
  const onglet: Onglet = ONGLETS.includes(parametres.get('onglet') as Onglet)
    ? (parametres.get('onglet') as Onglet)
    : 'controles'

  const [depot, setDepot] = useState<{ rubriqueId?: number | null; suiviId?: number | null } | null>(null)

  const { data: fiche, isLoading, isError } = useQuery({
    queryKey: ['batiments', 'fiche', siteId],
    queryFn: async () => (await batimentsApi.lire(siteId)).data,
    enabled: siteId > 0,
    retry: false,
  })
  const { data: suivis = [] } = useQuery({
    queryKey: ['batiments', 'suivis', siteId],
    queryFn: async () => (await batimentsApi.suivis(siteId)).data.suivis,
    enabled: !!fiche,
  })
  const { data: rubriques = [] } = useQuery({
    queryKey: ['batiments', 'rubriques'],
    queryFn: async () => (await batimentsApi.rubriques()).data.rubriques,
    enabled: !!fiche,
  })

  const queryClient = useQueryClient()
  const envoyerDepot = async (donnees: FormData) => {
    const { data } = await batimentsApi.deposer(siteId, donnees)
    toast.success(
      data.statut === 'valide'
        ? data.suiviCree
          ? 'Document enregistré — le contrôle est désormais suivi'
          : 'Document enregistré'
        : 'Document déposé — un gestionnaire le validera'
    )
    invaliderBatiments(queryClient)
  }

  if (isLoading) return <LoadingInline />
  if (isError || !fiche) {
    return (
      <Alert type="error">
        <span className="text-sm">Ce bâtiment n'existe pas, ou vous ne le suivez pas.</span>
      </Alert>
    )
  }

  const gere = fiche.gere
  const changerOnglet = (o: string) => setParametres(o === 'controles' ? {} : { onglet: o }, { replace: true })

  return (
    <div className="space-y-6">
      <div>
        <Link to="/batiments" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
          <ArrowLeft className="w-4 h-4" /> Tous les bâtiments
        </Link>
        <div className="mt-2 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Building2 className="w-7 h-7 text-primary-600" />
              {fiche.batiment.nom}
            </h1>
            {fiche.batiment.adresse && <p className="text-gray-500 dark:text-gray-400 mt-1">{fiche.batiment.adresse}</p>}
          </div>
          <Button icon={<Upload className="w-4 h-4" />} onClick={() => setDepot({})}>
            Déposer un document
          </Button>
        </div>
      </div>

      {!gere && (
        <Alert type="info">
          <span className="text-sm">
            Vous êtes responsable de ce bâtiment : vos dépôts sont relus et validés par un gestionnaire
            avant de compter pour les échéances.
          </span>
        </Alert>
      )}

      <Tabs value={onglet} onChange={changerOnglet}>
        <Tab value="controles" label="Contrôles et échéances" icon={<ClipboardCheck className="w-4 h-4" />} count={suivis.filter((s) => s.actif).length} />
        <Tab value="plans" label="Étages et plans" icon={<Layers className="w-4 h-4" />} />
        <Tab value="documents" label="Documents" icon={<FileText className="w-4 h-4" />} />
      </Tabs>

      {onglet === 'controles' ? (
        <OngletControles
          siteId={siteId}
          gere={gere}
          suivis={suivis}
          rubriques={rubriques}
          pieces={fiche.pieces}
          onDeposer={(rubriqueId, suiviId) => setDepot({ rubriqueId, suiviId })}
        />
      ) : onglet === 'plans' ? (
        <OngletPlans siteId={siteId} gere={gere} />
      ) : (
        <OngletDocuments siteId={siteId} gere={gere} rubriques={rubriques} batimentNom={fiche.batiment.nom} />
      )}

      <FormulaireDepot
        ouvert={depot !== null}
        onFermer={() => setDepot(null)}
        envoyer={envoyerDepot}
        rubriques={rubriques}
        pieces={fiche.pieces}
        suivis={suivis.filter((s) => s.actif)}
        initial={depot ?? {}}
        avance={gere}
        titreFenetre={`Déposer un document — ${fiche.batiment.nom}`}
      />
    </div>
  )
}

// ======================================================= contrôles et échéances

function OngletControles({
  siteId,
  gere,
  suivis,
  rubriques,
  pieces,
  onDeposer,
}: {
  siteId: number
  gere: boolean
  suivis: EtatSuivi[]
  rubriques: RubriqueBatiment[]
  pieces: { id: number; nom: string }[]
  onDeposer: (rubriqueId: number, suiviId: number) => void
}) {
  const queryClient = useQueryClient()
  const confirmer = useConfirm()
  const [edition, setEdition] = useState<EtatSuivi | 'nouveau' | null>(null)

  const actifs = suivis.filter((s) => s.actif)
  const inactifs = suivis.filter((s) => !s.actif)

  const supprimer = useMutation({
    mutationFn: (suiviId: number) => batimentsApi.supprimerSuivi(suiviId),
    onSuccess: () => {
      toast.success('Contrôle retiré de ce bâtiment')
      invaliderBatiments(queryClient)
    },
    onError: (erreur: any) => toast.error(erreur?.response?.data?.message ?? "La suppression n'a pas abouti"),
  })

  const demanderSuppression = async (s: EtatSuivi) => {
    const ok = await confirmer({
      title: `Ne plus suivre « ${s.rubriqueLibelle}${s.libelle ? ` — ${s.libelle}` : ''} » ?`,
      message: 'Les documents déjà déposés restent dans le bâtiment ; seules les échéances cessent.',
      confirmLabel: 'Ne plus suivre',
      variant: 'danger',
    })
    if (ok) supprimer.mutate(s.suiviId)
  }

  return (
    <div className="space-y-4">
      {gere && (
        <div className="flex justify-end">
          <Button variant="secondary" icon={<Plus className="w-4 h-4" />} onClick={() => setEdition('nouveau')}>
            Suivre un contrôle
          </Button>
        </div>
      )}

      {actifs.length === 0 ? (
        <Alert type="info">
          <span className="text-sm">
            Aucun contrôle n'est suivi dans ce bâtiment.
            {gere
              ? ' Ajoutez-en un, ou validez un rapport : le contrôle sera suivi automatiquement.'
              : ' Un gestionnaire peut en ajouter.'}
          </span>
        </Alert>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-left text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Contrôle</th>
                  <th className="px-4 py-3 font-medium">Périodicité</th>
                  <th className="px-4 py-3 font-medium">Dernière réalisation</th>
                  <th className="px-4 py-3 font-medium">Échéance</th>
                  <th className="px-4 py-3 font-medium sr-only">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {actifs.map((s) => (
                  <LigneSuivi
                    key={s.suiviId}
                    suivi={s}
                    gere={gere}
                    onDeposer={() => onDeposer(s.rubriqueId, s.suiviId)}
                    onRegler={() => setEdition(s)}
                    onSupprimer={() => demanderSuppression(s)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {inactifs.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-500 dark:text-gray-400">
            {inactifs.length} contrôle{inactifs.length > 1 ? 's' : ''} désactivé{inactifs.length > 1 ? 's' : ''}
          </summary>
          <ul className="mt-2 space-y-1">
            {inactifs.map((s) => (
              <li key={s.suiviId} className="flex items-center justify-between gap-2 text-gray-500 dark:text-gray-400">
                <span>
                  {s.rubriqueLibelle}
                  {s.libelle ? ` — ${s.libelle}` : ''}
                </span>
                {gere && (
                  <Button variant="ghost" size="sm" onClick={() => setEdition(s)}>
                    Régler
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {edition && (
        <ReglageSuivi
          siteId={siteId}
          suivi={edition === 'nouveau' ? null : edition}
          rubriques={rubriques}
          pieces={pieces}
          onFermer={() => setEdition(null)}
        />
      )}
    </div>
  )
}

function LigneSuivi({
  suivi: s,
  gere,
  onDeposer,
  onRegler,
  onSupprimer,
}: {
  suivi: EtatSuivi
  gere: boolean
  onDeposer: () => void
  onRegler: () => void
  onSupprimer: () => void
}) {
  const ouvrirDernier = () =>
    s.dernierDocument &&
    ouvrirFichier(() => batimentsApi.fichier(s.dernierDocument!.id), s.dernierDocument.titre)

  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900 dark:text-gray-100">{s.rubriqueLibelle}</div>
        {(s.libelle || s.pieceNom) && (
          <div className="text-xs text-gray-500 dark:text-gray-400">{[s.libelle, s.pieceNom].filter(Boolean).join(' · ')}</div>
        )}
      </td>
      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
        {libellePeriodicite(s.periodiciteMois)}
        {s.surcharge.periodiciteMois !== null && (
          <span className="block text-xs text-gray-400" title="Réglage propre à ce bâtiment">
            propre à ce bâtiment
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        {s.dernierDocument ? (
          <button type="button" onClick={ouvrirDernier} className="text-left text-primary-600 hover:underline">
            {jourFr(s.dernierDocument.date)}
            {s.dernierDocument.resultat && (
              <span className="block text-xs text-gray-500 dark:text-gray-400">{RESULTATS[s.dernierDocument.resultat]}</span>
            )}
          </button>
        ) : (
          <span className="text-gray-400">Aucun rapport</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="text-gray-900 dark:text-gray-100">{jourFr(s.echeance)}</div>
        <BadgeEcheance etat={s} detaille />
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" icon={<Upload className="w-4 h-4" />} onClick={onDeposer} title="Déposer le rapport">
            <span className="hidden lg:inline">Déposer</span>
          </Button>
          {gere && (
            <>
              <Button variant="ghost" size="sm" onClick={onRegler} title="Régler ce contrôle" aria-label="Régler ce contrôle">
                <Settings2 className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={onSupprimer} title="Ne plus suivre" aria-label="Ne plus suivre">
                <Trash2 className="w-4 h-4" />
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

/** Suivre un contrôle, ou régler celui qu'on suit : périodicité et rappel propres, échéance initiale. */
function ReglageSuivi({
  siteId,
  suivi,
  rubriques,
  pieces,
  onFermer,
}: {
  siteId: number
  suivi: EtatSuivi | null
  rubriques: RubriqueBatiment[]
  pieces: { id: number; nom: string }[]
  onFermer: () => void
}) {
  const queryClient = useQueryClient()
  const [rubriqueId, setRubriqueId] = useState<number | null>(suivi?.rubriqueId ?? null)
  const [libelle, setLibelle] = useState(suivi?.libelle ?? '')
  const [pieceId, setPieceId] = useState<number | null>(suivi?.pieceId ?? null)
  const [periodicite, setPeriodicite] = useState<string>(suivi?.surcharge.periodiciteMois ? String(suivi.surcharge.periodiciteMois) : '')
  const [rappel, setRappel] = useState<string>(suivi?.surcharge.rappelJours ? String(suivi.surcharge.rappelJours) : '')
  const [echeanceInitiale, setEcheanceInitiale] = useState(suivi?.echeanceInitiale ?? '')
  const [actif, setActif] = useState(suivi?.actif ?? true)
  const [notes, setNotes] = useState(suivi?.notes ?? '')

  const rubrique = rubriques.find((r) => r.id === rubriqueId)
  const avecEcheance = rubriques.filter((r) => r.periodiciteMois)

  const enregistrer = useMutation({
    mutationFn: async () => {
      const valeurs = {
        pieceId,
        libelle: libelle.trim() || null,
        periodiciteMois: periodicite ? Number(periodicite) : null,
        rappelJours: rappel ? Number(rappel) : null,
        echeanceInitiale: echeanceInitiale || null,
        notes: notes.trim() || null,
      }
      return suivi
        ? batimentsApi.modifierSuivi(suivi.suiviId, { ...valeurs, actif })
        : batimentsApi.creerSuivi(siteId, { ...valeurs, rubriqueId })
    },
    onSuccess: () => {
      toast.success(suivi ? 'Contrôle réglé' : 'Contrôle suivi dans ce bâtiment')
      invaliderBatiments(queryClient)
      onFermer()
    },
    onError: (erreur: any) => toast.error(erreur?.response?.data?.message ?? "L'enregistrement n'a pas abouti"),
  })

  const periodiciteObjet = rubrique ? libellePeriodicite(rubrique.periodiciteMois).toLowerCase() : ''
  const rappelObjet = rubrique ? libelleRappel(rubrique.rappelJours) : ''

  return (
    <Modal isOpen onClose={onFermer} title={suivi ? `Régler — ${suivi.rubriqueLibelle}` : 'Suivre un contrôle'} size="lg">
      <ModalBody className="space-y-4">
        {!suivi && (
          <Autocomplete
            label="Contrôle"
            options={avecEcheance.map((r) => ({ value: r.id, label: r.libelle }))}
            value={rubriqueId ?? ''}
            onChange={(v) => setRubriqueId(v ? Number(v) : null)}
            placeholder="Choisir un contrôle du catalogue…"
          />
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Précision (facultatif)"
            placeholder="Ascenseur du hall, chaufferie nord…"
            value={libelle}
            onChange={(e) => setLibelle(e.target.value)}
          />
          <Select
            label="Pièce (facultatif)"
            value={pieceId ?? ''}
            onChange={(e) => setPieceId(e.target.value ? Number(e.target.value) : null)}
            options={[{ value: '', label: 'Tout le bâtiment' }, ...pieces.map((p) => ({ value: p.id, label: p.nom }))]}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Périodicité"
            value={periodicite}
            onChange={(e) => setPeriodicite(e.target.value)}
            options={[
              { value: '', label: rubrique ? `Celle du catalogue (${periodiciteObjet})` : 'Celle du catalogue' },
              ...PERIODICITES.map((p) => ({ value: String(p.value), label: p.label })),
            ]}
          />
          <Select
            label="Rappel"
            value={rappel}
            onChange={(e) => setRappel(e.target.value)}
            options={[
              { value: '', label: rubrique ? `Celui du catalogue (${rappelObjet})` : 'Celui du catalogue' },
              ...RAPPELS.map((r) => ({ value: String(r.value), label: r.label })),
            ]}
          />
        </div>

        <Input
          type="date"
          label="Échéance à respecter (facultatif)"
          hint="Tant qu'aucun rapport n'est validé : la date avant laquelle le premier contrôle doit avoir lieu."
          value={echeanceInitiale}
          onChange={(e) => setEcheanceInitiale(e.target.value)}
        />

        <TextArea label="Notes (facultatif)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />

        {suivi && (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={actif} onChange={(e) => setActif(e.target.checked)} />
            Suivi actif — décoché, le contrôle ne lève plus d'alerte
          </label>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onFermer}>
          Annuler
        </Button>
        <Button onClick={() => enregistrer.mutate()} loading={enregistrer.isPending} disabled={!suivi && !rubriqueId}>
          Enregistrer
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// ================================================================== documents

function OngletDocuments({
  siteId,
  gere,
  rubriques,
  batimentNom,
}: {
  siteId: number
  gere: boolean
  rubriques: RubriqueBatiment[]
  batimentNom: string
}) {
  const queryClient = useQueryClient()
  const confirmer = useConfirm()
  const moi = useAuthStore((s) => s.user?.id)
  const [statut, setStatut] = useState<StatutDocumentBatiment | ''>('')
  const [rubrique, setRubrique] = useState<number | null>(null)
  const [recherche, setRecherche] = useState('')
  const [reclasse, setReclasse] = useState<DocumentBatiment | null>(null)

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['batiments', 'documents', siteId, statut, rubrique],
    queryFn: async () =>
      (await batimentsApi.documents(siteId, { statut: statut || undefined, rubrique: rubrique ?? undefined })).data.documents,
  })

  const visibles = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    return terme
      ? documents.filter((d) => `${d.titre} ${d.nomOrigine} ${d.rubriqueLibelle ?? ''}`.toLowerCase().includes(terme))
      : documents
  }, [documents, recherche])

  const supprimer = useMutation({
    mutationFn: (docId: number) => batimentsApi.supprimerDocument(docId),
    onSuccess: () => {
      toast.success('Document supprimé')
      invaliderBatiments(queryClient)
    },
    onError: (erreur: any) => toast.error(erreur?.response?.data?.message ?? "La suppression n'a pas abouti"),
  })

  const demanderSuppression = async (d: DocumentBatiment) => {
    const ok = await confirmer({
      title: `Supprimer « ${d.titre} » ?`,
      message: 'Le fichier est effacé. Si ce rapport faisait foi pour une échéance, elle reviendra au rapport précédent.',
      confirmLabel: 'Supprimer',
      variant: 'danger',
    })
    if (ok) supprimer.mutate(d.id)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input
          placeholder="Rechercher un document…"
          icon={<Search className="w-4 h-4" />}
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
        />
        <Select
          value={statut}
          onChange={(e) => setStatut(e.target.value as StatutDocumentBatiment | '')}
          options={[
            { value: '', label: 'Tous les statuts' },
            ...Object.entries(STATUTS_DOCUMENT).map(([value, label]) => ({ value, label })),
          ]}
        />
        <Autocomplete
          options={rubriques.map((r) => ({ value: r.id, label: r.libelle }))}
          value={rubrique ?? ''}
          onChange={(v) => setRubrique(v ? Number(v) : null)}
          placeholder="Tous les objets"
        />
      </div>

      {isLoading ? (
        <LoadingInline />
      ) : visibles.length === 0 ? (
        <Alert type="info">
          <span className="text-sm">Aucun document{statut || rubrique || recherche ? ' ne correspond à ces filtres' : ' dans ce bâtiment'}.</span>
        </Alert>
      ) : (
        <Card>
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {visibles.map((d) => {
              const peutSupprimer = gere || (d.deposePar?.id === moi && d.statut === 'a_valider')
              return (
                <li key={d.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{d.titre}</span>
                      <Badge
                        size="sm"
                        variant={d.statut === 'valide' ? 'success' : d.statut === 'refuse' ? 'danger' : 'warning'}
                        title={d.motifRefus ?? undefined}
                      >
                        {STATUTS_DOCUMENT[d.statut]}
                      </Badge>
                      {d.resultat && d.resultat !== 'conforme' && (
                        <Badge size="sm" variant="warning">{RESULTATS[d.resultat]}</Badge>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {[
                        d.rubriqueLibelle ?? 'Non classé',
                        d.suiviLibelle,
                        d.pieceNom,
                        d.dateDocument && `du ${jourFr(d.dateDocument)}`,
                        (d.entreprise ?? d.deposePar) && `déposé par ${(d.entreprise ?? d.deposePar)!.nom}`,
                        tailleLisible(d.taille),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    {d.statut === 'refuse' && d.motifRefus && (
                      <div className="text-xs text-red-600 mt-1">Motif : {d.motifRefus}</div>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => ouvrirFichier(() => batimentsApi.fichier(d.id), d.nomOrigine)} title="Ouvrir" aria-label="Ouvrir">
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => ouvrirFichier(() => batimentsApi.fichier(d.id), d.nomOrigine, 'telecharger')}
                      title="Télécharger"
                      aria-label="Télécharger"
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                    {gere && (
                      <Button variant="ghost" size="sm" onClick={() => setReclasse(d)} title={d.statut === 'a_valider' ? 'Valider' : 'Reclasser'} aria-label="Reclasser">
                        <Pencil className="w-4 h-4" />
                      </Button>
                    )}
                    {peutSupprimer && (
                      <Button variant="ghost" size="sm" onClick={() => demanderSuppression(d)} title="Supprimer" aria-label="Supprimer">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {reclasse && (
        <Modal
          isOpen
          onClose={() => setReclasse(null)}
          title={reclasse.statut === 'a_valider' ? `Valider — ${reclasse.titre}` : `Reclasser — ${reclasse.titre}`}
          size="lg"
        >
          <ModalBody>
            <ClassementDocument
              document={reclasse}
              mode={reclasse.statut === 'valide' ? 'modifier' : 'valider'}
              batiments={[{ id: siteId, nom: batimentNom }]}
              rubriques={rubriques}
              onTermine={() => setReclasse(null)}
            />
          </ModalBody>
        </Modal>
      )}
    </div>
  )
}
