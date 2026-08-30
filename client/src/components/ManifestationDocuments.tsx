import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Paperclip, Upload, Camera, Search, Trash2, Download, Eye, FileText, Image as ImageIcon,
  RefreshCw, Sparkles, X
} from 'lucide-react'
import {
  Card, CardBody, Input, Select, Button, Alert, Badge, Spinner, TextArea, Modal, ModalBody
} from '@/components/ui'
import api, {
  documentManifestationApi,
  type DocumentManifestation,
  type Manifestation,
} from '@/lib/api'
import { isResizableImage, resizeImage, formatFileSize } from '@/lib/imageResize'
import toast from 'react-hot-toast'

/**
 * Pièces jointes d'une manifestation.
 *
 * Un arrêté de circulation, un plan d'implantation, la photo d'une chaise
 * revenue cassée ou d'un trottoir abîmé sur le lieu. Ce sont ces pièces qui font
 * la différence en cas de litige, des mois plus tard.
 *
 * L'écran est utilisé par du personnel non informaticien : on dépose un fichier
 * — par glisser-déposer, par le sélecteur, ou en le photographiant — puis un
 * petit formulaire demande de quoi le retrouver plus tard. Le libellé est
 * pré-rempli avec le nom du fichier : il n'y a rien d'obligatoire à saisir.
 */

const estImage = (mime: string | null): boolean => Boolean(mime?.startsWith('image/'))

const formatDate = (valeur: string): string =>
  valeur ? new Date(valeur).toLocaleDateString('fr-FR') : ''

/** Fichier téléversé, en attente de ses informations. */
interface FichierDepose {
  file_path: string
  mime_type: string
  size: number
  nomOriginal: string
}

