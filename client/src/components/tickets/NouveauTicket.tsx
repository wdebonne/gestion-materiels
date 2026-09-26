import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AlertTriangle, Building2, Send, Wrench, Info } from 'lucide-react'
import {
  ticketApi,
  type CategorieDemande,
} from '@/lib/api'
import { Button, Input, Modal, ModalBody, ModalFooter, Select, TextArea } from '@/components/ui'
import FileUpload, { type UploadedFile } from '@/components/ui/FileUpload'

/**
 * Ouvrir une demande.
 *
 * Le formulaire est **adaptatif**, et c'est tout son intérêt : ce qui ne se
 * demande pas est ce qui rend le geste court.
 *
 *   — le bâtiment est **masqué** quand la personne n'en a qu'un, et pré-rempli ;
 *   — les catégories sont celles qu'on lui a attribuées, ou toutes ;
 *   — le matériel n'apparaît que si la catégorie l'autorise, et se limite au
 *     parc qu'elle propose ;
 *   — le statut, le service et le technicien ne sont **jamais** demandés : ils
 *     se déduisent de la catégorie.
 *
 * Ce dernier point mérite une précision d'écran : la personne qui écrit ne sait
 * pas où part sa demande, et n'aime pas envoyer dans le vide. On le lui dit donc
 * en clair — « cette demande partira au service Technique (Tom Tech) » — dès que
 * la catégorie est choisie.
 */

