import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AlertTriangle, Briefcase, Building2, CheckCircle2, ClipboardCheck, FileClock, Search, Settings2 } from 'lucide-react'
import { batimentsApi, type ResumeBatiment } from '@/lib/api'
import { useGestion } from '@/lib/gestion'
import { Alert, Badge, Button, Card, CardBody, Input, LoadingInline, StatCard } from '@/components/ui'

/**
 * Les bâtiments et l'état de leurs contrôles obligatoires.
 *
 * L'écran répond d'abord à « qu'est-ce qui est en retard ? » : les bâtiments
 * sont triés par urgence, et chaque carte dit combien de contrôles sont dépassés,
 * à prévoir, ou portent des réserves. Le détail est une page plus loin.
 *
 * Il sert aussi de point d'arrivée aux alertes : une alerte d'échéance ne
 * connaît que son suivi (`?suivi=12`) ; on retrouve ici le bâtiment et l'on y
 * renvoie.
 */
export default function BatimentsPage() {
  const navigate = useNavigate()
  const [parametres] = useSearchParams()
  const { gereLieux } = useGestion()
  const [recherche, setRecherche] = useState('')

  const suiviDemande = Number(parametres.get('suivi')) || null
  useEffect(() => {
    if (!suiviDemande) return
    batimentsApi
      .suivi(suiviDemande)
      .then(({ data }) => navigate(`/batiments/${data.suivi.siteId}?onglet=controles`, { replace: true }))
      .catch(() => {
        toast.error("Ce contrôle n'existe plus, ou vous ne suivez pas son bâtiment")
        navigate('/batiments', { replace: true })
      })
  }, [suiviDemande, navigate])

  const { data, isLoading } = useQuery({
    queryKey: ['batiments', 'liste'],
    queryFn: async () => (await batimentsApi.liste()).data,
  })

  const batiments = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    return [...(data?.batiments ?? [])]
      .filter((b) => !terme || `${b.nom} ${b.code ?? ''} ${b.adresse ?? ''}`.toLowerCase().includes(terme))
      .sort(
        (a, b) =>
          b.compteurs.en_retard - a.compteurs.en_retard ||
          b.compteurs.non_conforme + b.compteurs.bientot - (a.compteurs.non_conforme + a.compteurs.bientot) ||
          a.nom.localeCompare(b.nom, 'fr')
      )
  }, [data, recherche])

  const totaux = useMemo(() => {
    const t = { en_retard: 0, bientot: 0, non_conforme: 0, aValider: 0 }
    for (const b of data?.batiments ?? []) {
      t.en_retard += b.compteurs.en_retard
      t.bientot += b.compteurs.bientot
      t.non_conforme += b.compteurs.non_conforme
      if (b.gere) t.aValider += b.compteurs.aValider
    }
    return t
  }, [data])

  const gereUnBatiment = data?.batiments.some((b) => b.gere) ?? false

  if (suiviDemande || isLoading) return <LoadingInline />

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Building2 className="w-7 h-7 text-primary-600" />
            Bâtiments
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Contrôles obligatoires, rapports et échéances de chaque bâtiment.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {gereUnBatiment && (
            <Link to="/batiments/a-valider">
              <Button variant={totaux.aValider > 0 ? 'primary' : 'secondary'} icon={<FileClock className="w-4 h-4" />}>
                À valider{totaux.aValider > 0 ? ` (${totaux.aValider})` : ''}
              </Button>
            </Link>
          )}
          {gereLieux && (
            <>
              <Link to="/batiments/entreprises">
                <Button variant="secondary" icon={<Briefcase className="w-4 h-4" />}>
                  Entreprises
                </Button>
              </Link>
              <Link to="/settings/batiments">
                <Button variant="secondary" icon={<Settings2 className="w-4 h-4" />}>
                  Contrôles et rappels
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>

      {(data?.batiments.length ?? 0) === 0 ? (
        <Alert type="info">
          <span className="text-sm">
            Aucun bâtiment à afficher. Les bâtiments se créent dans Paramètres › Organisation ; un
            gestionnaire peut vous y désigner comme gestionnaire ou responsable d'un bâtiment.
          </span>
        </Alert>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="En retard" value={totaux.en_retard} icon={<AlertTriangle className="w-5 h-5" />} color="red" />
            <StatCard title="À prévoir" value={totaux.bientot} icon={<ClipboardCheck className="w-5 h-5" />} color="yellow" />
            <StatCard title="Réserves à lever" value={totaux.non_conforme} icon={<AlertTriangle className="w-5 h-5" />} color="purple" />
            <StatCard title="Documents à valider" value={totaux.aValider} icon={<FileClock className="w-5 h-5" />} color="blue" />
          </div>

          <Input
            placeholder="Rechercher un bâtiment…"
            icon={<Search className="w-4 h-4" />}
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {batiments.map((b) => (
              <CarteBatiment key={b.id} batiment={b} onOuvrir={() => navigate(`/batiments/${b.id}`)} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function CarteBatiment({ batiment: b, onOuvrir }: { batiment: ResumeBatiment; onOuvrir: () => void }) {
  const c = b.compteurs
  const rienASignaler = c.en_retard + c.bientot + c.non_conforme === 0

  return (
    <Card hoverable onClick={onOuvrir}>
      <CardBody className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{b.nom}</h2>
            {b.adresse && <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{b.adresse}</p>}
          </div>
          {!b.gere && (
            <Badge size="sm" title="Vous déposez des documents ; un gestionnaire les valide">
              Responsable
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {c.en_retard > 0 && <Badge variant="danger" size="sm">{c.en_retard} en retard</Badge>}
          {c.bientot > 0 && <Badge variant="warning" size="sm">{c.bientot} à prévoir</Badge>}
          {c.non_conforme > 0 && <Badge variant="warning" size="sm">{c.non_conforme} avec réserves</Badge>}
          {c.jamais > 0 && <Badge size="sm">{c.jamais} à planifier</Badge>}
          {rienASignaler && c.suivis > 0 && (
            <span className="inline-flex items-center gap-1 text-sm text-green-700 dark:text-green-400">
              <CheckCircle2 className="w-4 h-4" /> Tout est à jour
            </span>
          )}
          {c.suivis === 0 && <span className="text-sm text-gray-500 dark:text-gray-400">Aucun contrôle suivi</span>}
        </div>

        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>
            {c.suivis} contrôle{c.suivis > 1 ? 's' : ''} suivi{c.suivis > 1 ? 's' : ''} · {c.documents} document
            {c.documents > 1 ? 's' : ''}
          </span>
          {b.gere && c.aValider > 0 && <span className="text-primary-600 font-medium">{c.aValider} à valider</span>}
        </div>
      </CardBody>
    </Card>
  )
}