export default function ManifestationDocuments({ manifestation }: { manifestation: Manifestation }) {
  const queryClient = useQueryClient()
  const [recherche, setRecherche] = useState('')
  const [depose, setDepose] = useState<FichierDepose | null>(null)
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const [survol, setSurvol] = useState(false)
  const [apercu, setApercu] = useState<DocumentManifestation | null>(null)

  const champFichier = useRef<HTMLInputElement>(null)
  const champPhoto = useRef<HTMLInputElement>(null)

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['manifestation-documents', manifestation.id],
    queryFn: async () => (await documentManifestationApi.lister(manifestation.id)).data.data,
  })

  const { data: types = [] } = useQuery({
    queryKey: ['manifestation-doc-types'],
    queryFn: async () => (await documentManifestationApi.getTypes()).data.data,
  })

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['manifestation-documents', manifestation.id] })
    queryClient.invalidateQueries({ queryKey: ['manifestation-history', manifestation.id] })
  }

  /**
   * Refait les documents pré-remplis des services.
   *
   * Ils sont produits d'eux-mêmes à la réception et à chaque changement de
   * matériel : ce bouton sert aux deux cas où l'automatisme ne suffit pas — un
   * modèle corrigé après coup, un Nextcloud injoignable au mauvais moment.
   */
  const regeneration = useMutation({
    mutationFn: () => documentManifestationApi.regenerer(manifestation.id),
    onSuccess: (res) => {
      rafraichir()
      const rates = res.data.data.resultats.filter((r) => !r.success)
      if (rates.length > 0) {
        // Un modèle mal enregistré doit se voir : sinon on découvre le document
        // manquant le jour où le service le réclame.
        toast.error(rates.map((r) => `${r.service_name} : ${r.error}`).join(' — '), { duration: 8000 })
      } else {
        toast.success(res.data.message)
      }
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  const retrait = useMutation({
    mutationFn: (docId: number) => documentManifestationApi.retirer(docId),
    onSuccess: () => {
      rafraichir()
      toast.success('Pièce retirée')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  /**
   * Téléverse le fichier, puis ouvre le formulaire de description.
   *
   * Les photos prises au téléphone dépassent la limite à la capture : elles sont
   * réduites avant l'envoi, comme partout ailleurs dans l'application.
   */
  const televerser = async (fichier: File) => {
    setEnvoiEnCours(true)
    try {
      const aEnvoyer = isResizableImage(fichier) ? await resizeImage(fichier) : fichier

      const corps = new FormData()
      corps.append('file', aEnvoyer)
      const reponse = await api.post('/upload/file', corps, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      setDepose({
        file_path: reponse.data.url,
        mime_type: reponse.data.mimetype,
        size: reponse.data.size,
        nomOriginal: reponse.data.originalName ?? fichier.name,
      })
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Ce fichier n'a pas pu être envoyé")
    } finally {
      setEnvoiEnCours(false)
    }
  }

  // Le filtre se fait sur ce qui est déjà chargé : la liste d'une manifestation
  // tient en mémoire, et attendre le serveur à chaque frappe serait pénible.
  const motif = recherche.trim().toLowerCase()
  const visibles = motif
    ? documents.filter((d) =>
        [d.name, d.description, d.doc_type_label, d.stock_name, d.object_name]
          .filter(Boolean)
          .some((champ) => String(champ).toLowerCase().includes(motif))
      )
    : documents

  const photos = visibles.filter((d) => estImage(d.mime_type))
  const fichiers = visibles.filter((d) => !estImage(d.mime_type))

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setSurvol(true)
            }}
            onDragLeave={() => setSurvol(false)}
            onDrop={(e) => {
              e.preventDefault()
              setSurvol(false)
              const fichier = e.dataTransfer.files?.[0]
              if (fichier) televerser(fichier)
            }}
            className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
              survol
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                : 'border-gray-300 dark:border-gray-600'
            }`}
          >
            {envoiEnCours ? (
              <div className="flex items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <Spinner /> Envoi en cours…
              </div>
            ) : (
              <>
                <Paperclip className="w-6 h-6 mx-auto text-gray-400" />
                <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                  Glissez un fichier ici, ou
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Button size="sm" variant="outline" icon={<Upload className="w-4 h-4" />}
                    onClick={() => champFichier.current?.click()}>
                    Choisir un fichier
                  </Button>
                  <Button size="sm" variant="outline" icon={<Camera className="w-4 h-4" />}
                    onClick={() => champPhoto.current?.click()}>
                    Prendre une photo
                  </Button>
                </div>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Photo, PDF, Word, Excel ou OpenDocument
                </p>
              </>
            )}

            <input ref={champFichier} type="file" className="hidden"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.odt,.ods,.txt,.csv"
              onChange={(e) => {
                const fichier = e.target.files?.[0]
                if (fichier) televerser(fichier)
                e.target.value = ''
              }} />
            <input ref={champPhoto} type="file" className="hidden" accept="image/*" capture="environment"
              onChange={(e) => {
                const fichier = e.target.files?.[0]
                if (fichier) televerser(fichier)
                e.target.value = ''
              }} />
          </div>

          {depose && (
            <FormulaireDescription
              manifestation={manifestation}
              fichier={depose}
              types={types}
              onAnnuler={() => setDepose(null)}
              onEnregistre={() => {
                setDepose(null)
                rafraichir()
              }}
            />
          )}
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {documents.length > 0 && (
          <div className="relative flex-1 min-w-[14rem]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              className="pl-9"
              value={recherche}
              placeholder="Rechercher une pièce (libellé, description, matériel)…"
              onChange={(e) => setRecherche(e.target.value)}
            />
          </div>
        )}
        <Button size="sm" variant="outline" icon={<RefreshCw className="w-4 h-4" />}
          loading={regeneration.isPending} onClick={() => regeneration.mutate()}
          title="Refaire les documents pré-remplis des services concernés">
          Refaire les documents des services
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : documents.length === 0 ? (
        <Alert type="info">
          <span className="text-sm">
            Aucune pièce jointe. Déposez ici l'arrêté de circulation, le plan d'implantation, ou
            la photo d'un matériel abîmé — ce sont ces pièces qui servent en cas de litige, des
            mois plus tard.
          </span>
        </Alert>
      ) : visibles.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
          Aucune pièce ne correspond à « {recherche} ».
        </p>
      ) : (
        <div className="space-y-4">
          {photos.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Photos ({photos.length})
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {photos.map((doc) => (
                  <button key={doc.id} type="button" onClick={() => setApercu(doc)}
                    className="group text-left rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 hover:border-primary-400 transition-colors">
                    <img src={doc.file_path} alt={doc.name}
                      className="w-full h-28 object-cover bg-gray-100 dark:bg-gray-800" />
                    <div className="p-2">
                      <p className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{doc.name}</p>
                      {doc.doc_type_label && (
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{doc.doc_type_label}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {fichiers.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Documents ({fichiers.length})
              </p>
              <div className="space-y-2">
                {fichiers.map((doc) => (
                  <LigneDocument key={doc.id} doc={doc} onApercu={() => setApercu(doc)}
                    onRetirer={() => retrait.mutate(doc.id)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {apercu && (
        <Apercu doc={apercu} onClose={() => setApercu(null)}
          onRetirer={() => {
            retrait.mutate(apercu.id)
            setApercu(null)
          }} />
      )}
    </div>
  )
}

function LigneDocument({ doc, onApercu, onRetirer }: {
  doc: DocumentManifestation
  onApercu: () => void
  onRetirer: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
      <FileText className="w-5 h-5 text-gray-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{doc.name}</p>
        <div className="flex flex-wrap items-center gap-2 mt-0.5">
          {doc.doc_type_label && <Badge variant="default">{doc.doc_type_label}</Badge>}
          {doc.generated_from_template ? (
            <Badge variant="success" title="Produit par l’application depuis le modèle du service">
              <Sparkles className="w-3 h-3 inline mr-1" />
              {doc.service_name ?? 'Document de service'}
            </Badge>
          ) : null}
          {(doc.stock_name || doc.object_name) && (
            <Badge variant="info">{doc.stock_name ?? doc.object_name}</Badge>
          )}
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {formatDate(doc.created_at)}
            {doc.size ? ` · ${formatFileSize(doc.size)}` : ''}
            {doc.uploaded_by_name ? ` · ${doc.uploaded_by_name}` : ''}
          </span>
        </div>
        {doc.description && (
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">{doc.description}</p>
        )}
      </div>
      <div className="flex gap-1 shrink-0">
        <button type="button" onClick={onApercu} aria-label={`Aperçu de ${doc.name}`}
          className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
          <Eye className="w-4 h-4 text-gray-600 dark:text-gray-300" />
        </button>
        <a href={doc.file_path} download={doc.name} aria-label={`Télécharger ${doc.name}`}
          className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
          <Download className="w-4 h-4 text-gray-600 dark:text-gray-300" />
        </a>
        <button type="button" onClick={onRetirer} aria-label={`Retirer ${doc.name}`}
          className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
          <Trash2 className="w-4 h-4 text-red-500" />
        </button>
      </div>
    </div>
  )
}

/**
 * Ce qu'on demande après le dépôt.
 *
 * Le libellé est pré-rempli avec le nom du fichier, le type et la description
 * restent facultatifs : exiger une saisie complète ferait renoncer à joindre la
 * photo, qui est justement ce qu'on veut conserver.
 */
function FormulaireDescription({ manifestation, fichier, types, onAnnuler, onEnregistre }: {
  manifestation: Manifestation
  fichier: FichierDepose
  types: Array<{ value: string; label: string }>
  onAnnuler: () => void
  onEnregistre: () => void
}) {
  const [nom, setNom] = useState(fichier.nomOriginal.replace(/\.[^.]+$/, ''))
  const [type, setType] = useState(estImage(fichier.mime_type) ? 'photo' : 'autre')
  const [description, setDescription] = useState('')
  const [lien, setLien] = useState('')

  const enregistrement = useMutation({
    mutationFn: () => {
      const [nature, identifiant] = lien ? lien.split(':') : []
      return documentManifestationApi.joindre(manifestation.id, {
        name: nom.trim(),
        doc_type: type,
        description: description.trim() || undefined,
        file_path: fichier.file_path,
        mime_type: fichier.mime_type,
        size: fichier.size,
        stock_id: nature === 'stock' ? Number(identifiant) : null,
        object_id: nature === 'objet' ? Number(identifiant) : null,
      })
    },
    onSuccess: () => {
      toast.success('Pièce jointe ajoutée')
      onEnregistre()
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  // Le lien porte sur l'article, pas sur la ligne : celle-ci est réécrite à
  // chaque modification de la manifestation.
  const cibles = [
    ...(manifestation.materials ?? []).map((m) => ({
      value: `stock:${m.stock_id}`,
      label: m.stock_name ?? `Article #${m.stock_id}`,
    })),
    ...(manifestation.objects ?? []).map((o) => ({
      value: `objet:${o.object_id}`,
      label: o.object_name,
    })),
  ]

  return (
    <div className="rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-900/10 p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        {estImage(fichier.mime_type) ? (
          <ImageIcon className="w-4 h-4 text-primary-600" />
        ) : (
          <FileText className="w-4 h-4 text-primary-600" />
        )}
        <span className="truncate">{fichier.nomOriginal}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{formatFileSize(fichier.size)}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="Libellé" value={nom} onChange={(e) => setNom(e.target.value)} />
        <Select
          label="Type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={types.map((t) => ({ value: t.value, label: t.label }))}
        />
      </div>

      <TextArea
        label="Description (facultative)"
        rows={2}
        value={description}
        placeholder="Ce qui aidera à retrouver cette pièce plus tard : « 1 chaise cassée au retour », « arrêté buvette place du marché »…"
        onChange={(e) => setDescription(e.target.value)}
      />

      {cibles.length > 0 && (
        <Select
          label="Concerne un matériel (facultatif)"
          value={lien}
          onChange={(e) => setLien(e.target.value)}
          options={[{ value: '', label: '— Aucun matériel en particulier —' }, ...cibles]}
        />
      )}

      <div className="flex gap-2">
        <Button size="sm" loading={enregistrement.isPending} disabled={!nom.trim()}
          onClick={() => enregistrement.mutate()}>
          Joindre
        </Button>
        <Button size="sm" variant="ghost" onClick={onAnnuler}>Annuler</Button>
      </div>
    </div>
  )
}

