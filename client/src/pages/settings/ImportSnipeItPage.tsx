import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Plug,
  Search,
  Download,
  CheckCircle2,
  AlertTriangle,
  KeyRound,
  Package,
  ExternalLink,
} from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
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
  Select,
} from '@/components/ui'

/**
 * Reprise d'un inventaire Snipe-IT.
 *
 * Trois temps, et le deuxième est le seul qui compte vraiment :
 *
 *   **connexion** — adresse et jeton, testés avant d'être enregistrés ;
 *   **aperçu** — ce que l'import compte écrire, ligne à ligne, avec le lieu
 *   déduit du libellé et modifiable. Snipe-IT ne sait pas dire ce qu'une clé
 *   ouvre : la déduction vient du nom, et un rattachement faux envoie
 *   quelqu'un devant la mauvaise porte. Ce qui n'a pas été lu avec certitude
 *   est signalé ;
 *   **écriture** — le plan validé, et rien d'autre.
 *
 * Le plan analysé est renvoyé tel quel à l'écriture : ce qui a été montré est
 * ce qui est écrit, même si l'inventaire distant change entre-temps.
 */

interface Lecture {
  site?: string
  ouvrant?: string
  estPasse: boolean
  confiance: 'sure' | 'probable' | 'aucune'
  reste: string
}

interface PropositionCle {
  sourceId: number
  nom: string
  modele: string | null
  serie: string | null
  quantite: number
  prixUnitaire: number | null
  dateAchat: string | null
  categorieSnipe: string | null
  lecture: Lecture
  objectIdExistant: number | null
}

interface PropositionTrousseau {
  sourceId: number
  inventaire: string
  nom: string
  composants: number[]
  detenteur: { type: string; nom: string } | null
  objectIdExistant: number | null
}

interface PlanImport {
  cles: PropositionCle[]
  trousseaux: PropositionTrousseau[]
  sites: string[]
  avertissements: string[]
}

/** Rattachement corrigé par l'utilisateur, s'il l'a touché. */
interface Correction {
  site: string
  ouvrant: string
  estPasse: boolean
}

const badgeConfiance = {
  sure: null,
  probable: { texte: 'à vérifier', variant: 'warning' as const },
  aucune: { texte: 'à saisir', variant: 'danger' as const },
}

