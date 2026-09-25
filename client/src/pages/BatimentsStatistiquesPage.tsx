import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle, ArrowLeft, BarChart3, Building2, ChevronDown, FileDown, TrendingDown, TrendingUp } from 'lucide-react'
import {
  batimentsApi,
  exploitationApi,
  type CategorieStat,
  type ComparaisonStat,
  type Energie,
  type GranulariteStat,
  type StatistiquesBatiments,
} from '@/lib/api'
import { Alert, Button, Card, Input, LoadingInline, Modal, ModalBody, ModalFooter, Select } from '@/components/ui'
import { cn } from '@/lib/utils'
import { CATEGORIES_STAT, ENERGIES, euros, evolution, jourFr, quantite } from '@/components/batiments/libelles'
import {
  exporterStatistiquesPdf,
  libelleSous,
  SECTIONS_PDF,
  type SectionPdf,
} from '@/components/batiments/statistiques/exportStatistiquesPdf'

/**
 * Ce que coûtent les bâtiments : énergie, contrats, interventions, contrôles,
 * achats — par période, par bâtiment, comparé à une autre période.
 *
 * Les filtres se combinent : une période, sa granularité (semaine, mois,
 * année), une comparaison (la période précédente ou la même un an plus tôt),
 * un, plusieurs ou tous les bâtiments, les catégories, et pour l'énergie les
 * fluides. Tout ce qui s'affiche s'exporte en PDF, section par section.
 */

const CATEGORIES = Object.keys(CATEGORIES_STAT) as CategorieStat[]
const TOUTES_ENERGIES = Object.keys(ENERGIES) as Energie[]

type Preset = '12mois' | 'annee' | 'anneePrecedente' | 'trimestre' | 'perso'

function jourLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Les bornes d'un raccourci de période. */
function bornesDe(preset: Preset): { debut: string; fin: string } | null {
  const maintenant = new Date()
  const a = maintenant.getFullYear()
  const m = maintenant.getMonth()
  switch (preset) {
    case '12mois':
      return { debut: jourLocal(new Date(a, m - 11, 1)), fin: jourLocal(new Date(a, m + 1, 0)) }
    case 'annee':
      return { debut: `${a}-01-01`, fin: `${a}-12-31` }
    case 'anneePrecedente':
      return { debut: `${a - 1}-01-01`, fin: `${a - 1}-12-31` }
    case 'trimestre': {
      const t = Math.floor(m / 3) * 3
      return { debut: jourLocal(new Date(a, t, 1)), fin: jourLocal(new Date(a, t + 3, 0)) }
    }
    default:
      return null
  }
}

