import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Check, Cloud, Download, FileText, RefreshCw, Trash2, Upload,
} from 'lucide-react'
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Select, Spinner,
} from '@/components/ui'
import api, { modeleServiceApi, type ValeurModele } from '@/lib/api'
import toast from 'react-hot-toast'

/**
 * Modèle de document d'un service.
 *
 * Une demande reçue par formulaire concerne plusieurs services, mais chacun n'a
 * besoin que de sa part : le service qui instruit un débit de boissons n'a que
 * faire du raccordement électrique, du personnel demandé, ou du nombre de
 * chaises. Le modèle est rempli avec les seules données du service, joint à la
 * manifestation, et part avec sa demande d'approbation.
 *
 * L'écran est fait pour être tenu par un secrétariat, pas par un informaticien :
 * on dépose un `.docx` écrit dans Word, l'application y relève les champs entre
 * accolades, et il ne reste qu'à dire, dans une liste déroulante, à quoi chacun
 * correspond.
 */

/** Ce que l'écran affiche en tête, pour qu'on sache quoi écrire dans Word. */
const AIDE_SYNTAXE = [
  { code: '{manifestation}', quoi: 'une valeur simple, remplacée à l’endroit où elle est écrite' },
  { code: '{#materiels}…{/materiels}', quoi: 'une liste : le passage est répété pour chaque ligne' },
]

