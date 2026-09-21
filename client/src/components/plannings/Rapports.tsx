import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileDown,
  FileSpreadsheet,
  ListChecks,
  Users,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Button, Card, CardBody, LoadingInline, Select } from '@/components/ui'
import api, {
  ComparaisonTemps,
  GranularitePlanning,
  MesureTemps,
  PartTemps,
  RapportTemps,
  planningApi,
} from '@/lib/api'
import { couleurDe } from '@/lib/paletteCategories'
import { useThemeSombre } from '@/lib/useThemeSombre'
import { decalerJours, enHeures, formaterDuree, jourCourant } from '@/lib/duree'
import { exporterRapportPdf } from './exportPdf'
import { cn } from '@/lib/utils'

/**
 * L'écran de réunion.
 *
 * Une période, une mesure, un axe — et tout de suite les chiffres. La
 * comparaison est posée à côté et non par-dessus : superposer deux camemberts
 * ne montre pas un écart, c'est un histogramme qui le montre. On a donc les
 * deux répartitions côte à côte pour la forme, et des barres pour la variation.
 *
 * **Le sélecteur de mesure est le réglage le plus important de l'écran.**
 * « Temps total mobilisé » compte tous les contributeurs d'une tâche — deux
 * agents une heure font deux heures — tandis que « Temps d'une personne » ne
 * compte que le sien. Les deux sont justes, ils ne répondent pas à la même
 * question, et les additionner ne veut rien dire. D'où la phrase d'explication
 * sous le sélecteur, qui coûte une ligne et évite un malentendu en réunion.
 */

type Axe = 'parCategorie' | 'parPersonne' | 'parManifestation'

const AXES: { value: Axe; label: string }[] = [
  { value: 'parCategorie', label: 'Par catégorie' },
  { value: 'parPersonne', label: 'Par personne' },
  { value: 'parManifestation', label: 'Par manifestation' },
]

const PERIODES: { value: GranularitePlanning; label: string }[] = [
  { value: 'semaine', label: 'Semaine' },
  { value: 'mois', label: 'Mois' },
  { value: 'annee', label: 'Année' },
]

/** Au-delà, les parts deviennent illisibles et se regroupent sous « Autres ». */
const PARTS_VISIBLES = 7

interface RapportsProps {
  personnes: { id: number; nom: string }[]
  moi: number
}

