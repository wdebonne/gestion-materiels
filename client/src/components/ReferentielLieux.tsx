import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, DoorOpen, Plus, Pencil, Trash2, ChevronRight } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import {
  Button,
  Card,
  Input,
  LoadingInline,
  Modal,
  ModalBody,
  ModalFooter,
  TextArea,
  useConfirm,
} from '@/components/ui'
import Can from '@/components/Can'

/**
 * Référentiel des lieux : un site, et ses ouvrants.
 *
 * Deux niveaux et pas davantage, comme `categories` / `subcategories` : une
 * commune a des bâtiments et, dans chaque bâtiment, des portes. Une arborescence
 * libre laisserait chacun inventer sa profondeur, et la même porte finirait
 * saisie à deux endroits.
 *
 * La suppression d'un site ou d'une porte encore ouverte par une clé est refusée
 * par le serveur plutôt que cascadée : effacer ce qu'une clé ouvre la réduirait
 * à un bout de métal sans usage connu — précisément la donnée qu'on tient ici.
 */

interface Ouvrant {
  id: number
  site_id: number
  name: string
  code: string | null
  description: string | null
}

interface Site {
  id: number
  name: string
  code: string | null
  address: string | null
  ouvrants: Ouvrant[]
}

export default function ReferentielLieux() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()

  const [siteOuvert, setSiteOuvert] = useState<number | null>(null)
  const [formSite, setFormSite] = useState<{ id?: number; name: string; code: string; address: string } | null>(null)
  const [formOuvrant, setFormOuvrant] = useState<{
    id?: number
    siteId: number
    name: string
    code: string
    description: string
  } | null>(null)

  const { data: sites = [], isLoading } = useQuery<Site[]>({
    queryKey: ['cles-referentiel'],
    queryFn: async () => (await api.get('/cles/referentiel')).data.data,
  })

  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ['cles-referentiel'] })

  const enregistrerSite = useMutation({
    mutationFn: async (valeurs: { id?: number; name: string; code: string; address: string }) => {
      const corps = { name: valeurs.name, code: valeurs.code, address: valeurs.address }
      if (valeurs.id) return api.put(`/cles/sites/${valeurs.id}`, corps)
      return api.post('/cles/sites', corps)
    },
    onSuccess: () => {
      setFormSite(null)
      rafraichir()
    },
    meta: { successMessage: 'Site enregistré' },
  })

  const enregistrerOuvrant = useMutation({
    mutationFn: async (valeurs: {
      id?: number
      siteId: number
      name: string
      code: string
      description: string
    }) => {
      const corps = {
        siteId: valeurs.siteId,
        name: valeurs.name,
        code: valeurs.code,
        description: valeurs.description,
      }
      if (valeurs.id) return api.put(`/cles/ouvrants/${valeurs.id}`, corps)
      return api.post('/cles/ouvrants', corps)
    },
    onSuccess: () => {
      setFormOuvrant(null)
      rafraichir()
    },
    meta: { successMessage: 'Ouvrant enregistré' },
  })

  /**
   * Le refus du serveur porte le nombre de clés concernées : il est remonté tel
   * quel plutôt que remplacé par un message générique, parce que « 3 clés
   * ouvrent encore ce site » dit quoi faire, là où « suppression impossible »
   * laisse chercher.
   */
  const supprimer = async (genre: 'sites' | 'ouvrants', id: number, nom: string) => {
    const ok = await confirm({
      title: `Supprimer ${nom} ?`,
      message:
        genre === 'sites'
          ? 'Les portes de ce site seront supprimées avec lui.'
          : 'Cette porte sera retirée du référentiel.',
      confirmLabel: 'Supprimer',
      variant: 'danger',
    })
    if (!ok) return

    try {
      await api.delete(`/cles/${genre}/${id}`)
      toast.success('Supprimé')
      rafraichir()
    } catch (erreur: any) {
      toast.error(erreur?.response?.data?.message ?? 'Suppression impossible')
    }
  }

  if (isLoading) return <LoadingInline />

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Can manage>
          <Button onClick={() => setFormSite({ name: '', code: '', address: '' })}>
            <Plus className="mr-2 h-4 w-4" />
            Nouveau site
          </Button>
        </Can>
      </div>

      {sites.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-gray-700 dark:text-gray-200">Aucun site enregistré.</p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Commencez par créer un site — la mairie, une école, un local technique — puis ajoutez-y
            les portes que vos clés ouvrent.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {sites.map((site) => (
            <Card key={site.id} className="overflow-hidden">
              <div className="flex items-center gap-3 p-4">
                <button
                  onClick={() => setSiteOuvert(siteOuvert === site.id ? null : site.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <ChevronRight
                    className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${
                      siteOuvert === site.id ? 'rotate-90' : ''
                    }`}
                  />
                  <Building2 className="h-5 w-5 flex-shrink-0 text-primary-600" />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-gray-900 dark:text-gray-100">
                      {site.name}
                      {site.code && (
                        <span className="ml-2 font-mono text-xs text-gray-500">{site.code}</span>
                      )}
                    </div>
                    <div className="truncate text-sm text-gray-600 dark:text-gray-300">
                      {site.ouvrants.length} ouvrant{site.ouvrants.length > 1 ? 's' : ''}
                      {site.address ? ` · ${site.address}` : ''}
                    </div>
                  </div>
                </button>

                <Can manage>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      onClick={() =>
                        setFormSite({
                          id: site.id,
                          name: site.name,
                          code: site.code ?? '',
                          address: site.address ?? '',
                        })
                      }
                      className="touch-target rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                      title="Modifier le site"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => supprimer('sites', site.id, site.name)}
                      className="touch-target rounded p-2 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                      title="Supprimer le site"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </Can>
              </div>

              {siteOuvert === site.id && (
                <div className="border-t border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
                  <div className="space-y-2">
                    {site.ouvrants.map((ouvrant) => (
                      <div
                        key={ouvrant.id}
                        className="flex items-center gap-3 rounded-lg bg-white p-3 dark:bg-gray-800"
                      >
                        <DoorOpen className="h-4 w-4 flex-shrink-0 text-gray-500" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                            {ouvrant.name}
                            {ouvrant.code && (
                              <span className="ml-2 font-mono text-xs text-gray-500">
                                {ouvrant.code}
                              </span>
                            )}
                          </div>
                          {ouvrant.description && (
                            <div className="truncate text-xs text-gray-600 dark:text-gray-300">
                              {ouvrant.description}
                            </div>
                          )}
                        </div>
                        <Can manage>
                          <div className="flex flex-shrink-0 items-center gap-1">
                            <button
                              onClick={() =>
                                setFormOuvrant({
                                  id: ouvrant.id,
                                  siteId: site.id,
                                  name: ouvrant.name,
                                  code: ouvrant.code ?? '',
                                  description: ouvrant.description ?? '',
                                })
                              }
                              className="touch-target rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                              title="Modifier"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => supprimer('ouvrants', ouvrant.id, ouvrant.name)}
                              className="touch-target rounded p-2 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                              title="Supprimer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </Can>
                      </div>
                    ))}

                    <Can manage>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setFormOuvrant({ siteId: site.id, name: '', code: '', description: '' })
                        }
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Ajouter une porte
                      </Button>
                    </Can>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {formSite && (
        <Modal isOpen onClose={() => setFormSite(null)} title={formSite.id ? 'Modifier le site' : 'Nouveau site'}>
          <ModalBody>
            <div className="space-y-4">
              <Input
                label="Nom"
                value={formSite.name}
                onChange={(e) => setFormSite({ ...formSite, name: e.target.value })}
                placeholder="Mairie, École Jules Ferry…"
              />
              <Input
                label="Code"
                value={formSite.code}
                onChange={(e) => setFormSite({ ...formSite, code: e.target.value })}
                placeholder="MAI, EJF…"
                hint="Facultatif. Utile pour composer les numéros d'inventaire."
              />
              <Input
                label="Adresse"
                value={formSite.address}
                onChange={(e) => setFormSite({ ...formSite, address: e.target.value })}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" onClick={() => setFormSite(null)}>
              Annuler
            </Button>
            <Button
              onClick={() => enregistrerSite.mutate(formSite)}
              disabled={!formSite.name.trim() || enregistrerSite.isPending}
            >
              Enregistrer
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {formOuvrant && (
        <Modal
          isOpen
          onClose={() => setFormOuvrant(null)}
          title={formOuvrant.id ? 'Modifier la porte' : 'Nouvelle porte'}
        >
          <ModalBody>
            <div className="space-y-4">
              <Input
                label="Nom"
                value={formOuvrant.name}
                onChange={(e) => setFormOuvrant({ ...formOuvrant, name: e.target.value })}
                placeholder="Porte principale, Salle du conseil…"
              />
              <Input
                label="Code"
                value={formOuvrant.code}
                onChange={(e) => setFormOuvrant({ ...formOuvrant, code: e.target.value })}
                hint="Facultatif. Le repère gravé sur le cylindre, par exemple."
              />
              <TextArea
                label="Description"
                value={formOuvrant.description}
                onChange={(e) => setFormOuvrant({ ...formOuvrant, description: e.target.value })}
                rows={3}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" onClick={() => setFormOuvrant(null)}>
              Annuler
            </Button>
            <Button
              onClick={() => enregistrerOuvrant.mutate(formOuvrant)}
              disabled={!formOuvrant.name.trim() || enregistrerOuvrant.isPending}
            >
              Enregistrer
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