export default function ModeleDocumentService({
  serviceId,
  serviceName,
}: {
  serviceId: number
  serviceName: string
}) {
  const queryClient = useQueryClient()
  const champFichier = useRef<HTMLInputElement>(null)
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const [dossierNextcloud, setDossierNextcloud] = useState('/Modeles')
  const [choixNextcloud, setChoixNextcloud] = useState('')
  const [parcourirNextcloud, setParcourirNextcloud] = useState(false)

  const cle = ['modele-service', serviceId]

  const { data, isLoading } = useQuery({
    queryKey: cle,
    queryFn: async () => (await modeleServiceApi.get(serviceId)).data.data,
  })

  const modele = data?.modele ?? null
  const valeurs = data?.valeurs ?? []

  const rafraichir = () => queryClient.invalidateQueries({ queryKey: cle })
  const surErreur = (err: any) =>
    toast.error(err.response?.data?.message || 'Ce modèle n’a pas pu être enregistré')

  const rattacher = useMutation({
    mutationFn: (donnees: {
      name: string
      source: 'upload' | 'nextcloud'
      file_path?: string
      remote_path?: string
    }) => modeleServiceApi.rattacher(serviceId, donnees),
    onSuccess: (res) => {
      rafraichir()
      setParcourirNextcloud(false)
      const trouves = res.data.data.detected_fields.length
      toast.success(
        trouves === 0
          ? 'Modèle enregistré, mais aucun champ entre accolades n’y a été trouvé'
          : `Modèle enregistré — ${trouves} champ(s) détecté(s)`
      )
    },
    onError: surErreur,
  })

  const enregistrer = useMutation({
    mutationFn: (donnees: { name?: string; field_mapping?: Record<string, string> }) =>
      modeleServiceApi.enregistrer(serviceId, donnees),
    onSuccess: rafraichir,
    onError: surErreur,
  })

  const redetecter = useMutation({
    mutationFn: () => modeleServiceApi.redetecter(serviceId),
    onSuccess: (res) => {
      rafraichir()
      toast.success(`${res.data.data.detected_fields.length} champ(s) relevé(s) dans le modèle`)
    },
    onError: surErreur,
  })

  const retirer = useMutation({
    mutationFn: () => modeleServiceApi.retirer(serviceId),
    onSuccess: () => {
      rafraichir()
      toast.success('Modèle retiré')
    },
    onError: surErreur,
  })

  const { data: nextcloud, isFetching: chargementNextcloud } = useQuery({
    queryKey: ['modeles-nextcloud', dossierNextcloud],
    queryFn: async () => (await modeleServiceApi.listerNextcloud(dossierNextcloud)).data.data,
    enabled: parcourirNextcloud,
    retry: false,
  })

  /**
   * Dépôt du fichier, en deux temps comme partout ailleurs : le `.docx` est
   * envoyé d'abord, puis rattaché au service une fois son chemin connu.
   */
  const televerser = async (fichier: File) => {
    if (!/\.docx$/i.test(fichier.name)) {
      toast.error('Le modèle doit être un fichier .docx. Depuis Word : Enregistrer sous › Document Word.')
      return
    }

    setEnvoiEnCours(true)
    try {
      const corps = new FormData()
      corps.append('file', fichier)
      const reponse = await api.post('/upload/file', corps, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      await rattacher.mutateAsync({
        name: fichier.name.replace(/\.docx$/i, ''),
        source: 'upload',
        file_path: reponse.data.url,
      })
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Ce fichier n'a pas pu être envoyé")
    } finally {
      setEnvoiEnCours(false)
      if (champFichier.current) champFichier.current.value = ''
    }
  }

  const apercu = async () => {
    try {
      await modeleServiceApi.apercu(serviceId, `apercu-${serviceName}`)
      toast.success('Aperçu téléchargé')
    } catch {
      toast.error("L'aperçu n'a pas pu être produit — vérifiez le modèle")
    }
  }

  /** Relie un champ du modèle à une valeur, ou l'en délie. */
  const relier = (champ: string, valeur: string) => {
    const suivant = { ...(modele?.field_mapping ?? {}) }
    if (valeur) suivant[champ] = valeur
    else delete suivant[champ]
    enregistrer.mutate({ field_mapping: suivant })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="w-4 h-4" /> Document pré-rempli
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Ce service recevra ce document rempli avec <strong>sa seule part</strong> de la demande,
          joint à la manifestation et à son courriel d'approbation. Le service coordinateur, lui,
          reçoit l'ensemble du dossier.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : !modele ? (
          <DepotModele
            champFichier={champFichier}
            envoiEnCours={envoiEnCours || rattacher.isPending}
            onFichier={televerser}
            onNextcloud={() => setParcourirNextcloud(true)}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 p-3 rounded bg-gray-50 dark:bg-gray-800">
              {modele.source === 'nextcloud' ? (
                <Cloud className="w-4 h-4 text-blue-600 shrink-0" />
              ) : (
                <FileText className="w-4 h-4 text-gray-500 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <Input
                  value={modele.name}
                  onChange={(e) => enregistrer.mutate({ name: e.target.value })}
                  aria-label="Nom du modèle"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                  {modele.source === 'nextcloud' ? (
                    <>
                      Nextcloud : <code>{modele.remote_path}</code> — relu à chaque génération,
                      corrigez-le là-bas et le changement s'applique aussitôt.
                    </>
                  ) : (
                    'Fichier déposé dans l’application'
                  )}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="sm" variant="outline" icon={<RefreshCw className="w-4 h-4" />}
                  loading={redetecter.isPending} onClick={() => redetecter.mutate()}
                  title="Relire les champs du modèle">
                  Relire
                </Button>
                <Button size="sm" variant="outline" icon={<Download className="w-4 h-4" />}
                  onClick={apercu} title="Télécharger un aperçu rempli avec un exemple">
                  Aperçu
                </Button>
                <Button size="sm" variant="danger" icon={<Trash2 className="w-4 h-4" />}
                  loading={retirer.isPending} onClick={() => retirer.mutate()}
                  aria-label="Retirer le modèle" />
              </div>
            </div>

            {modele.last_error && (
              <Alert type="error">
                <span className="text-sm">
                  <AlertTriangle className="w-4 h-4 inline mr-1" />
                  Dernière génération en échec : {modele.last_error}
                </span>
              </Alert>
            )}

            <Correspondance
              champs={modele.detected_fields}
              correspondance={modele.field_mapping}
              valeurs={valeurs}
              onRelier={relier}
            />

            <details className="text-xs text-gray-500 dark:text-gray-400">
              <summary className="cursor-pointer select-none">Comment écrire le modèle dans Word</summary>
              <ul className="mt-2 space-y-1 pl-4">
                {AIDE_SYNTAXE.map((ligne) => (
                  <li key={ligne.code}>
                    <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">{ligne.code}</code>
                    {' — '}{ligne.quoi}
                  </li>
                ))}
                <li>
                  Un champ laissé sans correspondance ressort <strong>vide</strong> : le document
                  produit ne portera jamais d'accolades.
                </li>
              </ul>
            </details>

            <div className="pt-1">
              <DepotModele
                remplacement
                champFichier={champFichier}
                envoiEnCours={envoiEnCours || rattacher.isPending}
                onFichier={televerser}
                onNextcloud={() => setParcourirNextcloud(true)}
              />
            </div>
          </>
        )}

        {parcourirNextcloud && (
          <Card>
            <CardBody className="space-y-2">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Tenir les modèles dans Nextcloud permet de les corriger à un seul endroit : le
                fichier est relu à chaque génération.
              </p>
              <div className="flex gap-2">
                <Input
                  value={dossierNextcloud}
                  onChange={(e) => setDossierNextcloud(e.target.value)}
                  placeholder="/Modeles"
                  aria-label="Dossier Nextcloud"
                />
                <Button size="sm" variant="outline" onClick={() => setParcourirNextcloud(false)}>
                  Fermer
                </Button>
              </div>

              {chargementNextcloud ? (
                <div className="flex justify-center py-4"><Spinner /></div>
              ) : !nextcloud ? (
                <Alert type="warning">
                  <span className="text-sm">
                    Ce dossier n'a pas pu être lu. Vérifiez le lien Nextcloud dans Paramètres ›
                    Export des manifestations, et que le dossier existe.
                  </span>
                </Alert>
              ) : nextcloud.fichiers.length === 0 ? (
                <Alert type="info">
                  <span className="text-sm">
                    Aucun fichier <code>.docx</code> dans <code>{nextcloud.dossier}</code>.
                  </span>
                </Alert>
              ) : (
                <div className="flex gap-2">
                  <Select
                    value={choixNextcloud}
                    onChange={(e) => setChoixNextcloud(e.target.value)}
                    options={[
                      { value: '', label: '— Choisir un modèle —' },
                      ...nextcloud.fichiers.map((f) => ({ value: f.chemin, label: f.nom })),
                    ]}
                  />
                  <Button size="sm" disabled={!choixNextcloud} loading={rattacher.isPending}
                    icon={<Check className="w-4 h-4" />}
                    onClick={() =>
                      rattacher.mutate({
                        name: choixNextcloud.split('/').pop()?.replace(/\.docx$/i, '') || 'Modèle',
                        source: 'nextcloud',
                        remote_path: choixNextcloud,
                      })
                    }>
                    Rattacher
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        )}
      </CardBody>
    </Card>
  )
}

/** Dépôt d'un `.docx`, par fichier ou depuis Nextcloud. */
function DepotModele({
  champFichier,
  envoiEnCours,
  onFichier,
  onNextcloud,
  remplacement = false,
}: {
  champFichier: React.RefObject<HTMLInputElement>
  envoiEnCours: boolean
  onFichier: (fichier: File) => void
  onNextcloud: () => void
  remplacement?: boolean
}) {
  const [survol, setSurvol] = useState(false)

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setSurvol(true) }}
      onDragLeave={() => setSurvol(false)}
      onDrop={(e) => {
        e.preventDefault()
        setSurvol(false)
        const fichier = e.dataTransfer.files?.[0]
        if (fichier) onFichier(fichier)
      }}
      className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
        survol
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
          : 'border-gray-300 dark:border-gray-700'
      }`}
    >
      <input
        ref={champFichier}
        type="file"
        accept=".docx"
        className="hidden"
        onChange={(e) => {
          const fichier = e.target.files?.[0]
          if (fichier) onFichier(fichier)
        }}
      />
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {remplacement
          ? 'Remplacer le modèle — le réglage des champs de même nom est conservé'
          : 'Déposez ici le modèle Word (.docx), ou'}
      </p>
      <div className="flex flex-wrap justify-center gap-2 mt-2">
        <Button size="sm" variant="outline" icon={<Upload className="w-4 h-4" />}
          loading={envoiEnCours} onClick={() => champFichier.current?.click()}>
          Choisir un fichier
        </Button>
        <Button size="sm" variant="outline" icon={<Cloud className="w-4 h-4" />} onClick={onNextcloud}>
          Depuis Nextcloud
        </Button>
      </div>
    </div>
  )
}

/**
 * Correspondance des champs relevés dans le modèle.
 *
 * Un champ qui porte déjà le nom d'une valeur connue est rempli sans réglage :
 * l'écran le dit, sinon on croirait qu'il manque quelque chose.
 */
function Correspondance({
  champs,
  correspondance,
  valeurs,
  onRelier,
}: {
  champs: string[]
  correspondance: Record<string, string>
  valeurs: ValeurModele[]
  onRelier: (champ: string, valeur: string) => void
}) {
  if (champs.length === 0) {
    return (
      <Alert type="warning">
        <span className="text-sm">
          Aucun champ trouvé dans ce modèle. Dans Word, écrivez les valeurs à remplir entre
          accolades — par exemple <code>{'{manifestation}'}</code> ou <code>{'{date_debut}'}</code>.
        </span>
      </Alert>
    )
  }

  const connus = new Set(valeurs.map((v) => v.cle))
  const options = [
    { value: '', label: '— Non relié —' },
    ...valeurs.map((v) => ({ value: v.cle, label: `${v.libelle} (${v.cle})` })),
  ]

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {champs.length} champ(s) relevé(s) dans le modèle. Reliez chacun à une donnée de la demande.
      </p>
      <div className="space-y-1">
        {champs.map((champ) => {
          const reliePar = correspondance[champ]
          const automatique = !reliePar && connus.has(champ)

          return (
            <div key={champ}
              className="flex flex-wrap items-center gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800">
              <code className="text-xs px-1.5 py-0.5 rounded bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 shrink-0">
                {'{'}{champ}{'}'}
              </code>
              <div className="flex-1 min-w-[12rem]">
                <Select
                  value={reliePar ?? ''}
                  onChange={(e) => onRelier(champ, e.target.value)}
                  options={options}
                  aria-label={`Valeur pour le champ ${champ}`}
                />
              </div>
              {automatique ? (
                <Badge variant="success" title="Ce champ porte le nom d’une valeur connue : il sera rempli sans réglage">
                  Reconnu
                </Badge>
              ) : !reliePar ? (
                <Badge variant="warning" title="Ce champ ressortira vide dans le document">
                  Vide
                </Badge>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