function Apercu({ doc, onClose, onRetirer }: {
  doc: DocumentManifestation
  onClose: () => void
  onRetirer: () => void
}) {
  return (
    <Modal isOpen onClose={onClose} title={doc.name} size="xl">
      <ModalBody>
        <div className="space-y-3">
          {estImage(doc.mime_type) ? (
            <img src={doc.file_path} alt={doc.name}
              className="max-h-[60vh] w-full object-contain rounded bg-gray-100 dark:bg-gray-800" />
          ) : doc.mime_type === 'application/pdf' ? (
            <iframe src={doc.file_path} title={doc.name} className="w-full h-[60vh] rounded border-0" />
          ) : (
            <div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
              Ce format ne s'affiche pas ici. Téléchargez-le pour l'ouvrir.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {doc.doc_type_label && <Badge variant="default">{doc.doc_type_label}</Badge>}
            {(doc.stock_name || doc.object_name) && (
              <Badge variant="info">{doc.stock_name ?? doc.object_name}</Badge>
            )}
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {formatDate(doc.created_at)}
              {doc.uploaded_by_name ? ` · ${doc.uploaded_by_name}` : ''}
            </span>
          </div>

          {doc.description && (
            <p className="text-sm text-gray-700 dark:text-gray-300">{doc.description}</p>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t dark:border-gray-700">
            <a href={doc.file_path} download={doc.name}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">
              <Download className="w-4 h-4" /> Télécharger
            </a>
            <Button size="sm" variant="outline" icon={<Trash2 className="w-4 h-4 text-red-500" />}
              onClick={onRetirer}>
              Retirer
            </Button>
            <Button size="sm" variant="ghost" icon={<X className="w-4 h-4" />} onClick={onClose}>
              Fermer
            </Button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  )
}
