import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowLeft,
  Briefcase,
  Copy,
  KeyRound,
  Lock,
  Plus,
  Search,
  Send,
  Trash2,
  UserPlus,
} from 'lucide-react'
import {
  batimentsApi,
  entreprisesApi,
  type ContactEntreprise,
  type DroitObjet,
  type Entreprise,
  type EtatAccesEntreprise,
  type ResultatAcces,
} from '@/lib/api'
import { useGestion } from '@/lib/gestion'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  LoadingInline,
  Modal,
  ModalBody,
  ModalFooter,
  TextArea,
  useConfirm,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import { jourFr } from '@/components/batiments/libelles'

/**
 * Les entreprises extérieures : qui elles sont, ce qu'on leur ouvre, et leur
 * accès au portail.
 *
 * Les droits se règlent en **deux listes** : les bâtiments ouverts, puis les
 * objets — chacun en Lecture et/ou en Dépôt. L'électricien lit et dépose les
 * vérifications électriques des écoles A et B ; il ne voit rien d'autre.
 *
 * L'accès se délivre d'un bouton : un code est tiré, envoyé par courriel à
 * l'entreprise et aux contacts cochés, et montré **une seule fois** ici, avec
 * le lien, pour être copié si le courriel ne part pas. Le code n'est jamais
 * relu ensuite ; « renvoyer l'accès » en tire un nouveau, et l'ancien cesse de
 * fonctionner.
 */

const ETATS: Record<EtatAccesEntreprise, { libelle: string; variante: 'success' | 'warning' | 'danger' | 'default' }> = {
  aucun: { libelle: "Pas encore d'accès", variante: 'default' },
  actif: { libelle: 'Accès actif', variante: 'success' },
  suspendu: { libelle: 'Suspendu', variante: 'warning' },
  expire: { libelle: 'Expiré', variante: 'warning' },
  bloque: { libelle: 'Bloqué (essais manqués)', variante: 'danger' },
  inactive: { libelle: 'Désactivée', variante: 'default' },
}

const erreurDe = (erreur: any, defaut: string) => erreur?.response?.data?.message ?? defaut

export default function EntreprisesPage() {
  const { gereLieux, chargement } = useGestion()
  const [choisie, setChoisie] = useState<number | null>(null)
  const [creation, setCreation] = useState(false)
  const [recherche, setRecherche] = useState('')

  const { data: entreprises = [], isLoading } = useQuery({
    queryKey: ['entreprises'],
    queryFn: async () => (await entreprisesApi.liste()).data.entreprises,
    enabled: gereLieux,
  })

  const visibles = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    return terme ? entreprises.filter((e) => `${e.nom} ${e.email} ${e.ville ?? ''}`.toLowerCase().includes(terme)) : entreprises
  }, [entreprises, recherche])

  useEffect(() => {
    if (!choisie && entreprises.length > 0) setChoisie(entreprises[0].id)
  }, [entreprises, choisie])

  if (chargement) return <LoadingInline />
  if (!gereLieux) {
    return (
      <Alert type="info">
        <span className="text-sm">
          Les entreprises extérieures interviennent dans plusieurs bâtiments : elles se gèrent par un
          administrateur, un superviseur ou un gestionnaire de toute l'organisation.
        </span>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/batiments" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
          <ArrowLeft className="w-4 h-4" /> Tous les bâtiments
        </Link>
        <div className="mt-2 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Briefcase className="w-7 h-7 text-primary-600" />
              Entreprises extérieures
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Elles consultent les documents qu'on leur ouvre et déposent leurs rapports, par un lien et un code.
            </p>
          </div>
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => setCreation(true)} className="whitespace-nowrap">
            Nouvelle entreprise
          </Button>
        </div>
      </div>

      {isLoading ? (
        <LoadingInline />
      ) : entreprises.length === 0 ? (
        <Alert type="info">
          <span className="text-sm">Aucune entreprise pour l'instant. Créez-en une pour lui ouvrir le portail.</span>
        </Alert>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-6">
          <Card>
            <div className="p-3 border-b border-gray-100 dark:border-gray-700">
              <Input
                size="sm"
                placeholder="Rechercher…"
                icon={<Search className="w-4 h-4" />}
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />
            </div>
            <ul className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[70vh] overflow-y-auto">
              {visibles.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setChoisie(e.id)}
                    className={cn(
                      'w-full text-left px-4 py-3 transition-colors',
                      e.id === choisie ? 'bg-primary-50 dark:bg-primary-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800',
                      !e.actif && 'opacity-60'
                    )}
                  >
                    <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{e.nom}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge size="sm" variant={ETATS[e.acces.etat].variante}>
                        {ETATS[e.acces.etat].libelle}
                      </Badge>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {e.nbSites} bât. · {e.nbRubriques} objet{e.nbRubriques > 1 ? 's' : ''}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {choisie && <FicheEntreprise key={choisie} id={choisie} onSupprimee={() => setChoisie(null)} />}
        </div>
      )}

      {creation && (
        <NouvelleEntreprise
          onFermer={() => setCreation(false)}
          onCreee={(id) => {
            setCreation(false)
            setChoisie(id)
          }}
        />
      )}
    </div>
  )
}

