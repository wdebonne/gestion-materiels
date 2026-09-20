import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Cloud, CheckCircle2, ChevronRight, ClipboardCopy, Download, File, FileSpreadsheet,
  FileText, Folder, FolderOpen, Home, Image, RefreshCw, XCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Spinner,
} from '@/components/ui'
import api, { nextcloudApi, type EntreeNextcloud } from '@/lib/api'

/**
 * La connexion au Nextcloud de la commune, et ce qu'on y trouve.
 *
 * Cette configuration se réglait dans *Manifestations > Export*, où elle avait
 * été écrite : c'est le dépôt du suivi qui l'avait rendue nécessaire. Elle sert
 * depuis aux modèles de document, et n'appartient plus à un module.
 *
 * L'explorateur n'est pas un confort. Un chemin de dossier se recopie à la main
 * dans un profil d'export comme dans un modèle, et le dépôt est silencieux par
 * construction — un Nextcloud injoignable ne doit jamais faire échouer la
 * validation d'une manifestation. Une faute de frappe ne se voyait donc pas :
 * elle produisait un fichier qu'on ne retrouvait jamais, dans un dossier créé
 * pour l'occasion à côté du bon. Voir l'arborescence permet de désigner un
 * dossier au lieu de l'épeler.
 */

const UNITES = ['o', 'Ko', 'Mo', 'Go', 'To']

const formatTaille = (octets?: number): string => {
  if (octets === undefined || Number.isNaN(octets)) return ''
  let valeur = octets
  let rang = 0
  while (valeur >= 1024 && rang < UNITES.length - 1) {
    valeur /= 1024
    rang += 1
  }
  return `${rang === 0 ? valeur : valeur.toFixed(1)} ${UNITES[rang]}`
}

const formatDate = (iso?: string): string =>
  iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : ''

/** Une icône qui distingue au coup d'œil un tableur d'un courrier. */
function IconeFichier({ nom }: { nom: string }) {
  const extension = nom.toLowerCase().split('.').pop() ?? ''
  const classe = 'w-4 h-4 flex-shrink-0'

  if (['xlsx', 'xls', 'csv', 'ods'].includes(extension)) {
    return <FileSpreadsheet className={`${classe} text-green-600`} />
  }
  if (['docx', 'doc', 'odt', 'pdf', 'txt', 'md'].includes(extension)) {
    return <FileText className={`${classe} text-blue-600`} />
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)) {
    return <Image className={`${classe} text-purple-600`} />
  }
  return <File className={`${classe} text-gray-400`} />
}

type Config = { url: string; username: string; folder: string; configured: boolean }

export default function NextcloudPage() {
  const [chemin, setChemin] = useState<string | null>(null)

  const { data: config, isLoading } = useQuery({
    queryKey: ['nextcloud-config'],
    queryFn: async () => (await nextcloudApi.getConfig()).data.data,
  })

  // L'explorateur ouvre sur le dossier de travail, pas sur la racine : c'est
  // celui dont on vérifie le contenu, et la racine d'un compte municipal en
  // contient trente autres.
  useEffect(() => {
    if (chemin === null && config?.configured) setChemin(config.folder || '')
  }, [config, chemin])

  if (isLoading) {
    return <div className="flex justify-center py-10"><Spinner /></div>
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Le dépôt des exports, les modèles de document et les pièces partagées passent par ce
        compte. Le sens est unique : l'application reste la source de vérité, et le fichier déposé
        sert à consulter et à annoter à côté.
      </p>

      <Connexion config={config} onDossier={setChemin} />

      <Explorateur
        configure={Boolean(config?.configured)}
        racine={config?.url ?? ''}
        chemin={chemin ?? ''}
        onNaviguer={setChemin}
      />
    </div>
  )
}

// ==================== CONNEXION ====================