export default function Rapports({ personnes, moi }: RapportsProps) {
  const sombre = useThemeSombre()

  // Trois références plutôt qu'une : le PDF pose chaque carte à sa place,
  // entre les tableaux qui la commentent. Une seule photo de tout le bloc
  // arriverait après coup, réduite à une demi-page illisible.
  const repartitionRef = useRef<HTMLDivElement>(null)
  const ecartsRef = useRef<HTMLDivElement>(null)
  const evolutionRef = useRef<HTMLDivElement>(null)
  const [pdfEnCours, setPdfEnCours] = useState(false)

  const [periode, setPeriode] = useState<GranularitePlanning>('semaine')
  const [ancre, setAncre] = useState(jourCourant())
  const [mesure, setMesure] = useState<MesureTemps>('mobilise')
  const [personneId, setPersonneId] = useState<number | null>(null)
  const [axe, setAxe] = useState<Axe>('parCategorie')
  const [comparaison, setComparaison] = useState<'aucune' | 'precedente' | 'n-1'>('precedente')

  const filtres = useMemo(
    () => ({
      periode,
      ancre,
      mesure,
      personneId,
      ...(comparaison === 'aucune' ? {} : { comparer: comparaison }),
    }),
    [periode, ancre, mesure, personneId, comparaison]
  )

  const { data, isLoading } = useQuery({
    queryKey: ['plannings', 'rapport', filtres],
    queryFn: async () => (await planningApi.rapport(filtres)).data.data,
  })

  const rapport = data?.rapport
  const compare = data?.comparaison ?? null

  const exporter = async (format: 'xlsx' | 'csv') => {
    try {
      const reponse = await api.get(planningApi.urlExport(filtres, format), { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([reponse.data]))
      const lien = document.createElement('a')
      lien.href = url
      lien.setAttribute('download', `plannings_${rapport?.periode.debut ?? jourCourant()}.${format}`)
      document.body.appendChild(lien)
      lien.click()
      lien.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      toast.error("L'export n'a pas abouti.")
    }
  }

  const exporterPdf = async () => {
    if (!rapport) return
    setPdfEnCours(true)
    try {
      await exporterRapportPdf({
        rapport,
        comparaison: compare,
        repartition: repartitionRef.current,
        parts,
        ecarts: ecartsRef.current,
        evolution: evolutionRef.current,
        perimetre: nomPerimetre,
        axe: (AXES.find((a) => a.value === axe)?.label ?? 'catégorie').replace('Par ', ''),
      })
    } catch {
      toast.error("Le PDF n'a pas pu être produit.")
    } finally {
      setPdfEnCours(false)
    }
  }

  // Le pas de navigation suit la période : une flèche doit avancer d'une
  // semaine sur une vue hebdomadaire, pas de sept jours arbitraires.
  const deplacer = (sens: 1 | -1) => {
    if (periode === 'semaine') return setAncre(decalerJours(ancre, 7 * sens))
    const [a, m] = ancre.split('-').map(Number)
    const date = periode === 'mois'
      ? new Date(Date.UTC(a, m - 1 + sens, 1))
      : new Date(Date.UTC(a + sens, 0, 1))
    setAncre(date.toISOString().slice(0, 10))
  }

  if (isLoading || !rapport) return <LoadingInline />

  // Ce que le PDF inscrit sous son titre : sur le papier, plus de sélecteur
  // pour dire de qui l'on parle.
  const nomPerimetre = personneId
    ? personnes.find((p) => p.id === personneId)?.nom ?? 'Une personne'
    : 'Tout le périmètre'

  const parts = regrouperAutres(rapport[axe])
  const donneesCamembert = parts.map((part) => ({
    nom: part.libelle,
    heures: enHeures(part.minutes),
    minutes: part.minutes,
    part: part.part,
    couleur: couleurDe(part.couleur, sombre),
  }))

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------- les réglages */}

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" aria-label="Période précédente" onClick={() => deplacer(-1)}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <span className="min-w-[14rem] text-center font-medium text-gray-900 dark:text-white">
                {rapport.periode.libelle}
              </span>
              <Button variant="ghost" size="icon" aria-label="Période suivante" onClick={() => deplacer(1)}>
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" icon={<FileSpreadsheet className="h-4 w-4" />}
                onClick={() => exporter('xlsx')}>
                Excel
              </Button>
              <Button variant="outline" size="sm" onClick={() => exporter('csv')}>CSV</Button>
              <Button
                variant="outline"
                size="sm"
                icon={<FileDown className="h-4 w-4" />}
                loading={pdfEnCours}
                onClick={exporterPdf}
              >
                PDF
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label="Période"
              value={periode}
              onChange={(e) => setPeriode(e.target.value as GranularitePlanning)}
              options={PERIODES}
            />
            <Select
              label="Mesure"
              value={mesure}
              onChange={(e) => setMesure(e.target.value as MesureTemps)}
              options={[
                { value: 'mobilise', label: 'Temps total mobilisé' },
                { value: 'personne', label: "Temps d'une personne" },
              ]}
            />
            <Select
              label="Personne"
              value={personneId ?? ''}
              placeholder={mesure === 'personne' ? 'Choisir…' : 'Tout le périmètre'}
              onChange={(e) => setPersonneId(e.target.value ? Number(e.target.value) : null)}
              options={personnes.map((p) => ({ value: p.id, label: p.id === moi ? `${p.nom} (moi)` : p.nom }))}
            />
            <Select
              label="Comparer avec"
              value={comparaison}
              onChange={(e) => setComparaison(e.target.value as typeof comparaison)}
              options={[
                { value: 'precedente', label: 'La période précédente' },
                { value: 'n-1', label: "La même période l'an dernier" },
                { value: 'aucune', label: 'Ne pas comparer' },
              ]}
            />
          </div>

          <p className="text-sm text-gray-600 dark:text-gray-400">
            {mesure === 'mobilise'
              ? "Chaque contributeur d'une tâche est compté : deux agents une heure sur la même tâche font deux heures de travail mobilisé."
              : "Seul le temps de la personne choisie est compté, qu'elle ait mené la tâche ou seulement prêté main-forte."}
          </p>
        </CardBody>
      </Card>

      {/* ------------------------------------------------- les totaux */}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tuile
          titre={mesure === 'mobilise' ? 'Temps mobilisé' : 'Temps de la personne'}
          valeur={formaterDuree(rapport.total.minutes)}
          icone={<Clock className="h-5 w-5" />}
          ecart={compare?.ecart ?? null}
        />
        <Tuile titre="Tâches" valeur={String(rapport.total.taches)} icone={<ListChecks className="h-5 w-5" />} />
        <Tuile titre="Personnes" valeur={String(rapport.total.personnes)} icone={<Users className="h-5 w-5" />} />
        <Tuile
          titre="Catégorie dominante"
          valeur={rapport.parCategorie[0]?.libelle ?? '—'}
          icone={<CalendarRange className="h-5 w-5" />}
        />
      </div>

      {/* ------------------------------------------------- répartition */}

      <div className="space-y-4">
        <Card>
          <CardBody>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-medium text-gray-900 dark:text-white">Répartition</h3>
              <Select
                value={axe}
                onChange={(e) => setAxe(e.target.value as Axe)}
                options={AXES}
                className="w-auto"
              />
            </div>

            {rapport.total.minutes === 0 ? (
              <p className="py-10 text-center text-gray-600 dark:text-gray-400">
                Aucune heure saisie sur cette période.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div ref={repartitionRef} className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={donneesCamembert}
                        dataKey="heures"
                        nameKey="nom"
                        cx="50%"
                        cy="50%"
                        outerRadius={95}
                        // 2 px de surface entre les parts : c'est ce qui les
                        // sépare quand deux couleurs voisines se ressemblent.
                        paddingAngle={1}
                        stroke={sombre ? '#1f2937' : '#ffffff'}
                        strokeWidth={2}
                        label={({ percent }) =>
                          percent && percent >= 0.05 ? `${Math.round(percent * 100)} %` : ''
                        }
                        labelLine={false}
                        // Pas d’animation : elle repart de zéro à chaque
                        // changement de filtre ou de thème, et les étiquettes
                        // n’arrivent qu’à la fin — un export déclenché entre-temps
                        // photographiait un camembert sans ses pourcentages. Sur
                        // un écran fait pour lire des chiffres, elle ne fait que
                        // retarder la lecture.
                        isAnimationActive={false}
                      >
                        {donneesCamembert.map((part) => (
                          <Cell key={part.nom} fill={part.couleur} />
                        ))}
                      </Pie>
                      <Tooltip content={<Infobulle sombre={sombre} />} />
                      <Legend
                        verticalAlign="bottom"
                        iconType="circle"
                        formatter={(valeur) => (
                          <span className="text-sm text-gray-700 dark:text-gray-300">{valeur}</span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Le tableau n'est pas un doublon du camembert : trois teintes
                    claires passent sous le seuil de contraste, et c'est lui qui
                    porte alors l'information. Il donne aussi les durées exactes,
                    qu'une part ne saura jamais dire. */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-gray-600 dark:border-gray-700 dark:text-gray-400">
                        <th className="py-2 font-medium">{AXES.find((a) => a.value === axe)?.label.replace('Par ', '')}</th>
                        <th className="py-2 text-right font-medium">Durée</th>
                        <th className="py-2 text-right font-medium">Part</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parts.map((part) => (
                        <tr key={`${part.id}-${part.libelle}`} className="border-b border-gray-100 dark:border-gray-700/50">
                          <td className="py-2">
                            <span className="flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                                style={{ backgroundColor: couleurDe(part.couleur, sombre) }}
                                aria-hidden
                              />
                              <span className="text-gray-900 dark:text-gray-100">{part.libelle}</span>
                            </span>
                          </td>
                          <td className="py-2 text-right tabular-nums text-gray-900 dark:text-gray-100">
                            {formaterDuree(part.minutes)}
                          </td>
                          <td className="py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">
                            {part.part == null ? '—' : `${Math.round(part.part * 1000) / 10} %`}
                          </td>
                        </tr>
                      ))}
                      <tr className="font-medium">
                        <td className="py-2 text-gray-900 dark:text-white">Total</td>
                        <td className="py-2 text-right tabular-nums text-gray-900 dark:text-white">
                          {formaterDuree(rapport.total.minutes)}
                        </td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">100 %</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* ------------------------------------------------- l'écart */}

        {compare && (
          <Ecarts rapport={rapport} comparaison={compare} sombre={sombre} conteneur={ecartsRef} />
        )}

        {/* ------------------------------------------------- l'évolution */}

        {rapport.parPeriode.length > 1 && (
          <Card>
            <CardBody>
              <h3 className="mb-3 text-base font-medium text-gray-900 dark:text-white">Évolution</h3>
              <div ref={evolutionRef} className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rapport.parPeriode.map((p) => ({ ...p, heures: enHeures(p.minutes) }))}>
                    <XAxis dataKey="libelle" tick={{ fontSize: 12, fill: sombre ? '#898781' : '#898781' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: '#898781' }} tickLine={false} axisLine={false} width={40} unit=" h" />
                    <Tooltip content={<Infobulle sombre={sombre} />} cursor={{ fill: sombre ? '#ffffff0d' : '#0b0b0b08' }} />
                    <Bar
                      dataKey="heures"
                      fill={sombre ? '#3987e5' : '#2a78d6'}
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  )
}

/**
 * Les catégories au-delà de la septième se regroupent.
 *
 * La palette compte huit teintes vérifiées ; au-delà, deux parts finiraient de
 * la même couleur. « Autres » est gris, comme « Sans catégorie » : il ne doit
 * pas ressembler à une catégorie.
 */
function regrouperAutres(parts: PartTemps[]): PartTemps[] {
  if (parts.length <= PARTS_VISIBLES + 1) return parts

  const visibles = parts.slice(0, PARTS_VISIBLES)
  const reste = parts.slice(PARTS_VISIBLES)

  return [
    ...visibles,
    {
      id: null,
      libelle: `Autres (${reste.length})`,
      minutes: reste.reduce((total, p) => total + p.minutes, 0),
      part: reste.reduce((total, p) => total + (p.part ?? 0), 0),
    },
  ]
}

function Tuile({
  titre,
  valeur,
  icone,
  ecart,
}: {
  titre: string
  valeur: string
  icone: React.ReactNode
  ecart?: { minutes: number; pourcentage: number | null } | null
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-gray-600 dark:text-gray-400">{titre}</p>
        <span className="text-gray-400 dark:text-gray-500">{icone}</span>
      </div>
      <p className="mt-1 truncate text-2xl font-semibold text-gray-900 dark:text-white">{valeur}</p>
      {ecart && (
        <p className={cn(
          'mt-1 text-sm',
          ecart.minutes > 0 ? 'text-green-700 dark:text-green-400'
            : ecart.minutes < 0 ? 'text-amber-700 dark:text-amber-400'
            : 'text-gray-500 dark:text-gray-400'
        )}>
          {ecart.minutes === 0
            ? 'Identique à la période comparée'
            : `${ecart.minutes > 0 ? '+' : '−'}${formaterDuree(Math.abs(ecart.minutes))}${
                // Une progression depuis zéro n'est pas « +∞ % » : c'est une
                // apparition, et le serveur l'annonce par un pourcentage nul.
                ecart.pourcentage == null ? ' (nouveau)' : ` (${ecart.pourcentage > 0 ? '+' : ''}${ecart.pourcentage} %)`
              }`}
        </p>
      )}
    </div>
  )
}

/** Les écarts par catégorie, en barres : un camembert ne montre pas une variation. */
function Ecarts({
  rapport,
  comparaison,
  sombre,
  conteneur,
}: {
  rapport: RapportTemps
  comparaison: ComparaisonTemps
  sombre: boolean
  conteneur: React.RefObject<HTMLDivElement>
}) {
  const donnees = comparaison.parCategorie
    .filter((c) => c.minutes > 0 || c.minutesReference > 0)
    .slice(0, 10)
    .map((c) => ({
      nom: c.libelle,
      actuel: enHeures(c.minutes),
      reference: enHeures(c.minutesReference),
      minutes: c.minutes,
    }))

  if (donnees.length === 0) return null

  return (
    <Card>
      <CardBody>
        <h3 className="mb-1 text-base font-medium text-gray-900 dark:text-white">
          Écart par catégorie
        </h3>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          {rapport.periode.libelle} comparé à {comparaison.reference.periode.libelle}
        </p>

        <div ref={conteneur} className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={donnees} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis type="number" tick={{ fontSize: 12, fill: '#898781' }} tickLine={false} axisLine={false} unit=" h" />
              <YAxis
                type="category"
                dataKey="nom"
                width={140}
                tick={{ fontSize: 12, fill: '#898781' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<Infobulle sombre={sombre} />} cursor={{ fill: sombre ? '#ffffff0d' : '#0b0b0b08' }} />
              <Legend
                formatter={(valeur) => (
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {valeur === 'reference' ? comparaison.reference.periode.libelle : rapport.periode.libelle}
                  </span>
                )}
              />
              <Bar
                dataKey="reference"
                fill={sombre ? '#64748b' : '#94a3b8'}
                radius={[0, 4, 4, 0]}
                barSize={10}
                isAnimationActive={false}
              />
              <Bar
                dataKey="actuel"
                fill={sombre ? '#3987e5' : '#2a78d6'}
                radius={[0, 4, 4, 0]}
                barSize={10}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  )
}

/**
 * L'infobulle, en heures lisibles.
 *
 * Recharts affiche la valeur brute — « 2.5 » — alors que tout le reste de
 * l'écran dit « 2 h 30 ». Deux unités dans un même graphique obligent à
 * convertir de tête.
 */
function Infobulle({ active, payload, label, sombre }: any) {
  if (!active || !payload?.length) return null

  return (
    <div className={cn(
      'rounded-lg border px-3 py-2 text-sm shadow-lg',
      sombre ? 'border-gray-600 bg-gray-800 text-gray-100' : 'border-gray-200 bg-white text-gray-900'
    )}>
      <p className="font-medium">{payload[0]?.payload?.nom ?? label}</p>
      {payload.map((entree: any, index: number) => (
        <p key={index} className="text-gray-600 dark:text-gray-400">
          {formaterDuree(Math.round(Number(entree.value) * 60))}
        </p>
      ))}
    </div>
  )
}
