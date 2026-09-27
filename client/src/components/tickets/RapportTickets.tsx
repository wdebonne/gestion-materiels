import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, BarChart3, CheckCircle2, Clock, FileDown, Inbox, Info, PieChart as IconeCamembert } from 'lucide-react'
import api from '@/lib/api'
import { couleurDe } from '@/lib/paletteCategories'
import { Button, Card, CardBody, Input, LoadingInline } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useThemeSombre } from '@/lib/useThemeSombre'
import { jourCourant } from '@/lib/duree'
import {
  REPARTITIONS,
  formaterDuree,
  regrouper,
  teinteDuRang,
  teintePour,
  type FormeGraphique,
  type LigneRepartition,
  type RapportDemandes,
} from './rapport/commun'
import ExportRapportModal from './rapport/ExportRapportModal'

export { formaterDuree }

/**
 * Ce que les demandes coûtent, et ce qu'on tient comme délais.
 *
 * ## Trois formes, trois métiers
 *
 * Les volumes sont des **nombres seuls** : « 42 demandes ce mois » n'a pas
 * besoin d'un graphique, et lui en donner un ajouterait du décor sans rien
 * apprendre. Les répartitions sont des **barres horizontales** — comparer des
 * grandeurs entre des libellés nommés, dont certains sont longs. Les délais
 * sont deux nombres côte à côte, parce que c'est **leur écart** qui renseigne.
 *
 * ## Médiane et moyenne, jamais l'une sans l'autre
 *
 * Une demande qui traîne six mois — le rideau qu'on ne commande qu'au budget
 * suivant — tire la moyenne d'un service qui répond par ailleurs en deux
 * heures. Présentée seule en réunion, elle fait conclure l'inverse de la
 * réalité. Quand la moyenne dépasse nettement la médiane, l'écran le dit en
 * toutes lettres : ce sont quelques dossiers bloqués qu'il faut regarder, pas
 * l'équipe.
 *
 * ## Les couleurs sont celles du dépôt, dans leur ordre
 *
 * `paletteCategories` porte huit teintes en **ordre fixe**, validées comme un
 * jeu sur les surfaces réelles de l'application — écart minimal de 9,1 (clair)
 * et 8,4 (sombre) entre voisines en vision déficiente. Laisser la bibliothèque
 * colorer par rang repeindrait toutes les parts dès qu'un filtre change le
 * nombre de catégories, et personne ne se fie longtemps à un graphique dont les
 * couleurs bougent.
 *
 * Trois teintes claires passent sous 3:1 de contraste. C'est pourquoi chaque
 * graphique porte **ses libellés en clair et son tableau à côté** : l'identité
 * d'une barre ne repose jamais sur sa couleur seule.
 *
 * Les répartitions par bâtiment, service, demandeur et technicien n'emploient
 * **qu'une seule teinte** en barres : elles comparent une grandeur, elles ne
 * distinguent pas des identités. Huit couleurs y laisseraient croire à un sens
 * qui n'existe pas. En camembert, en revanche, des parts de même couleur se
 * confondraient : chacune prend alors la teinte de son rang.
 *
 * ## Le choix de la forme se retient
 *
 * Barres ou camembert, c'est une préférence de lecteur, pas un réglage de
 * période : elle survit au rechargement, dans ce navigateur seulement. Elle sert
 * aussi de valeur par défaut à l'export PDF.
 */

const CLE_FORME = 'tickets.rapport.forme'

function formeRetenue(): FormeGraphique {
  try {
    return localStorage.getItem(CLE_FORME) === 'camembert' ? 'camembert' : 'barres'
  } catch {
    return 'barres'
  }
}

function premierDuMois(): string {
  const d = new Date()
  // En date locale : `toISOString()` passait en UTC, et le minuit du 1er
  // devenait la veille à 22 h — la période s’ouvrait sur le mois précédent.
  return jourCourant(new Date(d.getFullYear(), d.getMonth(), 1))
}

