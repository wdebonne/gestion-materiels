import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Building2, CalendarClock, Download, Eye, FileText, KeyRound, LogOut, Trash2, Upload } from 'lucide-react'
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, LoadingInline } from '@/components/ui'
import BadgeEcheance from '@/components/batiments/BadgeEcheance'
import FormulaireDepot from '@/components/batiments/FormulaireDepot'
import { ouvrirFichier } from '@/components/batiments/ouvrirFichier'
import { jourFr, RESULTATS } from '@/components/batiments/libelles'
import { oublierSession, portail, sessionDe, sessionPerdue, type DocumentPortail } from '@/lib/portail'

/**
 * Le portail d'une entreprise extérieure : `/prestataires/:lien`.
 *
 * Hors de la mise en page de l'application — l'entreprise n'a ni menu ni
 * compte — et hors de `ProtectedRoute`, qui la renverrait vers la connexion
 * des agents. Elle saisit le code reçu par courriel, puis voit ses échéances,
 * les documents qu'on lui ouvre, et dépose les siens.
 *
 * Le dépôt reprend le formulaire des agents, avec les seuls bâtiments et objets
 * ouverts **en dépôt** : quand il n'y en a qu'un, le champ ne s'affiche pas.
 */
export default function PortailPrestatairePage() {
  const lien = useParams().lien ?? ''
  const [connecte, setConnecte] = useState(() => sessionDe(lien) !== null)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {connecte ? (
          <EspaceEntreprise lien={lien} onDeconnexion={() => setConnecte(false)} />
        ) : (
          <SaisieCode lien={lien} onConnecte={() => setConnecte(true)} />
        )}
      </div>
    </div>
  )
}

/** « abcdefgh » → « ABCD-EFGH », au fil de la frappe. */
function formaterCode(saisie: string): string {
  const propre = saisie.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  return propre.length > 4 ? `${propre.slice(0, 4)}-${propre.slice(4)}` : propre
}

