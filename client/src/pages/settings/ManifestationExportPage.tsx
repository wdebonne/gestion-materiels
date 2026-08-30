import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, Download, UploadCloud, Cloud, CheckCircle, XCircle,
  ArrowUp, ArrowDown, X
} from 'lucide-react'
import {
  Card, CardBody, CardHeader, CardTitle, Input, Select, Button, Alert, Badge,
  Modal, ModalBody, ModalFooter, Spinner
} from '@/components/ui'
import api, { exportManifestationApi, type ColonneProfil, type ProfilExport } from '@/lib/api'
import toast from 'react-hot-toast'

/**
 * Export des manifestations et dépôt sur Nextcloud.
 *
 * Le suivi se partage par fichier : une feuille que plusieurs services
 * consultent et annotent. Tenue à la main, elle était périmée dès qu'un statut
 * changeait — et c'est ce fichier périmé que tout le monde continuait de lire.
 *
 * Le sens est unique : l'application reste la source de vérité, le fichier
 * déposé sert à consulter et à annoter à côté. Deux personnes ne peuvent donc
 * pas contredire la base depuis le tableur.
 */

const formatDate = (valeur: string | null): string =>
  valeur ? new Date(valeur).toLocaleString('fr-FR') : 'jamais'

export default function ManifestationExportPage() {
  const queryClient = useQueryClient()
  const [profilOuvert, setProfilOuvert] = useState<ProfilExport | null>(null)
  const [creationOuverte, setCreationOuverte] = useState(false)

  const { data: profils = [], isLoading } = useQuery({
    queryKey: ['export-profiles'],
    queryFn: async () => (await exportManifestationApi.getProfiles()).data.data,
  })

  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ['export-profiles'] })
  const surErreur = (err: any) => toast.error(err.response?.data?.message || 'Erreur')

  const suppression = useMutation({
    mutationFn: (id: number) => exportManifestationApi.deleteProfile(id),
    onSuccess: () => {
      rafraichir()
      toast.success('Profil supprimé')
    },
    onError: surErreur,
  })

  const depot = useMutation({
    mutationFn: (id: number) => exportManifestationApi.run(id),
    onSuccess: (res) => {
      rafraichir()
      const data = res.data.data
      toast.success(data ? `Déposé : ${data.chemin} (${data.lignes} manifestation(s))` : 'Export produit')
    },
    onError: surErreur,
  })

  /**
   * Télécharge via l'instance axios plutôt qu'un lien direct : le jeton
   * d'authentification voyage dans un en-tête, pas dans l'URL.
   */
  const telecharger = async (profilId?: number) => {
    try {
      const res = await api.get(exportManifestationApi.downloadUrl(profilId), { responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      const lien = document.createElement('a')
      lien.href = url
      lien.download = `manifestations_${new Date().toISOString().split('T')[0]}.xlsx`
      lien.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      surErreur(err)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Choisissez vos colonnes, et déposez le suivi sur Nextcloud automatiquement.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" icon={<Download className="w-4 h-4" />} onClick={() => telecharger()}>
            Tout exporter
          </Button>
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => setCreationOuverte(true)}>
            Nouveau profil
          </Button>
        </div>
      </div>

      <ConfigurationNextcloud />

      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : profils.length === 0 ? (
        <Alert type="info">
          <span className="text-sm">
            Aucun profil. Un profil dit quelles colonnes sortent, dans quel ordre, sous quel
            intitulé, et vers où — un téléchargement ou un dossier Nextcloud.
          </span>
        </Alert>
      ) : (
        <div className="space-y-3">
          {profils.map((profil) => (
            <Card key={profil.id}>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{profil.name}</span>
                      <Badge variant={profil.destination === 'webdav' ? 'info' : 'default'}>
                        {profil.destination === 'webdav' ? 'Nextcloud' : 'Téléchargement'}
                      </Badge>
                      {profil.auto_export ? <Badge variant="success">Automatique</Badge> : null}
                      {profil.last_status === 'ok' && (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600">
                          <CheckCircle className="w-3 h-3" /> dernier dépôt réussi
                        </span>
                      )}
                      {profil.last_status === 'echec' && (
                        <span className="inline-flex items-center gap-1 text-xs text-red-600"
                          title={profil.last_error || undefined}>
                          <XCircle className="w-3 h-3" /> dernier dépôt échoué
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {profil.columns.length || 'toutes les'} colonne(s)
                      {profil.destination === 'webdav' && ` · ${profil.remote_path || 'Manifestations'}`}
                      {' · '}dernier export : {formatDate(profil.last_export_at)}
                    </p>
                    {profil.last_status === 'echec' && profil.last_error && (
                      <p className="text-xs text-red-600 mt-1">{profil.last_error}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setProfilOuvert(profil)}>
                      Colonnes
                    </Button>
                    <Button size="sm" variant="outline" icon={<Download className="w-4 h-4" />}
                      onClick={() => telecharger(profil.id)}>
                      Télécharger
                    </Button>
                    {profil.destination === 'webdav' && (
                      <Button size="sm" variant="outline" icon={<UploadCloud className="w-4 h-4" />}
                        loading={depot.isPending} onClick={() => depot.mutate(profil.id)}>
                        Déposer
                      </Button>
                    )}
                    <Button size="sm" variant="outline" aria-label={`Supprimer ${profil.name}`}
                      icon={<Trash2 className="w-4 h-4 text-red-500" />}
                      onClick={() => suppression.mutate(profil.id)} />
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {(creationOuverte || profilOuvert) && (
        <ModaleProfil
          profil={profilOuvert}
          onClose={() => {
            setCreationOuverte(false)
            setProfilOuvert(null)
            rafraichir()
          }}
        />
      )}
    </div>
  )
}

// ==================== NEXTCLOUD ====================

function ConfigurationNextcloud() {
  const queryClient = useQueryClient()
  const [motDePasse, setMotDePasse] = useState('')
  const [brouillon, setBrouillon] = useState<{ url: string; username: string; folder: string } | null>(null)

  const { data: config } = useQuery({
    queryKey: ['nextcloud-config'],
    queryFn: async () => {
      const res = (await exportManifestationApi.getNextcloud()).data.data
      setBrouillon({ url: res.url, username: res.username, folder: res.folder })
      return res
    },
  })

  const surErreur = (err: any) => toast.error(err.response?.data?.message || 'Erreur')

  const enregistrement = useMutation({
    mutationFn: () =>
      exportManifestationApi.saveNextcloud({
        url: brouillon!.url,
        username: brouillon!.username,
        password: motDePasse || undefined,
        folder: brouillon!.folder,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nextcloud-config'] })
      setMotDePasse('')
      toast.success('Configuration enregistrée')
    },
    onError: surErreur,
  })

  const verification = useMutation({
    mutationFn: () =>
      exportManifestationApi.testNextcloud({
        url: brouillon?.url,
        username: brouillon?.username,
        password: motDePasse || undefined,
        folder: brouillon?.folder,
      }),
    onSuccess: (res) => toast.success(res.data.message),
    onError: (err: any) => toast.error(err.response?.data?.message || 'Dépôt refusé'),
  })

  if (!brouillon) return null

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Cloud className="w-4 h-4" /> Nextcloud
        </CardTitle>
        {config?.configured && <Badge variant="success">Configuré</Badge>}
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Utilisez un <strong>mot de passe d'application</strong> Nextcloud, jamais le mot de passe
          du compte : il se révoque sans changer les identifiants de la personne.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Adresse WebDAV"
            value={brouillon.url}
            placeholder="https://cloud.ville.fr/remote.php/dav/files/mairie"
            onChange={(e) => setBrouillon({ ...brouillon, url: e.target.value })}
          />
          <Input
            label="Identifiant"
            value={brouillon.username}
            onChange={(e) => setBrouillon({ ...brouillon, username: e.target.value })}
          />
          <Input
            label={config?.configured ? "Mot de passe d'application (inchangé si vide)" : "Mot de passe d'application"}
            type="password"
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
          />
          <Input
            label="Dossier"
            value={brouillon.folder}
            placeholder="Manifestations"
            onChange={(e) => setBrouillon({ ...brouillon, folder: e.target.value })}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button loading={enregistrement.isPending}
            disabled={!brouillon.url || !brouillon.username}
            onClick={() => enregistrement.mutate()}>
            Enregistrer
          </Button>
          <Button variant="outline" loading={verification.isPending} onClick={() => verification.mutate()}>
            Vérifier le dépôt
          </Button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          La vérification dépose réellement un fichier témoin puis le retire : elle prouve que le
          dépôt fonctionne, au lieu de se contenter de valider la forme des champs.
        </p>
      </CardBody>
    </Card>
  )
}

// ==================== PROFIL ====================

function ModaleProfil({ profil, onClose }: { profil: ProfilExport | null; onClose: () => void }) {
  const [nom, setNom] = useState(profil?.name ?? '')
  const [destination, setDestination] = useState<'download' | 'webdav'>(profil?.destination ?? 'download')
  const [dossier, setDossier] = useState(profil?.remote_path ?? 'Manifestations')
  const [automatique, setAutomatique] = useState(Boolean(profil?.auto_export))
  const [statut, setStatut] = useState(profil?.filters?.status ?? '')
  const [archivees, setArchivees] = useState(Boolean(profil?.filters?.archived))
  const [colonnes, setColonnes] = useState<ColonneProfil[]>(profil?.columns ?? [])

  const { data: champs = [] } = useQuery({
    queryKey: ['export-fields'],
    queryFn: async () => (await exportManifestationApi.getFields()).data.data,
  })

  const enregistrement = useMutation({
    mutationFn: () => {
      const donnees = {
        name: nom.trim(),
        columns: colonnes,
        filters: { status: statut || undefined, archived: archivees },
        destination,
        remote_path: dossier,
        auto_export: automatique,
      }
      return profil
        ? exportManifestationApi.updateProfile(profil.id, donnees as any)
        : exportManifestationApi.createProfile(donnees as any)
    },
    onSuccess: () => {
      toast.success(profil ? 'Profil enregistré' : 'Profil créé')
      onClose()
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  const retenues = new Set(colonnes.map((c) => c.champ))

  const basculer = (champ: string) => {
    setColonnes(retenues.has(champ)
      ? colonnes.filter((c) => c.champ !== champ)
      : [...colonnes, { champ }])
  }

  const deplacer = (index: number, sens: -1 | 1) => {
    const cible = index + sens
    if (cible < 0 || cible >= colonnes.length) return
    const suivant = [...colonnes]
    ;[suivant[index], suivant[cible]] = [suivant[cible], suivant[index]]
    setColonnes(suivant)
  }

  const libelleDe = (champ: string) => champs.find((c) => c.champ === champ)?.libelle ?? champ

  return (
    <Modal isOpen onClose={onClose} title={profil ? `Profil — ${profil.name}` : 'Nouveau profil'} size="lg">
      <ModalBody>
        <div className="space-y-4">
          <Input label="Nom du profil" value={nom} placeholder="Suivi partagé des manifestations"
            onChange={(e) => setNom(e.target.value)} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Destination"
              value={destination}
              onChange={(e) => setDestination(e.target.value as 'download' | 'webdav')}
              options={[
                { value: 'download', label: 'Téléchargement' },
                { value: 'webdav', label: 'Dépôt sur Nextcloud' },
              ]}
            />
            {destination === 'webdav' && (
              <Input label="Dossier Nextcloud" value={dossier}
                onChange={(e) => setDossier(e.target.value)} />
            )}
          </div>

          {destination === 'webdav' && (
            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" className="mt-1" checked={automatique}
                onChange={(e) => setAutomatique(e.target.checked)} />
              <span>
                <strong>Redéposer automatiquement</strong> — après chaque changement de statut ou de
                quantités, et chaque nuit. Sans cela, le fichier partagé vieillit dès la première
                validation.
              </span>
            </label>
          )}

          <Card>
            <CardHeader><CardTitle className="text-sm">Ce que le fichier contient</CardTitle></CardHeader>
            <CardBody className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="Statut"
                  value={statut}
                  onChange={(e) => setStatut(e.target.value)}
                  options={[
                    { value: '', label: 'Tous les statuts' },
                    { value: 'pending', label: 'À confirmer' },
                    { value: 'draft', label: 'Brouillon' },
                    { value: 'validated', label: 'Validée' },
                    { value: 'delivered', label: 'Livrée' },
                    { value: 'recovered', label: 'Récupérée' },
                  ]}
                />
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mt-6">
                  <input type="checkbox" checked={archivees}
                    onChange={(e) => setArchivees(e.target.checked)} />
                  Inclure les manifestations archivées
                </label>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Colonnes</CardTitle></CardHeader>
            <CardBody className="space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Sans aucune colonne cochée, le fichier sort toutes les colonnes dans l'ordre
                de référence.
              </p>

              {colonnes.length > 0 && (
                <div className="space-y-1">
                  {colonnes.map((colonne, index) => (
                    <div key={colonne.champ}
                      className="flex flex-wrap items-center gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800">
                      <span className="text-xs text-gray-500 dark:text-gray-400 w-6">{index + 1}.</span>
                      <span className="text-sm text-gray-900 dark:text-gray-100 w-44 truncate">
                        {libelleDe(colonne.champ)}
                      </span>
                      <div className="flex-1 min-w-[10rem]">
                        <Input size="sm" value={colonne.entete ?? ''}
                          placeholder={`Intitulé (${libelleDe(colonne.champ)})`}
                          onChange={(e) => {
                            const suivant = [...colonnes]
                            suivant[index] = { ...colonne, entete: e.target.value }
                            setColonnes(suivant)
                          }} />
                      </div>
                      <button type="button" onClick={() => deplacer(index, -1)}
                        aria-label="Monter" className="p-1 hover:text-primary-600">
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => deplacer(index, 1)}
                        aria-label="Descendre" className="p-1 hover:text-primary-600">
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => basculer(colonne.champ)}
                        aria-label="Retirer" className="p-1 hover:text-red-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 pt-2 border-t dark:border-gray-700">
                {champs.filter((c) => !retenues.has(c.champ)).map((c) => (
                  <button key={c.champ} type="button" onClick={() => basculer(c.champ)}
                    className="text-left text-sm px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">
                    + {c.libelle}
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>Annuler</Button>
        <Button loading={enregistrement.isPending} disabled={!nom.trim()}
          onClick={() => enregistrement.mutate()}>
          {profil ? 'Enregistrer' : 'Créer'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