export default function BatimentsStatistiquesPage() {
  const [preset, setPreset] = useState<Preset>('12mois')
  const [perso, setPerso] = useState(bornesDe('annee')!)
  const [granularite, setGranularite] = useState<GranulariteStat>('mois')
  const [comparaison, setComparaison] = useState<ComparaisonStat>('n-1')
  const [sites, setSites] = useState<number[]>([])
  const [categories, setCategories] = useState<CategorieStat[]>(CATEGORIES)
  const [energies, setEnergies] = useState<Energie[]>([])
  const [parM2, setParM2] = useState(false)
  const [energieSuivie, setEnergieSuivie] = useState<Energie | null>(null)
  const [exportOuvert, setExport] = useState(false)

  const bornes = bornesDe(preset) ?? perso
  const { data: liste } = useQuery({
    queryKey: ['batiments', 'liste'],
    queryFn: async () => (await batimentsApi.liste()).data,
  })
  const batiments = liste?.batiments ?? []

  const { data: stats, isLoading, isError, error } = useQuery({
    queryKey: ['batiments', 'statistiques', bornes, granularite, comparaison, sites, categories, energies],
    queryFn: async () =>
      (
        await exploitationApi.statistiques({
          ...bornes,
          granularite,
          comparaison,
          sites,
          categories,
          energies,
        })
      ).data.statistiques,
    enabled: categories.length > 0 && bornes.debut <= bornes.fin,
    placeholderData: (precedent) => precedent,
  })

  const refs = {
    repartition: useRef<HTMLDivElement>(null),
    evolution: useRef<HTMLDivElement>(null),
    batiments: useRef<HTMLDivElement>(null),
    consommations: useRef<HTMLDivElement>(null),
  }

  const perimetre =
    sites.length === 0
      ? 'Tous les bâtiments'
      : batiments
          .filter((b) => sites.includes(b.id))
          .map((b) => b.nom)
          .join(', ')
  const libellePeriode = `Du ${jourFr(bornes.debut)} au ${jourFr(bornes.fin)}`
  const libelleComparaison = stats?.fenetreComparaison
    ? `comparé au ${jourFr(stats.fenetreComparaison.debut)} – ${jourFr(stats.fenetreComparaison.fin)}`
    : null

  const basculer = <T,>(liste: T[], valeur: T) => (liste.includes(valeur) ? liste.filter((v) => v !== valeur) : [...liste, valeur])

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <Link to="/batiments" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
            <ArrowLeft className="w-4 h-4" /> Tous les bâtiments
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-primary-600" />
            Coûts des bâtiments
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Énergie, contrats, interventions, contrôles et achats — répartis au jour sur les périodes.
          </p>
        </div>
        <Button icon={<FileDown className="w-4 h-4" />} onClick={() => setExport(true)} disabled={!stats}>
          Exporter en PDF
        </Button>
      </div>

      {/* ----------------------------------------------------------- filtres */}
      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Select
            label="Période"
            value={preset}
            onChange={(e) => {
              const p = e.target.value as Preset
              setPreset(p)
              setGranularite(p === 'trimestre' ? 'semaine' : 'mois')
            }}
            options={[
              { value: '12mois', label: '12 derniers mois' },
              { value: 'trimestre', label: 'Trimestre en cours' },
              { value: 'annee', label: 'Année en cours' },
              { value: 'anneePrecedente', label: 'Année dernière' },
              { value: 'perso', label: 'Personnalisée…' },
            ]}
          />
          <Select
            label="Découpage"
            value={granularite}
            onChange={(e) => setGranularite(e.target.value as GranulariteStat)}
            options={[
              { value: 'semaine', label: 'Par semaine' },
              { value: 'mois', label: 'Par mois' },
              { value: 'annee', label: 'Par année' },
            ]}
          />
          <Select
            label="Comparer à"
            value={comparaison}
            onChange={(e) => setComparaison(e.target.value as ComparaisonStat)}
            options={[
              { value: 'aucune', label: 'Pas de comparaison' },
              { value: 'precedente', label: 'La période précédente' },
              { value: 'n-1', label: 'La même période, un an plus tôt' },
            ]}
          />
          <ChoixBatiments batiments={batiments} choisis={sites} onChange={setSites} />
        </div>

        {preset === 'perso' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Input type="date" label="Du" value={perso.debut} onChange={(e) => setPerso({ ...perso, debut: e.target.value })} />
            <Input
              type="date"
              label="Au"
              value={perso.fin}
              onChange={(e) => setPerso({ ...perso, fin: e.target.value })}
              error={perso.fin < perso.debut ? 'Avant le début' : undefined}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400 mr-1">Catégories :</span>
          {CATEGORIES.map((c) => (
            <Pastille key={c} actif={categories.includes(c)} couleur={CATEGORIES_STAT[c].couleur} onClick={() => setCategories(basculer(categories, c))}>
              {CATEGORIES_STAT[c].libelle}
            </Pastille>
          ))}
        </div>
        {categories.includes('energie') && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400 mr-1">Énergies :</span>
            <Pastille actif={energies.length === 0} onClick={() => setEnergies([])}>
              Toutes
            </Pastille>
            {TOUTES_ENERGIES.map((e) => (
              <Pastille key={e} actif={energies.includes(e)} couleur={ENERGIES[e].couleur} onClick={() => setEnergies(basculer(energies, e))}>
                {ENERGIES[e].libelle}
              </Pastille>
            ))}
          </div>
        )}
      </Card>

      {categories.length === 0 ? (
        <Alert type="info">
          <span className="text-sm">Choisissez au moins une catégorie.</span>
        </Alert>
      ) : isError ? (
        <Alert type="error">
          <span className="text-sm">{(error as any)?.response?.data?.message ?? 'Les statistiques ne se sont pas chargées.'}</span>
        </Alert>
      ) : isLoading || !stats ? (
        <LoadingInline />
      ) : (
        <Tableau
          stats={stats}
          refs={refs}
          parM2={parM2}
          setParM2={setParM2}
          energieSuivie={energieSuivie}
          setEnergieSuivie={setEnergieSuivie}
        />
      )}

      {exportOuvert && stats && (
        <FenetreExport
          onFermer={() => setExport(false)}
          exporter={async (sections) => {
            await exporterStatistiquesPdf({
              stats,
              sections,
              perimetre,
              periode: libellePeriode,
              comparaison: libelleComparaison,
              batimentsAuM2: parM2,
              graphiques: {
                repartition: refs.repartition.current,
                evolution: refs.evolution.current,
                batiments: refs.batiments.current,
                consommations: refs.consommations.current,
              },
            })
          }}
        />
      )}
    </div>
  )
}