function SaisieCode({ lien, onConnecte }: { lien: string; onConnecte: () => void }) {
  const [code, setCode] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)

  const valider = async (e: React.FormEvent) => {
    e.preventDefault()
    setEnvoi(true)
    setErreur(null)
    try {
      await portail(lien).connexion(code)
      onConnecte()
    } catch (err: any) {
      setErreur(err?.response?.data?.message ?? 'Connexion impossible. Réessayez dans un instant.')
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-md">
      <Card>
        <CardBody className="space-y-5 p-8">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-100 text-primary-600">
              <KeyRound className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Espace documents</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Saisissez le code d'accès reçu par courriel.
            </p>
          </div>
          <form onSubmit={valider} className="space-y-4">
            <Input
              aria-label="Code d'accès"
              value={code}
              onChange={(e) => setCode(formaterCode(e.target.value))}
              placeholder="ABCD-EFGH"
              autoComplete="one-time-code"
              autoFocus
              className="text-center font-mono text-2xl tracking-widest"
              error={erreur ?? undefined}
            />
            <Button type="submit" className="w-full" loading={envoi} disabled={code.replace('-', '').length !== 8}>
              Accéder
            </Button>
          </form>
          <p className="text-center text-xs text-gray-400">
            Code perdu ou refusé ? Demandez-en un nouveau à votre interlocuteur à la collectivité.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}

function EspaceEntreprise({ lien, onDeconnexion }: { lien: string; onDeconnexion: () => void }) {
  const queryClient = useQueryClient()
  const client = useMemo(() => portail(lien), [lien])
  const [depot, setDepot] = useState(false)

  /** Une session finie renvoie à la saisie du code, sans message d'erreur alarmant. */
  const surErreur = (erreur: unknown) => {
    if (sessionPerdue(erreur)) {
      oublierSession(lien)
      onDeconnexion()
    }
  }

  const { data: moi, isLoading } = useQuery({
    queryKey: ['portail', lien, 'moi'],
    queryFn: async () => {
      try {
        return await client.moi()
      } catch (erreur) {
        surErreur(erreur)
        throw erreur
      }
    },
    retry: false,
  })
  const { data: documents = [] } = useQuery({
    queryKey: ['portail', lien, 'documents'],
    queryFn: async () => {
      try {
        return await client.documents()
      } catch (erreur) {
        surErreur(erreur)
        throw erreur
      }
    },
    retry: false,
    enabled: !!moi,
  })

  const parBatiment = useMemo(() => {
    const groupes = new Map<string, DocumentPortail[]>()
    for (const d of documents) groupes.set(d.siteNom, [...(groupes.get(d.siteNom) ?? []), d])
    return [...groupes.entries()]
  }, [documents])

  const deconnecter = async () => {
    await client.deconnexion().catch(() => undefined)
    onDeconnexion()
  }

  const retirer = async (d: DocumentPortail) => {
    try {
      await client.retirer(d.id)
      toast.success('Dépôt retiré')
      queryClient.invalidateQueries({ queryKey: ['portail', lien] })
    } catch (erreur: any) {
      surErreur(erreur)
      toast.error(erreur?.response?.data?.message ?? "Le retrait n'a pas abouti")
    }
  }

  if (isLoading || !moi) return <LoadingInline />

  const deposables = moi.objets.filter((o) => o.depot)
  const lisibles = moi.objets.filter((o) => o.lecture)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Espace documents</p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{moi.entreprise.nom}</h1>
        </div>
        <div className="flex gap-2">
          {deposables.length > 0 && (
            <Button icon={<Upload className="h-4 w-4" />} onClick={() => setDepot(true)}>
              Déposer un document
            </Button>
          )}
          <Button variant="secondary" icon={<LogOut className="h-4 w-4" />} onClick={deconnecter}>
            Se déconnecter
          </Button>
        </div>
      </div>

      {moi.batiments.length === 0 && (
        <Alert type="info">
          <span className="text-sm">Aucun bâtiment ne vous est encore ouvert. Contactez la collectivité.</span>
        </Alert>
      )}

      {moi.echeances.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary-600" /> Contrôles à venir
            </CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Bâtiment</th>
                  <th className="px-4 py-2 font-medium">Contrôle</th>
                  <th className="px-4 py-2 font-medium">Échéance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {moi.echeances.map((e, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-gray-900 dark:text-gray-100">{e.siteNom}</td>
                    <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
                      {e.rubriqueLibelle}
                      {e.libelle ? ` — ${e.libelle}` : ''}
                    </td>
                    <td className="px-4 py-2">
                      <span className="mr-2 text-gray-900 dark:text-gray-100">{jourFr(e.echeance)}</span>
                      <BadgeEcheance etat={e} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary-600" /> Documents
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-6">
          {parBatiment.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {lisibles.length === 0
                ? 'Aucun document ne vous est ouvert en consultation.'
                : "Aucun document pour l'instant."}
            </p>
          ) : (
            parBatiment.map(([batiment, liste]) => (
              <section key={batiment}>
                <h2 className="mb-2 flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
                  <Building2 className="h-4 w-4 text-gray-400" /> {batiment}
                </h2>
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-gray-700 dark:border-gray-700">
                  {liste.map((d) => (
                    <LigneDocument
                      key={d.id}
                      document={d}
                      onOuvrir={(mode) => ouvrirFichier(() => client.fichier(d.id), d.nomOrigine, mode)}
                      onRetirer={() => retirer(d)}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </CardBody>
      </Card>

      <FormulaireDepot
        ouvert={depot}
        onFermer={() => setDepot(false)}
        rubriques={deposables}
        batiments={moi.batiments}
        rubriqueObligatoire
        envoyer={async (donnees) => {
          try {
            await client.deposer(donnees)
          } catch (erreur) {
            surErreur(erreur)
            throw erreur
          }
          toast.success('Document déposé : la collectivité va le relire')
          queryClient.invalidateQueries({ queryKey: ['portail', lien] })
        }}
      />
    </div>
  )
}

function LigneDocument({
  document: d,
  onOuvrir,
  onRetirer,
}: {
  document: DocumentPortail
  onOuvrir: (mode: 'ouvrir' | 'telecharger') => void
  onRetirer: () => void
}) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-900 dark:text-gray-100">{d.titre}</span>
          {d.sien && d.statut === 'a_valider' && <Badge size="sm" variant="warning">Votre dépôt — en attente</Badge>}
          {d.sien && d.statut === 'valide' && <Badge size="sm" variant="success">Votre dépôt — validé</Badge>}
          {d.sien && d.statut === 'refuse' && <Badge size="sm" variant="danger">Votre dépôt — refusé</Badge>}
          {d.resultat && d.resultat !== 'conforme' && <Badge size="sm" variant="warning">{RESULTATS[d.resultat]}</Badge>}
        </div>
        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {[d.rubriqueLibelle, d.dateDocument && `du ${jourFr(d.dateDocument)}`].filter(Boolean).join(' · ')}
        </div>
        {d.statut === 'refuse' && d.motifRefus && <div className="mt-1 text-xs text-red-600">Motif : {d.motifRefus}</div>}
      </div>
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={() => onOuvrir('ouvrir')} title="Ouvrir" aria-label="Ouvrir">
          <Eye className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onOuvrir('telecharger')} title="Télécharger" aria-label="Télécharger">
          <Download className="h-4 w-4" />
        </Button>
        {d.sien && d.statut === 'a_valider' && (
          <Button variant="ghost" size="sm" onClick={onRetirer} title="Retirer ce dépôt" aria-label="Retirer ce dépôt">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </li>
  )
}