export default function RapportTickets() {
  const [debut, setDebut] = useState(premierDuMois())
  const [fin, setFin] = useState(jourCourant())
  const [forme, setFormeEtat] = useState<FormeGraphique>(formeRetenue)
  const [exportOuvert, setExportOuvert] = useState(false)

  const setForme = (valeur: FormeGraphique) => {
    setFormeEtat(valeur)
    try {
      localStorage.setItem(CLE_FORME, valeur)
    } catch {
      // Navigation privée : la préférence vaut pour la session, c'est tout.
    }
  }

  // Le hook du dépôt, et non une lecture ponctuelle de la classe : basculer le
  // thème doit repeindre les graphiques, pas attendre un rechargement.
  const sombre = useThemeSombre()

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', 'rapport', debut, fin],
    queryFn: async () => (await api.get(`/tickets/rapport?debut=${debut}&fin=${fin}`)).data,
  })

  const r: RapportDemandes | undefined = data?.rapport

  return (
    <div className="space-y-6">
      {/* Les filtres, en une ligne au-dessus des chiffres. */}
      <Card>
        <CardBody className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <Input label="Du" type="date" value={debut} onChange={(e: any) => setDebut(e.target.value)} />
          <Input label="Au" type="date" value={fin} onChange={(e: any) => setFin(e.target.value)} />
          <div className="flex flex-col gap-2 sm:ml-auto sm:items-end">
            <div className="flex gap-2">
              <div
                role="radiogroup"
                aria-label="Forme des graphiques"
                className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700"
              >
                {(
                  [
                    { value: 'barres', libelle: 'Barres', icone: <BarChart3 className="h-4 w-4" /> },
                    { value: 'camembert', libelle: 'Camembert', icone: <IconeCamembert className="h-4 w-4" /> },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    role="radio"
                    aria-checked={forme === f.value}
                    onClick={() => setForme(f.value)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                      forme === f.value
                        ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                        : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                    )}
                  >
                    {f.icone}
                    {f.libelle}
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                icon={<FileDown className="h-4 w-4" />}
                disabled={!r}
                onClick={() => setExportOuvert(true)}
              >
                PDF
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Ne compte que les demandes que vous avez le droit de voir.
            </p>
          </div>
        </CardBody>
      </Card>

      {exportOuvert && r && (
        <ExportRapportModal rapport={r} formeEcran={forme} onFerme={() => setExportOuvert(false)} />
      )}

      {isLoading || !r ? (
        <LoadingInline />
      ) : (
        <>
          {/* ---------------------------------------------- les nombres seuls */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Chiffre icone={<Inbox className="w-5 h-5" />} libelle="Ouvertes sur la période" valeur={r.ouvertes} />
            <Chiffre
              icone={<CheckCircle2 className="w-5 h-5" />}
              libelle="Closes"
              valeur={r.closes}
              teinte="vert"
              sombre={sombre}
            />
            <Chiffre
              icone={<Clock className="w-5 h-5" />}
              libelle="Encore en cours"
              valeur={r.enCours}
              teinte="jaune"
              sombre={sombre}
            />
            <Chiffre
              icone={<AlertTriangle className="w-5 h-5" />}
              libelle="Délai dépassé"
              valeur={r.enRetard}
              /* Le rouge est ici un **état**, pas une série : il ne sert nulle
                 part ailleurs dans cet écran, et il est toujours accompagné de
                 son icône et de son libellé. */
              teinte={r.enRetard > 0 ? 'rouge' : undefined}
              sombre={sombre}
            />
          </div>

          {/* ------------------------------------------------------ les délais */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Delais titre="Délai de prise en charge" delais={r.priseEnCharge} />
            <Delais titre="Délai de résolution" delais={r.resolution} />
          </div>

          {/* ------------------------------------------------- les répartitions */}
          {REPARTITIONS.map((repartition) => (
            <Repartition
              key={repartition.id}
              titre={repartition.titre}
              lignes={r[repartition.champ] ?? []}
              sombre={sombre}
              forme={forme}
              /* Seule la catégorie porte une identité par sa couleur : elle
                 garde la sienne d'un écran à l'autre. */
              parIdentite={repartition.parIdentite}
            />
          ))}

          {/* -------------------------------------------------- le temps passé */}
          <Card>
            <CardBody>
              <h3 className="text-base font-medium text-gray-900 dark:text-white">Temps passé</h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Somme du temps déclaré dans les plannings et rattaché à une demande, renforts
                compris — ce que ces demandes ont coûté à la collectivité.
              </p>
              <p className="mt-3 text-3xl font-semibold text-gray-900 dark:text-white">
                {formaterDuree(r.tempsPasseMinutes)}
              </p>

              {r.tempsParCategorie.length > 0 ? (
                <ul className="mt-4 space-y-1.5">
                  {r.tempsParCategorie.map((c, rang) => (
                    <li key={c.cle} className="flex items-center gap-2 text-sm">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: teinteDuRang(rang, sombre) }}
                      />
                      <span className="text-gray-700 dark:text-gray-300">{c.libelle}</span>
                      <span className="ml-auto tabular-nums text-gray-500">
                        {formaterDuree(c.total)} · {c.part} %
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 flex items-start gap-2 text-sm text-gray-500">
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  Aucune heure n'a encore été rattachée à une demande. La saisie de temps propose
                  les demandes ouvertes dans son champ « Demande concernée ».
                </p>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}

/** Un nombre seul : il n'a pas besoin d'un graphique. */
function Chiffre({
  icone,
  libelle,
  valeur,
  teinte,
  sombre,
}: {
  icone: React.ReactNode
  libelle: string
  valeur: number
  teinte?: string
  sombre?: boolean
}) {
  return (
    <Card>
      <CardBody className="py-4">
        <div className="flex items-center gap-2">
          {/*
            La couleur est portée par l'icône, jamais par le chiffre.

            Un nombre teinté est un nombre moins lisible : trois des huit
            teintes de la palette passent sous 3:1 de contraste sur l'une des
            deux surfaces, et c'est justement le chiffre qu'on vient chercher.
            L'icône, elle, n'a rien à faire lire — elle signale, et son libellé
            dit la même chose en toutes lettres à côté d'elle.
          */}
          <span style={teinte ? { color: couleurDe(teinte, Boolean(sombre)) } : undefined} className={teinte ? '' : 'text-gray-400'}>
            {icone}
          </span>
          <span className="text-xs uppercase tracking-wide text-gray-400">{libelle}</span>
        </div>
        <p className="mt-2 text-3xl font-semibold tabular-nums text-gray-900 dark:text-white">
          {valeur}
        </p>
      </CardBody>
    </Card>
  )
}

/**
 * Médiane et moyenne, côte à côte.
 *
 * L'écart entre les deux est commenté quand il devient parlant : sans cette
 * phrase, il faut savoir lire deux nombres pour comprendre qu'un service rapide
 * traîne trois dossiers.
 */
function Delais({ titre, delais }: { titre: string; delais: any }) {
  const ecartParlant =
    delais.medianeMinutes !== null &&
    delais.moyenneMinutes !== null &&
    delais.moyenneMinutes > delais.medianeMinutes * 2

  const total = delais.dansLesDelais + delais.horsDelais

  return (
    <Card>
      <CardBody>
        <h3 className="text-base font-medium text-gray-900 dark:text-white">{titre}</h3>

        {delais.mesurees === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            Aucune demande close sur la période : le délai ne se mesure que sur ce qui est terminé.
          </p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Médiane</p>
                <p className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">
                  {formaterDuree(delais.medianeMinutes)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Moyenne</p>
                <p className="text-2xl font-semibold tabular-nums text-gray-500">
                  {formaterDuree(delais.moyenneMinutes)}
                </p>
              </div>
            </div>

            <p className="mt-2 text-xs text-gray-500">
              Sur {delais.mesurees} demande(s) close(s).
            </p>

            {ecartParlant && (
              <p className="mt-2 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                La moyenne dépasse nettement la médiane : quelques dossiers bloqués pèsent sur le
                total. Ce sont eux qu'il faut regarder, pas l'ensemble.
              </p>
            )}

            {total > 0 && (
              <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
                <strong className="tabular-nums">{delais.dansLesDelais}</strong> dans les délais,{' '}
                <strong className="tabular-nums">{delais.horsDelais}</strong> au-delà — sur les{' '}
                {total} qui avaient une échéance.
              </p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  )
}

/**
 * Une répartition : des barres ou un camembert, **et** son tableau.
 *
 * Le tableau n'est pas une redite. Trois teintes de la palette passent sous 3:1
 * de contraste sur fond clair, et l'identité d'une barre ne doit jamais reposer
 * sur sa seule couleur — ni pour un daltonien, ni à l'impression, ni sur un
 * écran de chantier en plein soleil.
 */
function Repartition({
  titre,
  lignes,
  sombre,
  forme,
  parIdentite,
}: {
  titre: string
  lignes: LigneRepartition[]
  sombre: boolean
  forme: FormeGraphique
  parIdentite?: boolean
}) {
  if (!lignes || lignes.length === 0) return null

  // Au-delà de huit, deux barres partageraient une teinte : le reste est
  // regroupé plutôt que recolorié au hasard. Les libellés restent exacts.
  const donnees = regrouper(lignes)
  const multicolore = forme === 'camembert' || Boolean(parIdentite)
  const teinte = (ligne: LigneRepartition, rang: number) => teintePour(ligne, rang, sombre, multicolore)

  return (
    <Card>
      <CardBody>
        <h3 className="mb-3 text-base font-medium text-gray-900 dark:text-white">{titre}</h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/*
            34 px par barre, plus la place des graduations. Un plancher à 160 px
            faisait flotter une barre unique au milieu d'un grand vide, et
            laissait croire qu'il manquait des lignes.
          */}
          {forme === 'camembert' ? (
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donnees}
                    dataKey="total"
                    nameKey="libelle"
                    outerRadius="90%"
                    /* Le liseré sépare les parts ; seule, une part n'a rien à
                       séparer, et il dessinait un rayon parasite. */
                    stroke={sombre ? '#1f2937' : '#ffffff'}
                    strokeWidth={donnees.length > 1 ? 2 : 0}
                    isAnimationActive={false}
                  >
                    {donnees.map((ligne, rang) => (
                      <Cell key={ligne.cle} fill={teinte(ligne, rang)} />
                    ))}
                  </Pie>
                  <Tooltip content={<Infobulle sombre={sombre} />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
          <div style={{ height: donnees.length * 34 + 48 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={donnees} layout="vertical" margin={{ left: 8, right: 24 }}>
                <XAxis
                  type="number"
                  tick={{ fontSize: 12, fill: '#898781' }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="libelle"
                  width={140}
                  tick={{ fontSize: 12, fill: '#898781' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  content={<Infobulle sombre={sombre} />}
                  cursor={{ fill: sombre ? '#ffffff0d' : '#0b0b0b08' }}
                />
                <Bar dataKey="total" radius={[0, 4, 4, 0]} barSize={12} isAnimationActive={false}>
                  {donnees.map((ligne, rang) => (
                    <Cell key={ligne.cle} fill={teinte(ligne, rang)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          )}

          {/* Le tableau, à côté du graphique et non à sa place. */}
          <table className="w-full text-sm self-start">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="pb-2 font-medium">Libellé</th>
                <th className="pb-2 font-medium text-right">Demandes</th>
                <th className="pb-2 font-medium text-right">Part</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {donnees.map((ligne, rang) => (
                <tr key={ligne.cle}>
                  <td className="py-1.5 text-gray-700 dark:text-gray-300">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: teinte(ligne, rang) }}
                      />
                      {ligne.libelle}
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-gray-900 dark:text-white">
                    {ligne.total}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-gray-500">{ligne.part} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  )
}

/** L'infobulle : le libellé, le nombre, la part. */
function Infobulle({ active, payload, sombre }: any) {
  if (!active || !payload?.length) return null
  const ligne = payload[0]?.payload

  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 text-sm shadow-lg',
        sombre ? 'border-gray-600 bg-gray-800 text-gray-100' : 'border-gray-200 bg-white text-gray-900'
      )}
    >
      <p className="font-medium">{ligne?.libelle}</p>
      <p className="text-gray-600 dark:text-gray-400">
        {ligne?.total} demande(s) · {ligne?.part} %
      </p>
    </div>
  )
}