// ----------------------------------------------------------------- les filtres

function Pastille({ actif, couleur, onClick, children }: { actif: boolean; couleur?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={actif}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
        actif
          ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200'
          : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
      )}
    >
      {couleur && <span className="w-2.5 h-2.5 rounded-full" style={{ background: couleur }} />}
      {children}
    </button>
  )
}

function ChoixBatiments({
  batiments,
  choisis,
  onChange,
}: {
  batiments: { id: number; nom: string }[]
  choisis: number[]
  onChange: (ids: number[]) => void
}) {
  const [ouvert, setOuvert] = useState(false)
  const libelle =
    choisis.length === 0
      ? 'Tous les bâtiments'
      : choisis.length === 1
        ? batiments.find((b) => b.id === choisis[0])?.nom ?? '1 bâtiment'
        : `${choisis.length} bâtiments`
  return (
    <div className="relative">
      <span className="block text-sm font-medium text-gray-700 mb-1.5 dark:text-gray-300">Bâtiments</span>
      <button
        type="button"
        onClick={() => setOuvert(!ouvert)}
        className="w-full flex items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-left dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      >
        <span className="inline-flex items-center gap-2 truncate">
          <Building2 className="w-4 h-4 text-gray-400" /> {libelle}
        </span>
        <ChevronDown className="w-4 h-4 text-gray-400" />
      </button>
      {ouvert && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOuvert(false)} />
          <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <label className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700">
              <input type="checkbox" checked={choisis.length === 0} onChange={() => onChange([])} />
              <strong>Tous les bâtiments</strong>
            </label>
            {batiments.map((b) => (
              <label key={b.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700">
                <input
                  type="checkbox"
                  checked={choisis.includes(b.id)}
                  onChange={() => onChange(choisis.includes(b.id) ? choisis.filter((x) => x !== b.id) : [...choisis, b.id])}
                />
                {b.nom}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------- les résultats

function Evolution({ actuel, precedent }: { actuel: number; precedent: number | null | undefined }) {
  if (precedent === null || precedent === undefined) return null
  const pct = evolution(actuel, precedent)
  if (pct === null) return <p className="text-xs text-gray-400 mt-1">Rien sur la période comparée</p>
  if (pct === 0) return <p className="text-xs text-gray-500 mt-1">Stable</p>
  const hausse = pct > 0
  return (
    <p className={cn('text-xs mt-1 inline-flex items-center gap-1', hausse ? 'text-red-600' : 'text-green-600')}>
      {hausse ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
      {hausse ? '+' : ''}
      {String(pct).replace('.', ',')} % ({euros(precedent)})
    </p>
  )
}

const formatAxe = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10} k€` : `${Math.round(v)} €`)

function Tableau({
  stats,
  refs,
  parM2,
  setParM2,
  energieSuivie,
  setEnergieSuivie,
}: {
  stats: StatistiquesBatiments
  refs: Record<'repartition' | 'evolution' | 'batiments' | 'consommations', React.RefObject<HTMLDivElement>>
  parM2: boolean
  setParM2: (v: boolean) => void
  energieSuivie: Energie | null
  setEnergieSuivie: (e: Energie) => void
}) {
  const categories = stats.filtre.categories
  const avecComparaison = stats.totaux.comparaison !== null
  const surface = stats.parBatiment.reduce((s, b) => s + (b.surfaceM2 ?? 0), 0)
  const totalAvecSurface = stats.parBatiment.filter((b) => b.surfaceM2).reduce((s, b) => s + b.total, 0)

  const repartition = categories
    .map((c) => ({ cle: c, nom: CATEGORIES_STAT[c].libelle, valeur: stats.totaux.parCategorie[c], couleur: CATEGORIES_STAT[c].couleur }))
    .filter((r) => r.valeur > 0)
  const parEnergie = stats.parEnergie
    .filter((e) => e.montant > 0)
    .map((e) => ({ cle: e.energie, nom: ENERGIES[e.energie].libelle, valeur: e.montant, couleur: ENERGIES[e.energie].couleur }))

  const evolutionDonnees = stats.series.map((p, i) => ({
    libelle: p.libelle,
    libelleLong: p.libelleLong,
    ...p.parCategorie,
    comparaison: stats.seriesComparaison?.[i]?.total ?? null,
  }))

  const parBatiment = [...stats.parBatiment]
    .filter((b) => !parM2 || b.surfaceM2)
    .map((b) => {
      const diviseur = parM2 ? b.surfaceM2! : 1
      return {
        nom: b.nom,
        ...Object.fromEntries(categories.map((c) => [c, Math.round((b.parCategorie[c] / diviseur) * 100) / 100])),
        total: b.total / diviseur,
      }
    })
    .sort((a, b) => b.total - a.total)

  const energies = stats.parEnergie.map((e) => e.energie)
  const energie = energieSuivie && energies.includes(energieSuivie) ? energieSuivie : energies[0] ?? null
  const unite = stats.parEnergie.find((e) => e.energie === energie)?.unite ?? ''
  const consommations = stats.series.map((p, i) => ({
    libelle: p.libelle,
    actuelle: p.consommations[energie as Energie] ?? 0,
    comparee: stats.seriesComparaison?.[i]?.consommations[energie as Energie] ?? null,
  }))

  const incomplets = stats.parBatiment.flatMap((b) =>
    Object.entries(b.couverture)
      .filter(([, part]) => (part ?? 1) < 0.95)
      .map(([e, part]) => `${b.nom} — ${ENERGIES[e as Energie].libelle.toLowerCase()} : ${Math.round((part ?? 0) * 100)} %`)
  )

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------ cartes */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <Card className="p-4 bg-primary-50/50 dark:bg-primary-900/10">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{euros(stats.totaux.montant)}</p>
          {surface > 0 && <p className="text-xs text-gray-500">{euros(totalAvecSurface / surface)} / m²</p>}
          <Evolution actuel={stats.totaux.montant} precedent={stats.totaux.comparaison} />
        </Card>
        {categories.map((c) => (
          <Card key={c} className="p-4">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: CATEGORIES_STAT[c].couleur }} />
              {CATEGORIES_STAT[c].libelle}
            </p>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-1">{euros(stats.totaux.parCategorie[c])}</p>
            <Evolution actuel={stats.totaux.parCategorie[c]} precedent={stats.totaux.parCategorieComparaison?.[c]} />
          </Card>
        ))}
      </div>

      {(incomplets.length > 0 || stats.achatsSansPrix > 0) && (
        <Alert type="warning">
          <div className="text-sm space-y-1">
            {incomplets.length > 0 && (
              <p className="flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  Factures d'énergie incomplètes sur la période (jours couverts) : {incomplets.join(' · ')}. Une comparaison sur ces
                  bâtiments peut montrer une baisse qui n'en est pas une.
                </span>
              </p>
            )}
            {stats.achatsSansPrix > 0 && (
              <p>
                {stats.achatsSansPrix} matériel{stats.achatsSansPrix > 1 ? 's' : ''} posé{stats.achatsSansPrix > 1 ? 's' : ''} sans prix ou
                date d'achat : non chiffré{stats.achatsSansPrix > 1 ? 's' : ''}.
              </p>
            )}
          </div>
        </Alert>
      )}

      {stats.totaux.montant === 0 && !avecComparaison ? (
        <Alert type="info">
          <span className="text-sm">Aucune dépense sur cette période pour ces bâtiments.</span>
        </Alert>
      ) : (
        <>
          {/* ----------------------------------------------------- camemberts */}
          <div ref={refs.repartition} className="grid grid-cols-1 lg:grid-cols-2 gap-4 bg-white dark:bg-transparent">
            <Camembert titre="Par catégorie" donnees={repartition} />
            {parEnergie.length > 0 && <Camembert titre="Énergie, par fluide" donnees={parEnergie} />}
          </div>

          {/* ------------------------------------------------------ évolution */}
          <Card className="p-4">
            <div ref={refs.evolution} className="bg-white pb-4 dark:bg-transparent">
              <p className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                Évolution{avecComparaison ? ' — la ligne montre la période comparée' : ''}
              </p>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={evolutionDonnees} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="libelle" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={formatAxe} tick={{ fontSize: 12 }} width={70} />
                    <Tooltip
                      formatter={(v: number, nom: string) => [euros(v), nom === 'comparaison' ? 'Période comparée' : CATEGORIES_STAT[nom as CategorieStat]?.libelle ?? nom]}
                      labelFormatter={(_l, p) => (p?.[0]?.payload?.libelleLong as string) ?? ''}
                    />
                    <Legend formatter={(nom: string) => (nom === 'comparaison' ? 'Période comparée' : CATEGORIES_STAT[nom as CategorieStat]?.libelle ?? nom)} />
                    {categories.map((c) => (
                      <Bar key={c} dataKey={c} stackId="a" fill={CATEGORIES_STAT[c].couleur} isAnimationActive={false} />
                    ))}
                    {avecComparaison && (
                      <Line type="monotone" dataKey="comparaison" stroke="#6b7280" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Card>

          {/* ------------------------------------------------------ bâtiments */}
          {stats.parBatiment.length > 1 && (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold text-gray-900 dark:text-gray-100">Comparaison des bâtiments</p>
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <input type="checkbox" checked={parM2} onChange={(e) => setParM2(e.target.checked)} />
                  Rapporter au m² (bâtiments dont la surface est connue)
                </label>
              </div>
              <div ref={refs.batiments} className="bg-white pb-4 dark:bg-transparent" style={{ height: Math.max(216, parBatiment.length * 44 + 76) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={parBatiment} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" tickFormatter={(v) => (parM2 ? `${v} €/m²` : formatAxe(v))} tick={{ fontSize: 12 }} />
                    <YAxis type="category" dataKey="nom" width={150} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v: number, nom: string) => [parM2 ? `${euros(v)} / m²` : euros(v), CATEGORIES_STAT[nom as CategorieStat]?.libelle ?? nom]} />
                    <Legend formatter={(nom: string) => CATEGORIES_STAT[nom as CategorieStat]?.libelle ?? nom} />
                    {categories.map((c) => (
                      <Bar key={c} dataKey={c} stackId="b" fill={CATEGORIES_STAT[c].couleur} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* -------------------------------------------------- consommations */}
          {energie && (
            <Card className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <p className="font-semibold text-gray-900 dark:text-gray-100">Consommation</p>
                <div className="flex flex-wrap gap-2">
                  {energies.map((e) => (
                    <Pastille key={e} actif={e === energie} couleur={ENERGIES[e].couleur} onClick={() => setEnergieSuivie(e)}>
                      {ENERGIES[e].libelle}
                    </Pastille>
                  ))}
                </div>
              </div>
              <div ref={refs.consommations} className="h-80 bg-white pb-4 dark:bg-transparent">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={consommations} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="libelle" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} width={70} />
                    <Tooltip formatter={(v: number, nom: string) => [quantite(v, unite), nom === 'actuelle' ? 'Période' : 'Période comparée']} />
                    <Legend formatter={(nom: string) => (nom === 'actuelle' ? `${ENERGIES[energie].libelle} (${unite === 'm3' ? 'm³' : unite})` : 'Période comparée')} />
                    <Line type="monotone" dataKey="actuelle" stroke={ENERGIES[energie].couleur} strokeWidth={2} isAnimationActive={false} />
                    {avecComparaison && (
                      <Line type="monotone" dataKey="comparee" stroke="#9ca3af" strokeDasharray="5 4" isAnimationActive={false} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* ------------------------------------------------------- tableaux */}
          <Card>
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 font-semibold text-gray-900 dark:text-gray-100">
              Par bâtiment
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 text-left text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Bâtiment</th>
                    {categories.map((c) => (
                      <th key={c} className="px-4 py-2 font-medium text-right">
                        {CATEGORIES_STAT[c].libelle}
                      </th>
                    ))}
                    <th className="px-4 py-2 font-medium text-right">Total</th>
                    <th className="px-4 py-2 font-medium text-right">€ / m²</th>
                    {avecComparaison && <th className="px-4 py-2 font-medium text-right">Évolution</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {[...stats.parBatiment]
                    .sort((a, b) => b.total - a.total)
                    .map((b) => (
                      <tr key={b.siteId}>
                        <td className="px-4 py-2">
                          <Link to={`/batiments/${b.siteId}?onglet=energie`} className="text-primary-600 hover:underline">
                            {b.nom}
                          </Link>
                        </td>
                        {categories.map((c) => (
                          <td key={c} className="px-4 py-2 text-right whitespace-nowrap">
                            {euros(b.parCategorie[c])}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right font-medium whitespace-nowrap">{euros(b.total)}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">{b.surfaceM2 ? euros(b.total / b.surfaceM2) : '—'}</td>
                        {avecComparaison && (
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            <Evolution actuel={b.total} precedent={b.comparaison} />
                          </td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>

          {stats.details.length > 0 && (
            <Card>
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 font-semibold text-gray-900 dark:text-gray-100">
                Détail des dépenses
              </div>
              <ul className="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
                {stats.details.map((d) => (
                  <li key={`${d.categorie}-${d.sous}`} className="flex items-center justify-between gap-3 px-4 py-2">
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CATEGORIES_STAT[d.categorie].couleur }} />
                      <span className="text-gray-500 dark:text-gray-400">{CATEGORIES_STAT[d.categorie].libelle}</span>
                      <span className="truncate text-gray-900 dark:text-gray-100">{libelleSous(d.categorie, d.sous)}</span>
                    </span>
                    <span className="text-right whitespace-nowrap">
                      <span className="font-medium">{euros(d.montant)}</span>
                      {d.comparaison !== null && <span className="ml-2 text-xs text-gray-500">({euros(d.comparaison)})</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function Camembert({ titre, donnees }: { titre: string; donnees: { cle: string; nom: string; valeur: number; couleur: string }[] }) {
  const total = donnees.reduce((s, d) => s + d.valeur, 0)
  return (
    <Card className="p-4">
      <p className="font-semibold text-gray-900 dark:text-gray-100">{titre}</p>
      {donnees.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">Rien à répartir.</p>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="h-56 w-full sm:w-1/2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={donnees} dataKey="valeur" nameKey="nom" innerRadius="45%" outerRadius="85%" paddingAngle={2} isAnimationActive={false}>
                  {donnees.map((d) => (
                    <Cell key={d.cle} fill={d.couleur} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => euros(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="w-full sm:w-1/2 space-y-1.5 text-sm">
            {donnees.map((d) => (
              <li key={d.cle} className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.couleur }} />
                  {d.nom}
                </span>
                <span className="text-gray-600 dark:text-gray-300 whitespace-nowrap">
                  {euros(d.valeur)} · {total ? Math.round((d.valeur / total) * 100) : 0} %
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

function FenetreExport({ onFermer, exporter }: { onFermer: () => void; exporter: (sections: SectionPdf[]) => Promise<void> }) {
  const [sections, setSections] = useState<SectionPdf[]>(Object.keys(SECTIONS_PDF) as SectionPdf[])
  const [enCours, setEnCours] = useState(false)
  const lancer = async () => {
    setEnCours(true)
    try {
      await exporter(sections)
      toast.success('PDF généré')
      onFermer()
    } catch {
      toast.error("Le PDF n'a pas pu être généré")
    } finally {
      setEnCours(false)
    }
  }
  const choix = useMemo(() => Object.entries(SECTIONS_PDF) as [SectionPdf, string][], [])
  return (
    <Modal isOpen onClose={onFermer} title="Exporter en PDF">
      <ModalBody className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Le PDF reprend les filtres affichés — période, bâtiments, catégories, comparaison. Choisissez ce qu'il contient :
        </p>
        {choix.map(([cle, libelle]) => (
          <label key={cle} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={sections.includes(cle)}
              onChange={() => setSections(sections.includes(cle) ? sections.filter((s) => s !== cle) : [...sections, cle])}
            />
            {libelle}
          </label>
        ))}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onFermer}>
          Annuler
        </Button>
        <Button icon={<FileDown className="w-4 h-4" />} onClick={lancer} loading={enCours} disabled={sections.length === 0}>
          Générer le PDF
        </Button>
      </ModalFooter>
    </Modal>
  )
}
