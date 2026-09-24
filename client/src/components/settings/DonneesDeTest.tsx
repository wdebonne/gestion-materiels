import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, Trash2, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  Alert, Button, Card, CardBody, CardHeader, CardTitle, Input, LoadingInline,
  Modal, ModalBody, ModalFooter, Select, useConfirm,
} from '@/components/ui'
import api from '@/lib/api'
import SuspensionEmails, { CLE_REQUETE_SUSPENSION } from './SuspensionEmails'

/**
 * Charger un gros jeu de données de test, le retirer, ou repartir d'une base
 * vierge avant la mise en production.
 *
 * Les trois opérations tournent côté serveur en arrière-plan : l'écran suit
 * leur avancement toutes les secondes tant qu'une est en cours.
 */

interface Operation {
  type: 'charger' | 'purger' | 'reinitialiser'
  debut: string
  fin: string | null
  etape: string | null
  rang: number
  total: number
  erreur: string | null
  sauvegardeDeSecurite: string | null
}

interface Comptes {
  utilisateurs: number
  materiels: number
  tickets: number
  manifestations: number
}

interface EtatDonneesTest {
  moteur: string
  enProductionDepuis: string | null
  verrouLeve: boolean
  jeuDeTest: Comptes
  totaux: Comptes
  operation: Operation | null
  motDePasseTest: string
  phrase: string
}

const ECHELLES = [
  { value: '0.1', label: 'Petit — environ 40 000 lignes' },
  { value: '0.5', label: 'Moyen — environ 200 000 lignes' },
  { value: '1', label: 'Gros — environ 400 000 lignes' },
  { value: '3', label: 'Très gros — environ 1,2 million de lignes' },
]

const LIBELLES: Record<Operation['type'], string> = {
  charger: 'Chargement',
  purger: 'Purge du jeu de test',
  reinitialiser: 'Réinitialisation',
}

const nombre = (n: number) => n.toLocaleString('fr-FR')

function messageErreur(err: any, repli: string): string {
  return err?.response?.data?.message || repli
}