export default function NouveauTicket({
  onFerme,
  siteInitial,
  objectIdInitial,
}: {
  onFerme: () => void
  siteInitial?: number | null
  objectIdInitial?: number | null
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [titre, setTitre] = useState('')
  const [description, setDescription] = useState('')
  const [categorieId, setCategorieId] = useState<number | null>(null)
  const [sousCategorieId, setSousCategorieId] = useState<number | null>(null)
  const [siteId, setSiteId] = useState<number | null>(siteInitial ?? null)
  const [objectId, setObjectId] = useState<number | null>(objectIdInitial ?? null)
  const [priorite, setPriorite] = useState('normale')
  const [pieces, setPieces] = useState<UploadedFile[]>([])

  const { data: formulaire, isLoading } = useQuery({
    queryKey: ['tickets', 'formulaire'],
    queryFn: async () => (await ticketApi.formulaire()).data,
  })

  // Un seul bâtiment : on ne pose pas la question, on retient la réponse.
  // Plusieurs : on part de celui où la personne a son bureau.
  useEffect(() => {
    const depart = formulaire?.siteImpose ?? formulaire?.siteParDefaut ?? null
    if (depart && siteId === null) setSiteId(depart)
  }, [formulaire?.siteImpose, formulaire?.siteParDefaut, siteId])

  const { data: routage } = useQuery({
    queryKey: ['tickets', 'routage', categorieId, sousCategorieId],
    queryFn: async () => (await ticketApi.routage(categorieId, sousCategorieId)).data,
    enabled: categorieId !== null,
  })

  const materielMode = routage?.routage.materielMode ?? 'aucun'
  const siteMode = routage?.routage.siteMode ?? 'auto'

  const { data: materiels } = useQuery({
    queryKey: ['tickets', 'materiels', categorieId, sousCategorieId],
    queryFn: async () => (await ticketApi.materielsProposes(categorieId, sousCategorieId)).data,
    enabled: categorieId !== null && materielMode !== 'aucun',
  })

  const racines = useMemo(
    () => (formulaire?.categories ?? []).filter((c: CategorieDemande) => c.parentId === null),
    [formulaire?.categories]
  )
  const sousCategories = useMemo(
    () => (formulaire?.categories ?? []).filter((c: CategorieDemande) => c.parentId === categorieId),
    [formulaire?.categories, categorieId]
  )

  /**
   * Le champ bâtiment est-il posé ?
   *
   * `masque` : la catégorie n'a pas de lieu (« compte informatique »).
   * `requis` : le lieu est la question même (« voirie »), on le demande même
   *            quand la personne n'a qu'un bâtiment — elle peut signaler
   *            ailleurs que chez elle.
   * `auto`   : la règle de la personne, c'est-à-dire un seul bâtiment = masqué.
   */
  const afficherSite =
    siteMode === 'requis' || (siteMode !== 'masque' && (formulaire?.sites.length ?? 0) > 1)

  const creation = useMutation({
    mutationFn: async () => {
      const { data } = await ticketApi.creer({
        titre,
        description: description || null,
        categorieId,
        sousCategorieId,
        // Non demandé : le serveur pose le bâtiment par défaut de la personne.
        siteId: siteMode === 'masque' ? null : siteId,
        // Un matériel pré-rempli — on vient de la fiche du Nemo — est conservé
        // même si la catégorie choisie ne demande pas de matériel. L'effacer
        // ferait perdre silencieusement le rattachement au moment précis où il
        // est le plus évident, et la demande n'apparaîtrait jamais dans
        // l'historique du matériel.
        objectId: objectIdInitial ?? (materielMode === 'aucun' ? null : objectId),
        priorite,
      })

      // Les pièces sont déposées après la création : elles ont besoin de
      // l'identifiant de la demande, et la route qui les accepte est gardée
      // par la portée de celle-ci.
      for (const piece of pieces) {
        if (!piece.file) continue
        await ticketApi.joindre(data.id, piece.file)
      }
      return data
    },
    onSuccess: (data) => {
      toast.success(`Demande ${data.reference ?? ''} ouverte`)
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      onFerme()
      navigate(`/tickets/${data.id}`)
    },
    onError: (erreur: any) => {
      toast.error(erreur?.response?.data?.message ?? "La demande n'a pas pu être ouverte")
    },
  })

  const valide =
    titre.trim().length > 0 &&
    (materielMode !== 'requis' || objectId !== null || objectIdInitial != null) &&
    (siteMode !== 'requis' || siteId !== null)

  return (
    <Modal isOpen onClose={onFerme} title="Nouvelle demande" size="lg">
      <ModalBody className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-gray-500">Chargement…</p>
        ) : formulaire?.sansRattachement ? (
          /*
            Rien ne lui a été attribué.

            Afficher des listes vides la laisserait chercher ce qui ne s'y
            trouve pas, et conclure que l'application est cassée. On dit ce qui
            manque et vers qui se tourner — c'est la contrepartie d'avoir fermé
            l'accès par défaut.
          */
          <div className="flex items-start gap-3 rounded-lg bg-amber-50 p-4 dark:bg-amber-900/20">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div className="text-sm text-gray-700 dark:text-gray-300">
              <p className="font-medium">Aucune catégorie ne vous est encore attribuée</p>
              <p className="mt-1">
                Vous ne pouvez donc pas encore ouvrir de demande. Demandez à votre administrateur
                de vous rattacher aux catégories qui vous concernent, dans{' '}
                <span className="whitespace-nowrap">Paramètres › Tickets › Qui a droit à quoi</span>.
              </p>
            </div>
          </div>
        ) : (
          <>
            <Input
              label="Que se passe-t-il ?"
              value={titre}
              onChange={(e: any) => setTitre(e.target.value)}
              placeholder="Le rideau de la salle du conseil est cassé"
              required
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="Catégorie"
                value={categorieId ?? ''}
                onChange={(e: any) => {
                  setCategorieId(e.target.value ? Number(e.target.value) : null)
                  setSousCategorieId(null)
                  setObjectId(null)
                }}
                options={[
                  { value: '', label: 'Choisir…' },
                  ...racines.map((c) => ({ value: String(c.id), label: c.nom })),
                ]}
              />

              {sousCategories.length > 0 && (
                <Select
                  label="Précision"
                  value={sousCategorieId ?? ''}
                  onChange={(e: any) => {
                    setSousCategorieId(e.target.value ? Number(e.target.value) : null)
                    setObjectId(null)
                  }}
                  options={[
                    { value: '', label: 'Sans précision' },
                    ...sousCategories.map((c) => ({ value: String(c.id), label: c.nom })),
                  ]}
                />
              )}
            </div>

            {/* Personne n'aime envoyer une demande dans le vide. */}
            {routage?.destinataire && (routage.destinataire.service || routage.destinataire.technicien) && (
              <p className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <Info className="w-4 h-4 mt-0.5 shrink-0 text-primary-600" />
                <span>
                  Cette demande partira
                  {routage.destinataire.service ? ` au service ${routage.destinataire.service.nom}` : ''}
                  {routage.destinataire.technicien ? ` (${routage.destinataire.technicien.nom})` : ''}.
                  {routage.routage.visibilite === 'site' && siteId
                    ? ' Elle sera visible de vos collègues du bâtiment, pour éviter les doublons.'
                    : ''}
                </span>
              </p>
            )}

            {afficherSite && (
              <Select
                label="Bâtiment"
                value={siteId ?? ''}
                onChange={(e: any) => setSiteId(e.target.value ? Number(e.target.value) : null)}
                options={[
                  { value: '', label: 'Choisir…' },
                  ...(formulaire?.sites ?? []).map((s) => ({ value: String(s.id), label: s.nom })),
                ]}
              />
            )}

            {/* Non demandé par la catégorie : on rappelle le bâtiment qu'elle portera. */}
            {siteMode === 'masque' && formulaire?.siteParDefaut && (
              <p className="flex items-center gap-2 text-sm text-gray-500">
                <Building2 className="w-4 h-4" />
                {(formulaire?.sites ?? []).find((s) => s.id === formulaire.siteParDefaut)?.nom}
              </p>
            )}

            {/* Un seul bâtiment : on ne demande rien, on le rappelle simplement. */}
            {!afficherSite && siteMode !== 'masque' && siteId && (
              <p className="flex items-center gap-2 text-sm text-gray-500">
                <Building2 className="w-4 h-4" />
                {(formulaire?.sites ?? []).find((s) => s.id === siteId)?.nom}
              </p>
            )}

            {/* Le matériel vient de sa fiche : on le rappelle, on ne le redemande pas. */}
            {objectIdInitial && (
              <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <Wrench className="w-4 h-4 shrink-0 text-primary-600" />
                Cette demande sera rattachée au matériel depuis lequel vous l'ouvrez.
              </p>
            )}

            {!objectIdInitial && materielMode !== 'aucun' && (
              <Select
                label={materielMode === 'requis' ? 'Votre matériel' : 'Votre matériel (facultatif)'}
                hint="Le matériel qui vous est attribué. S'il en manque un, signalez-le à votre administrateur."
                value={objectId ?? ''}
                onChange={(e: any) => setObjectId(e.target.value ? Number(e.target.value) : null)}
                options={[
                  { value: '', label: materielMode === 'requis' ? 'Choisir…' : 'Aucun en particulier' },
                  ...(materiels?.materiels ?? []).map((m) => ({
                    value: String(m.id),
                    label: m.reference ? `${m.name} (${m.reference})` : m.name,
                  })),
                ]}
                icon={<Wrench className="w-4 h-4" />}
              />
            )}

            <TextArea
              label="Détails"
              value={description}
              onChange={(e: any) => setDescription(e.target.value)}
              rows={5}
              placeholder="Depuis quand ? Dans quelles conditions ? Ce qui a déjà été tenté…"
            />

            <Select
              label="Priorité"
              value={priorite}
              onChange={(e: any) => setPriorite(e.target.value)}
              options={[
                { value: 'basse', label: 'Basse' },
                { value: 'normale', label: 'Normale' },
                { value: 'haute', label: 'Haute' },
                { value: 'urgente', label: 'Urgente' },
              ]}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Photos et documents
              </label>
              {/*
                `FileUpload` porte déjà le glisser-déposer, « Prendre une
                photo » et la réduction côté client : rien à réécrire.

                Le dépôt est **différé** : la demande n'existe pas encore, donc
                il n'y a pas d'identifiant auquel rattacher la pièce. On garde
                le fichier et son aperçu local, et on le dépose après la
                création — sur `/tickets/:id/documents`, seule route que le
                demandeur a le droit d'employer.
              */}
              <FileUpload
                value={pieces}
                onChange={setPieces}
                maxFiles={5}
                maxSize={25}
                accept="image/*,.pdf,.doc,.docx,.odt"
                televerser={async (fichier) => ({
                  url: URL.createObjectURL(fichier),
                  filename: fichier.name,
                  originalName: fichier.name,
                  mimetype: fichier.type,
                  size: fichier.size,
                  file: fichier,
                })}
              />
            </div>
          </>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" onClick={onFerme}>
          Annuler
        </Button>
        <Button
          icon={<Send className="w-4 h-4" />}
          disabled={!valide || creation.isPending || Boolean(formulaire?.sansRattachement)}
          onClick={() => creation.mutate()}
        >
          {creation.isPending ? 'Envoi…' : 'Envoyer la demande'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