function Connexion({
  config,
  onDossier,
}: {
  config?: Config
  onDossier: (dossier: string) => void
}) {
  const queryClient = useQueryClient()
  const [brouillon, setBrouillon] = useState({
    url: config?.url ?? '',
    username: config?.username ?? '',
    folder: config?.folder ?? 'Manifestations',
  })
  const [motDePasse, setMotDePasse] = useState('')
  const [verdict, setVerdict] = useState<{ ok: boolean; message: string } | null>(null)

  const enregistrement = useMutation({
    mutationFn: () =>
      nextcloudApi.saveConfig({
        url: brouillon.url,
        username: brouillon.username,
        password: motDePasse || undefined,
        folder: brouillon.folder,
      }),
    onSuccess: (res) => {
      // L'adresse complétée par le serveur revient ici : l'écran montre ce qui
      // est réellement enregistré, plutôt que la saisie qu'on a abandonnée.
      const enregistre = res.data.data
      setBrouillon((actuel) => ({ ...actuel, url: enregistre.url, folder: enregistre.folder }))
      setMotDePasse('')
      queryClient.invalidateQueries({ queryKey: ['nextcloud-config'] })
      queryClient.invalidateQueries({ queryKey: ['nextcloud-browse'] })
      onDossier(enregistre.folder)
      toast.success('Connexion enregistrée')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  const verification = useMutation({
    mutationFn: () =>
      nextcloudApi.test({
        url: brouillon.url || undefined,
        username: brouillon.username || undefined,
        password: motDePasse || undefined,
        folder: brouillon.folder || undefined,
      }),
    onSuccess: (res) => {
      const complete = res.data.data?.url
      if (complete) setBrouillon((actuel) => ({ ...actuel, url: complete }))
      setVerdict({ ok: true, message: res.data.message })
    },
    onError: (err: any) =>
      setVerdict({ ok: false, message: err.response?.data?.message || 'Dépôt refusé' }),
  })

  /**
   * Sonde la conversion en PDF, sur la connexion déjà enregistrée.
   *
   * Elle ne prend pas le brouillon : convertir demande de déposer un document
   * témoin, puis de le faire relire par le serveur bureautique — ce qui suppose
   * une connexion que le serveur connaît, pas une saisie en cours.
   */
  const verificationPdf = useMutation({
    mutationFn: () => nextcloudApi.testerPdf(),
    onSuccess: (res) => setVerdict({ ok: true, message: res.data.message }),
    onError: (err: any) =>
      setVerdict({ ok: false, message: err.response?.data?.message || 'Conversion refusée' }),
  })


  const incomplet = !brouillon.url.trim() || !brouillon.username.trim()

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Cloud className="w-4 h-4" /> Connexion
        </CardTitle>
        <Badge variant={config?.configured ? 'success' : 'default'}>
          {config?.configured ? 'Configuré' : 'Non configuré'}
        </Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Utilisez un <strong>mot de passe d'application</strong> Nextcloud, jamais le mot de passe
          du compte : il se révoque sans changer les identifiants de la personne. Il se crée dans
          Nextcloud, sous <em>Paramètres personnels &gt; Sécurité &gt; Appareils et sessions</em>.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Adresse"
            value={brouillon.url}
            placeholder="https://cloud.ville.fr"
            onChange={(e) => setBrouillon({ ...brouillon, url: e.target.value })}
          />
          <Input
            label="Identifiant"
            value={brouillon.username}
            placeholder="mairie"
            onChange={(e) => setBrouillon({ ...brouillon, username: e.target.value })}
          />
          <Input
            label={
              config?.configured
                ? "Mot de passe d'application (inchangé si vide)"
                : "Mot de passe d'application"
            }
            type="password"
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
          />
          <Input
            label="Dossier de travail"
            value={brouillon.folder}
            placeholder="Manifestations"
            onChange={(e) => setBrouillon({ ...brouillon, folder: e.target.value })}
          />
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          L'adresse du site suffit : la racine WebDAV{' '}
          (<code>/remote.php/dav/files/identifiant</code>) est complétée à l'enregistrement, car
          elle ne s'affiche nulle part dans Nextcloud.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            loading={enregistrement.isPending}
            disabled={incomplet}
            onClick={() => enregistrement.mutate()}
          >
            Enregistrer
          </Button>
          <Button
            variant="outline"
            loading={verification.isPending}
            disabled={incomplet}
            onClick={() => {
              setVerdict(null)
              verification.mutate()
            }}
          >
            Tester la connexion
          </Button>

          <Button
            variant="outline"
            loading={verificationPdf.isPending}
            disabled={!config?.configured}
            title="Convertit un document témoin, pour savoir si un modèle peut rendre un PDF"
            onClick={() => {
              setVerdict(null)
              verificationPdf.mutate()
            }}
          >
            Tester la conversion PDF
          </Button>
        </div>

        {verdict && (
          <Alert type={verdict.ok ? 'success' : 'error'}>
            <span className="text-sm flex items-start gap-2">
              {verdict.ok ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              )}
              {verdict.message}
            </span>
          </Alert>
        )}

        <p className="text-xs text-gray-500 dark:text-gray-400">
          Le test dépose réellement un fichier témoin dans le dossier de travail, puis le retire :
          il prouve que l'écriture fonctionne, au lieu de se contenter de valider la forme des
          champs.
        </p>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          La conversion en PDF passe par le serveur bureautique du Nextcloud — Euro-Office,
          ONLYOFFICE ou Nextcloud Office. Le test convertit un document témoin sur la connexion{' '}
          <strong>déjà enregistrée</strong> et nomme le chemin qui a répondu : sans lui, un modèle
          réglé sur PDF ne se révélerait qu'à la première demande reçue.
        </p>
      </CardBody>
    </Card>
  )
}

// ==================== EXPLORATEUR ====================

function Explorateur({
  configure,
  racine,
  chemin,
  onNaviguer,
}: {
  configure: boolean
  racine: string
  chemin: string
  onNaviguer: (chemin: string) => void
}) {
  const segments = chemin.split('/').filter(Boolean)

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['nextcloud-browse', chemin],
    queryFn: async () => (await nextcloudApi.browse(chemin)).data.data,
    enabled: configure,
    retry: false,
  })

  const telecharger = async (entree: EntreeNextcloud) => {
    try {
      // Par l'instance axios plutôt qu'un lien direct : le jeton
      // d'authentification voyage dans un en-tête, pas dans l'URL.
      const res = await api.get(nextcloudApi.downloadUrl(entree.chemin), { responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      const lien = document.createElement('a')
      lien.href = url
      lien.download = entree.nom
      lien.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Téléchargement refusé')
    }
  }

  /** Le chemin copié se recolle dans un profil d'export ou un modèle. */
  const copier = async (valeur: string) => {
    try {
      await navigator.clipboard.writeText(valeur)
      toast.success('Chemin copié')
    } catch {
      toast.error('Copie refusée par le navigateur')
    }
  }

  if (!configure) {
    return (
      <Alert type="info">
        <span className="text-sm">
          Renseignez la connexion ci-dessus pour parcourir le serveur.
        </span>
      </Alert>
    )
  }

  const entrees = data?.entrees ?? []
  const message = (error as any)?.response?.data?.message

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <FolderOpen className="w-4 h-4" /> Explorateur
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          icon={<RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />}
          onClick={() => refetch()}
        >
          Actualiser
        </Button>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            onClick={() => onNaviguer('')}
          >
            <Home className="w-4 h-4" /> Racine
          </button>
          {segments.map((segment, rang) => (
            <span key={`${rang}-${segment}`} className="inline-flex items-center">
              <ChevronRight className="w-4 h-4 text-gray-400" />
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => onNaviguer(segments.slice(0, rang + 1).join('/'))}
              >
                {segment}
              </button>
            </span>
          ))}
          {chemin && (
            <Button
              size="sm"
              variant="outline"
              icon={<ClipboardCopy className="w-4 h-4" />}
              onClick={() => copier(chemin)}
            >
              Copier le chemin
            </Button>
          )}
        </div>

        {racine && <p className="text-xs text-gray-400 dark:text-gray-500 break-all">{racine}</p>}

        {message ? (
          <Alert type="error"><span className="text-sm">{message}</span></Alert>
        ) : isFetching && entrees.length === 0 ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : entrees.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
            Ce dossier est vide.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            {entrees.map((entree) => (
              <li
                key={entree.chemin}
                className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/40"
              >
                {entree.dossier ? (
                  <Folder className="w-4 h-4 flex-shrink-0 text-amber-500" />
                ) : (
                  <IconeFichier nom={entree.nom} />
                )}

                {entree.dossier ? (
                  <button
                    type="button"
                    className="min-w-0 truncate text-sm text-left text-primary-700 hover:underline dark:text-primary-400"
                    onClick={() => onNaviguer(entree.chemin)}
                  >
                    {entree.nom}
                  </button>
                ) : (
                  <span className="min-w-0 truncate text-sm text-gray-900 dark:text-gray-100">
                    {entree.nom}
                  </span>
                )}

                <span className="ml-auto flex-shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                  {formatTaille(entree.taille)}
                </span>
                <span className="hidden sm:block flex-shrink-0 w-32 text-right text-xs text-gray-500 dark:text-gray-400">
                  {formatDate(entree.modifie)}
                </span>

                <button
                  type="button"
                  aria-label={`Copier le chemin de ${entree.nom}`}
                  title="Copier le chemin"
                  className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  onClick={() => copier(entree.chemin)}
                >
                  <ClipboardCopy className="w-4 h-4" />
                </button>

                {!entree.dossier && (
                  <button
                    type="button"
                    aria-label={`Télécharger ${entree.nom}`}
                    title="Télécharger"
                    className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    onClick={() => telecharger(entree)}
                  >
                    <Download className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {entrees.length > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {entrees.filter((e) => e.dossier).length} dossier(s),{' '}
            {entrees.filter((e) => !e.dossier).length} fichier(s)
          </p>
        )}
      </CardBody>
    </Card>
  )
}