export default function DonneesDeTest() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [echelle, setEchelle] = useState('1')
  const [modaleReinit, setModaleReinit] = useState(false)
  const [phrase, setPhrase] = useState('')

  const { data: etat, isLoading } = useQuery({
    queryKey: ['donnees-test'],
    queryFn: async () => (await api.get('/donnees-test/etat')).data.data as EtatDonneesTest,
    // Suivi d'avancement : une interrogation par seconde tant qu'une opération tourne.
    refetchInterval: (query) => {
      const op = (query.state.data as EtatDonneesTest | undefined)?.operation
      return op && !op.fin ? 1000 : false
    },
  })

  const lancer = useMutation({
    mutationFn: async ({ chemin, corps }: { chemin: string; corps?: object }) =>
      api.post(`/donnees-test/${chemin}`, corps ?? {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['donnees-test'] }),
    onError: (err: any) => toast.error(messageErreur(err, "L'opération n'a pas pu démarrer")),
  })

  const operation = etat?.operation
  const enCours = Boolean(operation && !operation.fin)

  // Une opération terminée change les statistiques affichées plus bas dans la page.
  const finOperation = operation?.fin
  useEffect(() => {
    if (!finOperation) return
    queryClient.invalidateQueries({ queryKey: ['database-info'] })
    // Le chargement suspend les envois, la purge les rétablit.
    queryClient.invalidateQueries({ queryKey: CLE_REQUETE_SUSPENSION })
  }, [finOperation, queryClient])

  const verrouille = Boolean(etat?.enProductionDepuis) && !etat?.verrouLeve
  const jeuPresent = (etat?.jeuDeTest.utilisateurs ?? 0) > 0

  const charger = async () => {
    const ok = await confirm({
      title: 'Charger les données de test',
      message:
        (jeuPresent ? 'Le jeu de test actuel sera remplacé. ' : '') +
        'Tous les plugins seront activés, et les envois d’e-mails automatiques suspendus jusqu’à la purge. ' +
        'Évitez de travailler dans l’application pendant le chargement.',
      confirmLabel: 'Charger',
      variant: 'primary',
    })
    if (ok) lancer.mutate({ chemin: 'charger', corps: { echelle: Number(echelle) } })
  }

  const purger = async () => {
    const ok = await confirm({
      title: 'Purger les données de test',
      message:
        'Seules les données créées par le générateur seront retirées ; ce qui a été saisi à la main reste. ' +
        'Une sauvegarde de sécurité est prise avant.',
      confirmLabel: 'Purger',
      variant: 'danger',
    })
    if (ok) lancer.mutate({ chemin: 'purger' })
  }

  const reinitialiser = () => {
    lancer.mutate(
      { chemin: 'reinitialiser', corps: { confirmation: phrase } },
      { onSuccess: () => { setModaleReinit(false); setPhrase('') } }
    )
  }

  if (isLoading || !etat) {
    return (
      <Card>
        <CardBody><LoadingInline /></CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5" />
          Données de test
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-gray-600 text-sm">
          Remplissez l’application avec un gros volume de données cohérentes — parc, clés, lieux, tickets,
          manifestations, plannings, espaces verts, journaux — pour éprouver sa stabilité, puis repartez
          d’une base vierge avant la mise en production.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(['utilisateurs', 'materiels', 'tickets', 'manifestations'] as const).map((cle) => (
            <div key={cle} className="p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500 capitalize">{cle === 'materiels' ? 'matériels' : cle}</p>
              <p className="text-lg font-semibold text-gray-900">{nombre(etat.totaux[cle])}</p>
              <p className="text-xs text-gray-500">dont {nombre(etat.jeuDeTest[cle])} de test</p>
            </div>
          ))}
        </div>

        {operation && (
          <SuiviOperation operation={operation} />
        )}

        <SuspensionEmails compact />

        {verrouille && (
          <Alert type="info" title="Base en production">
            Depuis le {new Date(etat.enProductionDepuis!).toLocaleDateString('fr-FR')}, le chargement et la
            réinitialisation sont désactivés. Pour les rouvrir, redémarrez le serveur avec{' '}
            <code>AUTORISER_DONNEES_TEST=true</code>.
          </Alert>
        )}

        {!verrouille && (
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="sm:w-80">
              <Select
                label="Volume"
                value={echelle}
                onChange={(e) => setEchelle(e.target.value)}
                options={ECHELLES}
                disabled={enCours}
              />
            </div>
            <Button onClick={charger} disabled={enCours} loading={lancer.isPending && lancer.variables?.chemin === 'charger'}>
              <FlaskConical className="w-4 h-4 mr-2" />
              {jeuPresent ? 'Recharger' : 'Charger'} les données de test
            </Button>
          </div>
        )}

        {jeuPresent && (
          <p className="text-xs text-gray-500">
            Comptes générés : <code>prenom.nom.N@charge.test</code>, mot de passe <code>{etat.motDePasseTest}</code>.
          </p>
        )}

        <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-100">
          <Button variant="outline" onClick={purger} disabled={enCours || !jeuPresent}>
            <Trash2 className="w-4 h-4 mr-2" />
            Purger les données de test
          </Button>
          {!verrouille && (
            <Button variant="danger" onClick={() => setModaleReinit(true)} disabled={enCours}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Réinitialiser pour la production
            </Button>
          )}
        </div>
      </CardBody>

      <Modal isOpen={modaleReinit} onClose={() => setModaleReinit(false)} title="Réinitialiser pour la production" size="lg">
        <ModalBody className="space-y-4">
          <Alert type="error">
            <strong>Toutes les données seront effacées</strong>, y compris celles saisies à la main : matériels,
            véhicules et leurs pleins, clés, bâtiments et salles, prêts, manifestations, tickets, plannings,
            espaces verts, mobilier urbain, agenda, alertes et journaux. Tous les comptes sont supprimés sauf
            les administrateurs.
          </Alert>
          <p className="text-sm text-gray-600">
            Sont conservés : paramètres, messagerie, modèles d’e-mail, plugins, catégories et champs personnalisés
            du parc, droits par rôle, services, statuts et catégories de demande, catégories de planning,
            référentiels (stations, garages, centres de contrôle, types d’espaces verts), webhooks et sauvegardes.
          </p>
          <p className="text-sm text-gray-600">
            Une sauvegarde de sécurité est prise juste avant : elle permet de revenir en arrière depuis
            Paramètres › Sauvegardes. Ensuite, la base est déclarée en production et ces outils sont désactivés.
          </p>
          <Input
            label={`Tapez ${etat.phrase} pour confirmer`}
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoComplete="off"
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setModaleReinit(false)}>Annuler</Button>
          <Button
            variant="danger"
            onClick={reinitialiser}
            disabled={phrase.trim() !== etat.phrase}
            loading={lancer.isPending && lancer.variables?.chemin === 'reinitialiser'}
          >
            Tout effacer
          </Button>
        </ModalFooter>
      </Modal>
    </Card>
  )
}

function SuiviOperation({ operation }: { operation: Operation }) {
  const libelle = LIBELLES[operation.type]
  if (!operation.fin) {
    const pourcent = Math.round((operation.rang / Math.max(1, operation.total)) * 100)
    return (
      <div className="p-3 bg-primary-50 rounded-lg space-y-2">
        <p className="text-sm text-primary-700">
          {libelle} en cours{operation.etape ? ` — ${operation.etape}` : ''}…
        </p>
        <div className="h-2 bg-primary-100 rounded-full overflow-hidden">
          <div className="h-full bg-primary-600 transition-all" style={{ width: `${pourcent}%` }} />
        </div>
      </div>
    )
  }

  const duree = Math.max(0, (new Date(operation.fin).getTime() - new Date(operation.debut).getTime()) / 1000)
  return operation.erreur ? (
    <Alert type="error">
      {libelle} en échec : {operation.erreur}
    </Alert>
  ) : (
    <Alert type="success">
      {libelle} terminé en {duree.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s.
      {operation.sauvegardeDeSecurite && <> Sauvegarde de sécurité : <code>{operation.sauvegardeDeSecurite}</code>.</>}
    </Alert>
  )
}