// ======================================================================= création

function NouvelleEntreprise({ onFermer, onCreee }: { onFermer: () => void; onCreee: (id: number) => void }) {
  const queryClient = useQueryClient()
  const [nom, setNom] = useState('')
  const [email, setEmail] = useState('')
  const [telephone, setTelephone] = useState('')

  const creer = useMutation({
    mutationFn: async () => (await entreprisesApi.creer({ nom, email, telephone })).data.id,
    onSuccess: (id) => {
      toast.success('Entreprise créée : réglez ses droits, puis envoyez-lui son accès')
      queryClient.invalidateQueries({ queryKey: ['entreprises'] })
      onCreee(id)
    },
    onError: (erreur) => toast.error(erreurDe(erreur, "La création n'a pas abouti")),
  })

  return (
    <Modal isOpen onClose={onFermer} title="Nouvelle entreprise">
      <ModalBody className="space-y-4">
        <Input label="Nom" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Électricité Martin" autoFocus />
        <Input
          label="Courriel"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          hint="L'accès au portail y sera envoyé."
        />
        <Input label="Téléphone (facultatif)" value={telephone} onChange={(e) => setTelephone(e.target.value)} />
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onFermer}>
          Annuler
        </Button>
        <Button onClick={() => creer.mutate()} loading={creer.isPending} disabled={!nom.trim() || !email.trim()}>
          Créer
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// ======================================================================= la fiche

function FicheEntreprise({ id, onSupprimee }: { id: number; onSupprimee: () => void }) {
  const queryClient = useQueryClient()
  const confirmer = useConfirm()
  const { data, isLoading } = useQuery({
    queryKey: ['entreprises', id],
    queryFn: async () => (await entreprisesApi.lire(id)).data,
  })

  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ['entreprises'] })

  const supprimer = useMutation({
    mutationFn: () => entreprisesApi.supprimer(id),
    onSuccess: () => {
      toast.success('Entreprise supprimée')
      rafraichir()
      onSupprimee()
    },
    onError: (erreur) => toast.error(erreurDe(erreur, "La suppression n'a pas abouti")),
  })

  if (isLoading || !data) return <LoadingInline />
  const e = data.entreprise

  const demanderSuppression = async () => {
    const ok = await confirmer({
      title: `Supprimer « ${e.nom} » ?`,
      message: e.documents > 0
        ? 'Elle a déposé des documents : elle ne peut que être désactivée.'
        : "Ses contacts et ses droits sont effacés, et son lien cesse de fonctionner.",
      confirmLabel: 'Supprimer',
      variant: 'danger',
    })
    if (ok) supprimer.mutate()
  }

  return (
    <div className="space-y-6 min-w-0">
      <Acces entreprise={e} lien={data.lien} onChange={rafraichir} />
      <Identite entreprise={e} onChange={rafraichir} />
      <Droits entreprise={e} onChange={rafraichir} />
      <Contacts entreprise={e} onChange={rafraichir} />
      <div className="flex justify-end">
        <Button variant="danger" size="sm" icon={<Trash2 className="w-4 h-4" />} onClick={demanderSuppression}>
          Supprimer l'entreprise
        </Button>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------- l'accès

function copier(texte: string, quoi: string) {
  navigator.clipboard
    .writeText(texte)
    .then(() => toast.success(`${quoi} copié`))
    .catch(() => toast.error('Copie impossible : sélectionnez le texte à la main'))
}

function Acces({ entreprise: e, lien, onChange }: { entreprise: Entreprise; lien: string; onChange: () => void }) {
  const confirmer = useConfirm()
  const [envoyer, setEnvoyer] = useState(true)
  const [inclureCode, setInclureCode] = useState(true)
  const [fin, setFin] = useState(e.acces.fin ?? '')
  const [resultat, setResultat] = useState<ResultatAcces | null>(null)

  const generer = useMutation({
    mutationFn: async () => (await entreprisesApi.genererAcces(e.id, { envoyer, inclureCode })).data,
    onSuccess: (r) => {
      setResultat(r)
      onChange()
    },
    onError: (erreur) => toast.error(erreurDe(erreur, "L'accès n'a pas pu être généré")),
  })

  const regler = useMutation({
    mutationFn: (reglage: { fin?: string | null; suspendu?: boolean }) => entreprisesApi.reglerAcces(e.id, reglage),
    onSuccess: () => {
      toast.success('Accès mis à jour')
      onChange()
    },
    onError: (erreur) => toast.error(erreurDe(erreur, "La mise à jour n'a pas abouti")),
  })

  const deverrouiller = useMutation({
    mutationFn: () => entreprisesApi.deverrouiller(e.id),
    onSuccess: () => {
      toast.success('Accès déverrouillé')
      onChange()
    },
  })

  const demanderGeneration = async () => {
    if (e.acces.etat !== 'aucun') {
      const ok = await confirmer({
        title: 'Remplacer le code actuel ?',
        message: "L'ancien code cessera aussitôt de fonctionner, et les sessions ouvertes seront fermées.",
        confirmLabel: 'Générer un nouveau code',
      })
      if (!ok) return
    }
    generer.mutate()
  }

  const etat = ETATS[e.acces.etat]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary-600" /> Accès au portail
          </span>
          <Badge variant={etat.variante}>{etat.libelle}</Badge>
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="flex gap-2">
          <Input value={lien} readOnly aria-label="Lien du portail" className="font-mono text-xs" />
          <Button variant="secondary" onClick={() => copier(lien, 'Lien')} title="Copier le lien" aria-label="Copier le lien">
            <Copy className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {e.acces.genereLe ? `Code délivré le ${jourFr(e.acces.genereLe)}` : 'Aucun code délivré'}
          {e.acces.derniereConnexion ? ` · dernière connexion le ${jourFr(e.acces.derniereConnexion)}` : ''}
        </p>

        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-700 dark:text-gray-300">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={envoyer} onChange={(ev) => setEnvoyer(ev.target.checked)} />
            Envoyer par courriel
          </label>
          <label className={cn('flex items-center gap-2', !envoyer && 'opacity-50')}>
            <input type="checkbox" checked={inclureCode} disabled={!envoyer} onChange={(ev) => setInclureCode(ev.target.checked)} />
            Mettre le code dans le courriel
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Send className="w-4 h-4" />} onClick={demanderGeneration} loading={generer.isPending} disabled={!e.actif}>
            {e.acces.etat === 'aucun' ? "Générer et envoyer l'accès" : "Renvoyer un nouvel accès"}
          </Button>
          {e.acces.etat !== 'aucun' && (
            <Button variant="secondary" onClick={() => regler.mutate({ suspendu: !e.acces.suspendu })} loading={regler.isPending}>
              {e.acces.suspendu ? 'Réactiver' : 'Suspendre'}
            </Button>
          )}
          {e.acces.etat === 'bloque' && (
            <Button variant="secondary" icon={<Lock className="w-4 h-4" />} onClick={() => deverrouiller.mutate()}>
              Déverrouiller
            </Button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <div className="sm:w-56">
            <Input type="date" label="Fin de l'accès (facultatif)" value={fin} onChange={(ev) => setFin(ev.target.value)} />
          </div>
          <Button variant="secondary" onClick={() => regler.mutate({ fin: fin || null })} disabled={fin === (e.acces.fin ?? '')}>
            Enregistrer la date
          </Button>
        </div>
      </CardBody>

      {resultat && <CodeDelivre resultat={resultat} onFermer={() => setResultat(null)} />}
    </Card>
  )
}

/** Le code et le lien, montrés une seule fois. */
function CodeDelivre({ resultat, onFermer }: { resultat: ResultatAcces; onFermer: () => void }) {
  const { envoi } = resultat
  return (
    <Modal isOpen onClose={onFermer} title="Accès délivré">
      <ModalBody className="space-y-4">
        {envoi.resultat === 'envoye' && (
          <Alert type="success">
            <span className="text-sm">Envoyé à {envoi.destinataires.join(', ')}.</span>
          </Alert>
        )}
        {envoi.resultat === 'retenu' && (
          <Alert type="warning">
            <span className="text-sm">
              Le courriel n'est pas parti (adresse d'essai ou envois suspendus) : transmettez le lien et le code vous-même.
            </span>
          </Alert>
        )}
        {envoi.resultat === 'echec' && (
          <Alert type="error">
            <span className="text-sm">
              Le courriel n'a pas pu partir{envoi.message ? ` (${envoi.message})` : ''} : transmettez le lien et le code vous-même.
            </span>
          </Alert>
        )}

        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Code d'accès</p>
          <div className="flex gap-2">
            <div className="flex-1 rounded-lg border border-dashed border-primary-300 bg-primary-50 py-3 text-center font-mono text-2xl tracking-widest text-gray-900 dark:bg-primary-900/30 dark:text-gray-100">
              {resultat.code}
            </div>
            <Button variant="secondary" onClick={() => copier(resultat.code, 'Code')} aria-label="Copier le code">
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Lien</p>
          <div className="flex gap-2">
            <Input value={resultat.lien} readOnly className="font-mono text-xs" aria-label="Lien du portail" />
            <Button variant="secondary" onClick={() => copier(resultat.lien, 'Lien')} aria-label="Copier le lien">
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Ce code ne sera plus affiché. Pour en donner un autre, il faudra le régénérer — celui-ci cessera alors de fonctionner.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button onClick={onFermer}>J'ai noté le code</Button>
      </ModalFooter>
    </Modal>
  )
}

