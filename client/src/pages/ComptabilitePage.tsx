import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Landmark } from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle, LoadingInline, Tab, Tabs } from '@/components/ui'
import { useAuthStore } from '@/stores/auth.store'
import { comptaApi, instantFr } from '@/lib/comptabilite'
import CartesSuivi from '@/components/comptabilite/CartesSuivi'
import OngletARanger from '@/components/comptabilite/OngletARanger'
import OngletSorties from '@/components/comptabilite/OngletSorties'
import OngletBiens from '@/components/comptabilite/OngletBiens'
import OngletReglages from '@/components/comptabilite/OngletReglages'

const ONGLETS = ['suivi', 'ranger', 'sorties', 'biens', 'reglages'] as const
type Onglet = (typeof ONGLETS)[number]

/**
 * La passerelle avec Ciril Finance.
 *
 * Le premier onglet répond à la seule question qu'on se pose en arrivant :
 * où en est-on ? Qui doit ranger, ce qui part ce soir, ce que la compta n'a
 * pas encore intégré. Chaque carte ouvre la liste qui la détaille.
 */
export default function ComptabilitePage() {
  const [params, setParams] = useSearchParams()
  const userId = useAuthStore((s) => s.user?.id)
  const lu = params.get('onglet') as Onglet | null
  const onglet: Onglet = lu && ONGLETS.includes(lu) ? lu : 'suivi'
  const ouvrir = (o: Onglet | 'import') => setParams(o === 'suivi' ? {} : { onglet: o === 'import' ? 'ranger' : o }, { replace: true })

  const { data: moi, isLoading } = useQuery({ queryKey: ['comptabilite', 'mes-droits'], queryFn: comptaApi.mesDroits })
  const { data: suivi } = useQuery({
    queryKey: ['comptabilite', 'suivi'],
    queryFn: comptaApi.suivi,
    refetchInterval: 5 * 60_000,
  })

  if (isLoading || !moi) return <LoadingInline />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
          <Landmark className="h-7 w-7 text-primary-600" aria-hidden />
          Comptabilité
        </h1>
        <p className="mt-1 text-gray-500 dark:text-gray-400">
          Les immobilisations de Ciril Finance rangées dans l’inventaire, et les sorties renvoyées à la compta.
        </p>
      </div>

      <Tabs value={onglet} onChange={(o) => ouvrir(o as Onglet)}>
        <Tab value="suivi" label="Suivi" />
        <Tab value="ranger" label="À ranger" count={suivi?.aRanger.nombre || undefined} />
        <Tab value="sorties" label="Sorties et envois" count={suivi ? suivi.aEnvoyer.nombre + suivi.aIntegrer.biens || undefined : undefined} />
        <Tab value="biens" label="Biens" />
        <Tab value="reglages" label="Réglages" />
      </Tabs>

      {onglet === 'suivi' && (
        <div className="space-y-6">
          {suivi ? <CartesSuivi suivi={suivi} onOuvrir={ouvrir} /> : <LoadingInline />}

          {suivi && suivi.horsCompta > 0 && (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-300">
              {suivi.horsCompta} objet{suivi.horsCompta > 1 ? 's' : ''} sorti{suivi.horsCompta > 1 ? 's' : ''} sans numéro comptable :
              la compta n’en est pas prévenue. Rattachez-les à leur immobilisation si elles existent dans Ciril.
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Derniers mouvements</CardTitle>
            </CardHeader>
            <CardBody>
              {!suivi || suivi.mouvements.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">Rien pour l’instant.</p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                  {suivi.mouvements.map((m) => (
                    <li key={m.id} className="flex flex-wrap gap-x-3 py-2 text-sm">
                      <span className="w-40 shrink-0 text-gray-500 dark:text-gray-400">{instantFr(m.le)}</span>
                      <span className="flex-1 text-gray-900 dark:text-gray-100">
                        {m.par && <strong className="font-medium">{m.par} — </strong>}
                        {m.details}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {onglet === 'ranger' && <OngletARanger droits={moi.droits} />}
      {onglet === 'sorties' && <OngletSorties droits={moi.droits} estAdmin={moi.estAdmin} userId={Number(userId)} />}
      {onglet === 'biens' && <OngletBiens droits={moi.droits} />}
      {onglet === 'reglages' && <OngletReglages droits={moi.droits} colonnes={moi.colonnes} />}
    </div>
  )
}