export default function ImportSnipeItPage() {
  const queryClient = useQueryClient()

  const [baseUrl, setBaseUrl] = useState('')
  const [jeton, setJeton] = useState('')
  const [plan, setPlan] = useState<PlanImport | null>(null)
  const [corrections, setCorrections] = useState<Map<number, Correction>>(new Map())
  const [clesRetenues, setClesRetenues] = useState<Set<number>>(new Set())
  const [trousseauxRetenus, setTrousseauxRetenus] = useState<Set<number>>(new Set())
  const [categorie, setCategorie] = useState('')
  const [reprendreDetenteurs, setReprendreDetenteurs] = useState(true)
  const [sousCategorieCles, setSousCategorieCles] = useState('Clés et badges')
  const [sousCategorieTrousseaux, setSousCategorieTrousseaux] = useState('Trousseaux')
  const [resultat, setResultat] = useState<any>(null)

  const { data: config, isLoading } = useQuery({
    queryKey: ['snipeit-config'],
    queryFn: async () => {
      const res = await api.get('/cles/snipeit/config')
      const d = res.data.data
      if (d.baseUrl) setBaseUrl(d.baseUrl)
      return d
    },
  })

  const { data: categories = [] } = useQuery<any[]>({
    queryKey: ['categories-import-snipeit'],
    queryFn: async () => (await api.get('/categories')).data.categories ?? [],
  })

  const [diagnostic, setDiagnostic] = useState<{
    ok: boolean
    message: string
    urlSuggeree?: string
  } | null>(null)

  const tester = useMutation({
    mutationFn: async () => (await api.post('/cles/snipeit/tester', { baseUrl, token: jeton })).data.data,
    onSuccess: (d) => {
      // Le diagnostic reste sous les yeux : un message d'adresse comporte
      // plusieurs choses à vérifier, et un toast disparaît avant qu'on ait fini
      // de les lire.
      setDiagnostic(d)
      if (d.ok && !d.urlSuggeree) {
        toast.success(`Connexion établie : ${d.actifs} actif(s), ${d.composants} composant(s)`)
      }
    },
    onError: () => {
      setDiagnostic({ ok: false, message: 'Le serveur n\'a pas pu joindre Snipe-IT.' })
    },
  })

  const enregistrer = useMutation({
    mutationFn: async () => api.put('/cles/snipeit/config', { baseUrl, token: jeton }),
    onSuccess: () => {
      setJeton('')
      queryClient.invalidateQueries({ queryKey: ['snipeit-config'] })
      toast.success('Connexion enregistrée')
    },
    onError: () => toast.error('Enregistrement impossible'),
  })

  const analyser = useMutation({
    mutationFn: async () => (await api.post('/cles/snipeit/analyser')).data.data as PlanImport,
    onSuccess: (p) => {
      setPlan(p)
      setCorrections(new Map())
      // Tout est retenu par défaut : l'utilisateur vient pour tout reprendre,
      // et décocher les exceptions est moins fastidieux que tout cocher.
      setClesRetenues(new Set(p.cles.map((c) => c.sourceId)))
      setTrousseauxRetenus(new Set(p.trousseaux.filter((t) => t.inventaire).map((t) => t.sourceId)))
      setResultat(null)
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Lecture de Snipe-IT impossible'),
  })

  const importer = useMutation({
    mutationFn: async () => {
      const cles = [...clesRetenues].map((sourceId) => {
        const proposee = plan!.cles.find((c) => c.sourceId === sourceId)!
        const corrigee = corrections.get(sourceId)
        return {
          sourceId,
          site: corrigee ? corrigee.site : (proposee.lecture.site ?? ''),
          ouvrant: corrigee ? corrigee.ouvrant : (proposee.lecture.ouvrant ?? ''),
          estPasse: corrigee ? corrigee.estPasse : proposee.lecture.estPasse,
        }
      })

      const res = await api.post('/cles/snipeit/importer', {
        plan,
        choix: {
          categoryId: Number(categorie),
          trousseaux: [...trousseauxRetenus],
          cles,
          reprendreDetenteurs,
          sousCategorieCles,
          sousCategorieTrousseaux,
        },
      })
      return res.data.data
    },
    onSuccess: (r) => {
      setResultat(r)
      queryClient.invalidateQueries({ queryKey: ['cles'] })
      queryClient.invalidateQueries({ queryKey: ['cles-referentiel'] })
      toast.success('Import terminé')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Import impossible'),
  })

  const corriger = (sourceId: number, champ: keyof Correction, valeur: string | boolean) => {
    setCorrections((precedentes) => {
      const suivantes = new Map(precedentes)
      const proposee = plan!.cles.find((c) => c.sourceId === sourceId)!
      const actuelle = suivantes.get(sourceId) ?? {
        site: proposee.lecture.site ?? '',
        ouvrant: proposee.lecture.ouvrant ?? '',
        estPasse: proposee.lecture.estPasse,
      }
      suivantes.set(sourceId, { ...actuelle, [champ]: valeur } as Correction)
      return suivantes
    })
  }

  const valeurCorrigee = (cle: PropositionCle): Correction =>
    corrections.get(cle.sourceId) ?? {
      site: cle.lecture.site ?? '',
      ouvrant: cle.lecture.ouvrant ?? '',
      estPasse: cle.lecture.estPasse,
    }

  const aVerifier = useMemo(
    () => (plan?.cles ?? []).filter((c) => c.lecture.confiance !== 'sure').length,
    [plan]
  )

  if (isLoading) return <LoadingInline />

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------- connexion */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Plug className="h-5 w-5 text-primary-600" />
              Connexion à Snipe-IT
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Créez un jeton dans Snipe-IT : votre profil → <em>Manage API Keys</em> →{' '}
            <em>Create New Token</em>. Le jeton donne accès en lecture à tout votre inventaire
            Snipe-IT : il n'est lisible que par un administrateur, n'est jamais réaffiché ici, et
            reste révocable depuis Snipe-IT à tout moment.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Adresse de l'instance"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://inventaire.pavilly.fr"
              icon={<ExternalLink className="h-4 w-4" />}
            />
            <Input
              label="Jeton d'API"
              type="password"
              value={jeton}
              onChange={(e) => setJeton(e.target.value)}
              placeholder={config?.configure ? config.jeton : 'eyJ0eXAiOiJKV1Qi...'}
              hint={
                config?.configure
                  ? 'Laissez vide pour conserver le jeton déjà enregistré'
                  : undefined
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => tester.mutate()}
              disabled={!baseUrl || tester.isPending}
            >
              Tester la connexion
            </Button>
            <Button
              onClick={() => enregistrer.mutate()}
              disabled={!baseUrl || enregistrer.isPending}
            >
              Enregistrer
            </Button>
            {config?.dernierImport && (
              <span className="text-sm text-gray-600 dark:text-gray-300">
                Dernier import : {new Date(config.dernierImport).toLocaleString('fr-FR')}
              </span>
            )}
          </div>

          {diagnostic && (
            <Alert type={diagnostic.ok ? (diagnostic.urlSuggeree ? 'warning' : 'success') : 'error'}>
              <div className="space-y-2">
                <p>{diagnostic.message}</p>
                {diagnostic.urlSuggeree && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setBaseUrl(diagnostic.urlSuggeree!)
                      setDiagnostic(null)
                    }}
                  >
                    Utiliser {diagnostic.urlSuggeree}
                  </Button>
                )}
              </div>
            </Alert>
          )}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------ analyse */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Search className="h-5 w-5 text-primary-600" />
              Aperçu avant import
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            L'analyse ne lit que Snipe-IT et n'écrit rien. Les <strong>composants</strong>{' '}
            deviennent des clés, les <strong>actifs</strong> des trousseaux, et les composants
            sortis vers un actif en forment la composition.
          </p>

          <Button
            variant="outline"
            onClick={() => analyser.mutate()}
            disabled={!config?.configure || analyser.isPending}
          >
            {analyser.isPending ? 'Lecture en cours…' : 'Analyser l\'inventaire'}
          </Button>

          {!config?.configure && (
            <Alert type="info">Enregistrez d'abord une connexion.</Alert>
          )}

          {plan && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="info">
                  <span className="flex items-center gap-1">
                    <Package className="h-3.5 w-3.5" />
                    {plan.cles.length} clé(s)
                  </span>
                </Badge>
                <Badge variant="info">
                  <span className="flex items-center gap-1">
                    <KeyRound className="h-3.5 w-3.5" />
                    {plan.trousseaux.length} trousseau(x)
                  </span>
                </Badge>
                <Badge variant="default">{plan.sites.length} site(s) déduit(s)</Badge>
                {aVerifier > 0 && <Badge variant="warning">{aVerifier} à vérifier</Badge>}
              </div>

              {plan.avertissements.map((a, i) => (
                <Alert key={i} type="warning">
                  {a}
                </Alert>
              ))}

              {/* Les clés, avec leur rattachement modifiable */}
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800/60">
                    <tr className="text-left text-gray-600 dark:text-gray-300">
                      <th className="p-2 font-medium">Reprendre</th>
                      <th className="p-2 font-medium">Clé (Snipe-IT)</th>
                      <th className="p-2 font-medium">Qté / prix</th>
                      <th className="p-2 font-medium">Site</th>
                      <th className="p-2 font-medium">Ouvrant</th>
                      <th className="p-2 font-medium">Passe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.cles.map((cle) => {
                      const v = valeurCorrigee(cle)
                      const marque = badgeConfiance[cle.lecture.confiance]

                      return (
                        <tr
                          key={cle.sourceId}
                          className="border-t border-gray-100 dark:border-gray-700/50"
                        >
                          <td className="p-2">
                            <input
                              type="checkbox"
                              checked={clesRetenues.has(cle.sourceId)}
                              onChange={() =>
                                setClesRetenues((s) => {
                                  const n = new Set(s)
                                  n.has(cle.sourceId) ? n.delete(cle.sourceId) : n.add(cle.sourceId)
                                  return n
                                })
                              }
                              className="h-4 w-4 rounded border-gray-300 text-primary-600"
                            />
                          </td>
                          <td className="p-2">
                            <div className="font-medium text-gray-900 dark:text-gray-100">
                              {cle.nom}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                              {cle.modele && <span>modèle {cle.modele}</span>}
                              {marque && (
                                <Badge variant={marque.variant} size="sm">
                                  {marque.texte}
                                </Badge>
                              )}
                              {cle.objectIdExistant && (
                                <Badge variant="default" size="sm">
                                  déjà importée
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="p-2 whitespace-nowrap text-gray-700 dark:text-gray-200">
                            {cle.quantite}
                            {cle.prixUnitaire !== null && (
                              <span className="text-gray-500"> × {cle.prixUnitaire} €</span>
                            )}
                          </td>
                          <td className="p-2">
                            <input
                              value={v.site}
                              onChange={(e) => corriger(cle.sourceId, 'site', e.target.value)}
                              placeholder="—"
                              className="w-36 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              value={v.estPasse ? '' : v.ouvrant}
                              disabled={v.estPasse}
                              onChange={(e) => corriger(cle.sourceId, 'ouvrant', e.target.value)}
                              placeholder={v.estPasse ? 'tout le site' : '—'}
                              className="w-40 rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:disabled:bg-gray-800"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="checkbox"
                              checked={v.estPasse}
                              onChange={(e) => corriger(cle.sourceId, 'estPasse', e.target.checked)}
                              className="h-4 w-4 rounded border-gray-300 text-primary-600"
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Les trousseaux */}
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800/60">
                    <tr className="text-left text-gray-600 dark:text-gray-300">
                      <th className="p-2 font-medium">Reprendre</th>
                      <th className="p-2 font-medium">N° inventaire</th>
                      <th className="p-2 font-medium">Trousseau</th>
                      <th className="p-2 font-medium">Composition</th>
                      <th className="p-2 font-medium">Détenteur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.trousseaux.map((t) => (
                      <tr key={t.sourceId} className="border-t border-gray-100 dark:border-gray-700/50">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            disabled={!t.inventaire}
                            checked={trousseauxRetenus.has(t.sourceId)}
                            onChange={() =>
                              setTrousseauxRetenus((s) => {
                                const n = new Set(s)
                                n.has(t.sourceId) ? n.delete(t.sourceId) : n.add(t.sourceId)
                                return n
                              })
                            }
                            className="h-4 w-4 rounded border-gray-300 text-primary-600"
                          />
                        </td>
                        <td className="p-2 font-mono text-gray-900 dark:text-gray-100">
                          {t.inventaire || <span className="text-red-600">absent</span>}
                        </td>
                        <td className="p-2 text-gray-900 dark:text-gray-100">{t.nom}</td>
                        <td className="p-2 text-gray-700 dark:text-gray-200">
                          {t.composants.length} clé(s)
                        </td>
                        <td className="p-2 text-gray-700 dark:text-gray-200">
                          {t.detenteur?.nom ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------ import */}
      {plan && (
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Download className="h-5 w-5 text-primary-600" />
                Écrire dans le parc
              </span>
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <Select
              label="Catégorie de destination"
              value={categorie}
              onChange={(e) => setCategorie(e.target.value)}
              placeholder="Où ranger les clés et les trousseaux"
              options={categories.map((c: any) => ({ value: String(c.id), label: c.name }))}
              hint="Elle sera rattachée au plugin Clés automatiquement."
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Sous-catégorie des clés et badges"
                value={sousCategorieCles}
                onChange={(e) => setSousCategorieCles(e.target.value)}
                placeholder="Clés et badges"
              />
              <Input
                label="Sous-catégorie des trousseaux"
                value={sousCategorieTrousseaux}
                onChange={(e) => setSousCategorieTrousseaux(e.target.value)}
                placeholder="Trousseaux"
              />
            </div>
            <p className="-mt-2 text-xs text-gray-600 dark:text-gray-400">
              Créées si elles n'existent pas. L'écran des catégories n'affiche que des
              sous-catégories&nbsp;: sans elles, le matériel importé reste introuvable depuis
              la navigation, même s'il est bien enregistré. Videz les deux champs pour ranger
              directement dans la catégorie.
            </p>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                checked={reprendreDetenteurs}
                onChange={(e) => setReprendreDetenteurs(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary-600"
              />
              Reprendre les détenteurs courants comme remises en cours
            </label>

            <Alert type="info">
              {clesRetenues.size} clé(s) et {trousseauxRetenus.size} trousseau(x) seront écrits.
              L'import est rejouable : relancé, il met à jour au lieu de dupliquer.
            </Alert>

            <Button
              onClick={() => importer.mutate()}
              disabled={!categorie || importer.isPending || clesRetenues.size + trousseauxRetenus.size === 0}
            >
              {importer.isPending ? 'Import en cours…' : 'Importer'}
            </Button>

            {resultat && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
                <div className="mb-2 flex items-center gap-2 font-medium text-green-800 dark:text-green-300">
                  <CheckCircle2 className="h-5 w-5" />
                  Import terminé
                </div>
                <ul className="space-y-0.5 text-sm text-green-900 dark:text-green-200">
                  <li>{resultat.clesCreees} clé(s) créée(s), {resultat.clesMisesAJour} mise(s) à jour</li>
                  <li>
                    {resultat.trousseauxCrees} trousseau(x) créé(s),{' '}
                    {resultat.trousseauxMisAJour} mis à jour
                  </li>
                  <li>
                    {resultat.sitesCrees} site(s) et {resultat.ouvrantsCrees} ouvrant(s) créés
                  </li>
                  <li>{resultat.sousCategoriesCreees} sous-catégorie(s) créée(s)</li>
                  <li>{resultat.compositions} rattachement(s) de clé à un trousseau</li>
                  <li>{resultat.attributions} détention(s) reprise(s)</li>
                </ul>
                {resultat.ignores?.length > 0 && (
                  <div className="mt-3 flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <div>
                      <div className="font-medium">Ignoré :</div>
                      <ul className="list-inside list-disc">
                        {resultat.ignores.map((i: string, n: number) => (
                          <li key={n}>{i}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  )
}