// ----------------------------------------------------------------------- l'identité

function Identite({ entreprise: e, onChange }: { entreprise: Entreprise; onChange: () => void }) {
  const [v, setV] = useState({
    nom: e.nom,
    email: e.email,
    telephone: e.telephone ?? '',
    adresse: e.adresse ?? '',
    codePostal: e.codePostal ?? '',
    ville: e.ville ?? '',
    siret: e.siret ?? '',
    notes: e.notes ?? '',
    actif: e.actif,
  })
  const poser = (champ: keyof typeof v) => (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV({ ...v, [champ]: ev.target.value })

  const enregistrer = useMutation({
    mutationFn: () => entreprisesApi.modifier(e.id, v),
    onSuccess: () => {
      toast.success('Fiche enregistrée')
      onChange()
    },
    onError: (erreur) => toast.error(erreurDe(erreur, "L'enregistrement n'a pas abouti")),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fiche</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Nom" value={v.nom} onChange={poser('nom')} />
          <Input label="Courriel" type="email" value={v.email} onChange={poser('email')} />
          <Input label="Téléphone" value={v.telephone} onChange={poser('telephone')} />
          <Input label="SIRET" value={v.siret} onChange={poser('siret')} />
        </div>
        <Input label="Adresse" value={v.adresse} onChange={poser('adresse')} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input label="Code postal" value={v.codePostal} onChange={poser('codePostal')} />
          <div className="sm:col-span-2">
            <Input label="Ville" value={v.ville} onChange={poser('ville')} />
          </div>
        </div>
        <TextArea label="Notes" rows={2} value={v.notes} onChange={poser('notes')} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={v.actif} onChange={(ev) => setV({ ...v, actif: ev.target.checked })} />
            Active — décochée, son portail se ferme
          </label>
          <Button onClick={() => enregistrer.mutate()} loading={enregistrer.isPending}>
            Enregistrer
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

// ----------------------------------------------------------------------- les droits

function Droits({ entreprise: e, onChange }: { entreprise: Entreprise; onChange: () => void }) {
  const [sites, setSites] = useState<number[]>(e.sites)
  const [objets, setObjets] = useState<DroitObjet[]>(e.rubriques)
  const [filtre, setFiltre] = useState('')

  const { data: batiments = [] } = useQuery({
    queryKey: ['batiments', 'liste'],
    queryFn: async () => (await batimentsApi.liste()).data,
    select: (d) => d.batiments,
  })
  const { data: rubriques = [] } = useQuery({
    queryKey: ['batiments', 'rubriques'],
    queryFn: async () => (await batimentsApi.rubriques()).data.rubriques,
  })

  const droitDe = (rubriqueId: number) => objets.find((o) => o.rubriqueId === rubriqueId)
  const basculer = (rubriqueId: number, quoi: 'lecture' | 'depot', valeur: boolean) => {
    const actuel = droitDe(rubriqueId) ?? { rubriqueId, lecture: false, depot: false }
    const suivant = { ...actuel, [quoi]: valeur }
    setObjets([...objets.filter((o) => o.rubriqueId !== rubriqueId), suivant].filter((o) => o.lecture || o.depot))
  }

  const rubriquesVisibles = rubriques.filter((r) => !filtre.trim() || r.libelle.toLowerCase().includes(filtre.trim().toLowerCase()))

  const enregistrer = useMutation({
    mutationFn: () => entreprisesApi.droits(e.id, { sites, rubriques: objets }),
    onSuccess: () => {
      toast.success('Droits enregistrés — ils valent dès la prochaine page du portail')
      onChange()
    },
    onError: (erreur) => toast.error(erreurDe(erreur, "L'enregistrement n'a pas abouti")),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ce qui lui est ouvert</CardTitle>
      </CardHeader>
      <CardBody className="space-y-6">
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Bâtiments</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {batiments.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={sites.includes(b.id)}
                  onChange={(ev) => setSites(ev.target.checked ? [...sites, b.id] : sites.filter((s) => s !== b.id))}
                />
                {b.nom}
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Objets — <span className="font-normal">Lecture : voir les documents validés ; Dépôt : en déposer</span>
            </p>
            <div className="sm:w-56">
              <Input size="sm" placeholder="Filtrer…" value={filtre} onChange={(ev) => setFiltre(ev.target.value)} />
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Objet</th>
                  <th className="px-3 py-2 font-medium text-center w-24">Lecture</th>
                  <th className="px-3 py-2 font-medium text-center w-24">Dépôt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rubriquesVisibles.map((r) => {
                  const droit = droitDe(r.id)
                  return (
                    <tr key={r.id} className={droit ? 'bg-primary-50/40 dark:bg-primary-900/10' : ''}>
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{r.libelle}</td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Lecture — ${r.libelle}`}
                          checked={!!droit?.lecture}
                          onChange={(ev) => basculer(r.id, 'lecture', ev.target.checked)}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Dépôt — ${r.libelle}`}
                          checked={!!droit?.depot}
                          onChange={(ev) => basculer(r.id, 'depot', ev.target.checked)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {sites.length} bâtiment{sites.length > 1 ? 's' : ''} · {objets.filter((o) => o.lecture).length} en lecture ·{' '}
            {objets.filter((o) => o.depot).length} en dépôt
          </p>
          <Button onClick={() => enregistrer.mutate()} loading={enregistrer.isPending}>
            Enregistrer les droits
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

// ----------------------------------------------------------------------- les contacts

const CONTACT_VIDE: ContactEntreprise = { nom: '', fonction: null, telephone: null, email: null, recoitAcces: false }

function Contacts({ entreprise: e, onChange }: { entreprise: Entreprise; onChange: () => void }) {
  const [contacts, setContacts] = useState<ContactEntreprise[]>(e.contacts)
  const poser = (rang: number, champ: keyof ContactEntreprise, valeur: string | boolean) =>
    setContacts(contacts.map((c, i) => (i === rang ? { ...c, [champ]: valeur } : c)))

  const enregistrer = useMutation({
    mutationFn: () => entreprisesApi.contacts(e.id, contacts.filter((c) => c.nom.trim())),
    onSuccess: () => {
      toast.success('Contacts enregistrés')
      onChange()
    },
    onError: (erreur) => toast.error(erreurDe(erreur, "L'enregistrement n'a pas abouti")),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contacts</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {contacts.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">Aucun contact. Le courriel de la fiche reçoit l'accès.</p>
        )}
        {contacts.map((c, rang) => (
          <div key={rang} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_1.3fr_auto] gap-2 items-end rounded-lg border border-gray-100 dark:border-gray-700 p-3">
            <Input size="sm" label="Nom" value={c.nom} onChange={(ev) => poser(rang, 'nom', ev.target.value)} />
            <Input size="sm" label="Fonction" value={c.fonction ?? ''} onChange={(ev) => poser(rang, 'fonction', ev.target.value)} />
            <Input size="sm" label="Téléphone" value={c.telephone ?? ''} onChange={(ev) => poser(rang, 'telephone', ev.target.value)} />
            <Input size="sm" label="Courriel" type="email" value={c.email ?? ''} onChange={(ev) => poser(rang, 'email', ev.target.value)} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setContacts(contacts.filter((_, i) => i !== rang))}
              title="Retirer ce contact"
              aria-label="Retirer ce contact"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
            <label className="md:col-span-5 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={c.recoitAcces}
                disabled={!c.email}
                onChange={(ev) => poser(rang, 'recoitAcces', ev.target.checked)}
              />
              Reçoit le lien et le code d'accès
            </label>
          </div>
        ))}
        <div className="flex justify-between gap-2">
          <Button variant="secondary" size="sm" icon={<UserPlus className="w-4 h-4" />} onClick={() => setContacts([...contacts, { ...CONTACT_VIDE }])}>
            Ajouter un contact
          </Button>
          <Button onClick={() => enregistrer.mutate()} loading={enregistrer.isPending}>
            Enregistrer les contacts
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
