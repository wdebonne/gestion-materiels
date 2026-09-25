import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Button, Modal, ModalBody, ModalFooter, ReferenceSelect, Select, TextArea } from '@/components/ui'
import api, { CategorieTemps, TachePlanning, planningApi } from '@/lib/api'
import { jourCourant } from '@/lib/duree'
import {
  ChampsQuand,
  RenfortsEditor,
  TotalTemps,
  dureeEntre,
  participantsDepuis,
  renfortsComplets,
  renfortsDepuis,
  type RenfortSaisi,
} from '@/components/temps/SaisieDuree'

/**
 * Déclarer du temps passé.
 *
 * C'est l'écran qui décide de l'adoption : un agent de terrain le remplit
 * debout, sur un téléphone, à la fin d'une journée où il a autre chose à faire.
 * Tout y est donc pré-rempli sur le cas courant — aujourd'hui, la durée
 * entière pour un collègue qui a aidé — et la durée calculée reste affichée en
 * permanence, pour qu'on la voie avant d'enregistrer plutôt qu'après.
 *
 * Les deux endroits où une saisie se trompe sans bruit sont signalés en clair :
 * une fin antérieure au début annonce « se termine le lendemain », et le total
 * mobilisé se distingue du temps personnel dès qu'un renfort est ajouté.
 *
 * Le quand, les renforts et le total viennent de `temps/SaisieDuree` : la
 * clôture d'une demande les emploie aussi.
 */

interface SaisirTempsProps {
  ouvert: boolean
  onClose: () => void
  /** Renseignée, le formulaire corrige au lieu de créer. */
  tache?: TachePlanning | null
  /** Jour pré-sélectionné, quand on arrive depuis une case du planning. */
  jourInitial?: string
  /** Personne pour qui l'on saisit, si ce n'est pas soi. */
  titulaireId?: number
  /** Les personnes pour qui l'on a le droit de saisir. Une seule = pas de choix. */
  titulairesPossibles?: { id: number; nom: string }[]
}

export default function SaisirTemps({
  ouvert,
  onClose,
  tache = null,
  jourInitial,
  titulaireId,
  titulairesPossibles = [],
}: SaisirTempsProps) {
  const queryClient = useQueryClient()
  const enCorrection = Boolean(tache)

  const [jour, setJour] = useState(jourCourant())
  const [heureDebut, setHeureDebut] = useState('')
  const [heureFin, setHeureFin] = useState('')
  const [categorie, setCategorie] = useState('')
  const [description, setDescription] = useState('')
  const [manifestationId, setManifestationId] = useState('')
  const [ticketId, setTicketId] = useState('')
  const [pour, setPour] = useState<number | undefined>(titulaireId)
  const [renforts, setRenforts] = useState<RenfortSaisi[]>([])
  const [erreur, setErreur] = useState('')

  const { data: categories = [], refetch: rechargerCategories } = useQuery({
    queryKey: ['plannings', 'categories'],
    queryFn: async () => (await planningApi.categories()).data.data,
    enabled: ouvert,
  })

  const { data: annuaire = [] } = useQuery({
    queryKey: ['annuaire'],
    queryFn: async () => (await api.get('/users/annuaire')).data.users ?? [],
    enabled: ouvert,
  })

  /*
   * Les demandes encore ouvertes, et celles-là seulement.
   *
   * Dérouler tout l'historique donnerait une liste de plusieurs centaines de
   * lignes dans laquelle personne ne retrouverait la demande sur laquelle il
   * vient de passer deux heures. Une demande close ne reçoit plus d'heures ;
   * si elle en reçoit, c'est qu'elle a été rouverte, et elle réapparaît.
   */
  const { data: demandes = [] } = useQuery({
    queryKey: ['plannings', 'demandes-ouvertes'],
    queryFn: async () =>
      (await api.get('/tickets?ouverts=true&limite=200')).data.tickets ?? [],
  })

  const { data: manifestations = [] } = useQuery({
    queryKey: ['plannings', 'manifestations-liees'],
    queryFn: async () => (await api.get('/manifestations')).data.data ?? [],
    enabled: ouvert,
  })

  // Remise à l'état voulu à chaque ouverture : un formulaire qui garde la
  // saisie précédente fait enregistrer deux fois la même tâche.
  useEffect(() => {
    if (!ouvert) return
    setErreur('')
    if (tache) {
      setJour(tache.jour)
      setHeureDebut(tache.heureDebut ?? '')
      setHeureFin(tache.heureFin ?? '')
      setCategorie(tache.categorie?.nom ?? '')
      setDescription(tache.description ?? '')
      setManifestationId(tache.manifestation ? String(tache.manifestation.id) : '')
      setTicketId(tache.ticket ? String(tache.ticket.id) : '')
      setPour(tache.titulaire.id)
      setRenforts(renfortsDepuis(tache.participants))
    } else {
      setJour(jourInitial ?? jourCourant())
      setHeureDebut('')
      setHeureFin('')
      setCategorie('')
      setDescription('')
      setManifestationId('')
      // Sans quoi la demande de la saisie précédente restait rattachée à la
      // nouvelle, sans que rien à l'écran ne le laisse deviner.
      setTicketId('')
      setPour(titulaireId)
      setRenforts([])
    }
  }, [ouvert, tache, jourInitial, titulaireId])

  const minutes = useMemo(() => dureeEntre(heureDebut, heureFin), [heureDebut, heureFin])

  const optionsAnnuaire = useMemo(
    () =>
      annuaire
        .filter((u: any) => u.id !== pour)
        .map((u: any) => ({
          value: u.id,
          label: [u.firstName, u.lastName].filter(Boolean).join(' ') || `Personne n° ${u.id}`,
        })),
    [annuaire, pour]
  )

  const enregistrer = useMutation({
    mutationFn: async () => {
      const choisie = categories.find((c) => c.nom === categorie)
      const corps = {
        userId: pour,
        jour,
        heureDebut: heureDebut || null,
        heureFin: heureFin || null,
        categorieId: choisie?.id ?? null,
        manifestationId: manifestationId ? Number(manifestationId) : null,
        ticketId: ticketId ? Number(ticketId) : null,
        description: description.trim() || null,
        participants: participantsDepuis(renforts, minutes),
      }
      return tache
        ? planningApi.modifierTache(tache.id, corps)
        : planningApi.creerTache(corps)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plannings'] })
      toast.success(enCorrection ? 'Saisie corrigée' : 'Temps enregistré')
      onClose()
    },
    onError: (e: any) => {
      // Le serveur explique en français pourquoi il refuse : le recopier vaut
      // mieux que « Erreur », qui n'apprend rien à qui doit corriger.
      setErreur(e?.response?.data?.message ?? "L'enregistrement n'a pas abouti.")
    },
  })

  const valide = Boolean(jour && heureDebut && heureFin && minutes != null && renfortsComplets(renforts))

  return (
    <Modal
      isOpen={ouvert}
      onClose={onClose}
      title={enCorrection ? 'Corriger la saisie' : 'Saisir du temps'}
      size="lg"
    >
      <ModalBody>
        <div className="space-y-5">
          {erreur && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {erreur}
            </p>
          )}

          {titulairesPossibles.length > 1 && (
            <Select
              label="Pour qui"
              value={pour ?? ''}
              onChange={(e) => setPour(Number(e.target.value))}
              options={titulairesPossibles.map((p) => ({ value: p.id, label: p.nom }))}
            />
          )}

          {/* ---------------------------------------------------- quand */}

          <ChampsQuand
            jour={jour}
            heureDebut={heureDebut}
            heureFin={heureFin}
            onJour={setJour}
            onHeureDebut={setHeureDebut}
            onHeureFin={setHeureFin}
          />

          {/* ------------------------------------------------- quoi */}

          <ReferenceSelect
            label="Catégorie"
            value={categorie}
            onChange={setCategorie}
            options={categories.map((c: CategorieTemps) => ({ id: c.id, name: c.nom }))}
            nomSingulier="une catégorie"
            placeholder="Choisir ou créer…"
            droitCreation="fieldWrite"
            onCreate={async (nom) => {
              await planningApi.creerCategorie(nom)
              // On attend la relecture : sans elle, le formulaire ne
              // retrouverait pas l'identifiant de la catégorie qu'il vient de
              // créer, et l'enregistrerait « sans catégorie ».
              await rechargerCategories()
              queryClient.invalidateQueries({ queryKey: ['plannings', 'categories'] })
            }}
          />

          <TextArea
            label="Ce qui a été fait"
            hint="Facultatif"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          {manifestations.length > 0 && (
            <Select
              label="Manifestation concernée"
              hint="Facultatif — permet de savoir ce qu'une manifestation a coûté en heures"
              value={manifestationId}
              placeholder="Aucune"
              onChange={(e) => setManifestationId(e.target.value)}
              options={manifestations.map((m: any) => ({ value: m.id, label: m.title }))}
            />
          )}

          {demandes.length > 0 && (
            <Select
              label="Demande concernée"
              hint="Facultatif — rattache ces heures à un ticket, et à son matériel"
              value={ticketId}
              placeholder="Aucune"
              onChange={(e) => setTicketId(e.target.value)}
              options={demandes.map((t: any) => ({
                value: t.id,
                label: `${t.reference ?? '#' + t.id} — ${t.titre}`,
              }))}
            />
          )}

          {/* --------------------------------------------- avec qui */}

          <RenfortsEditor renforts={renforts} onChange={setRenforts} options={optionsAnnuaire} minutes={minutes} />

          {/* ------------------------------------------------ le total */}

          <TotalTemps minutes={minutes} renforts={renforts} />
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button
          onClick={() => enregistrer.mutate()}
          loading={enregistrer.isPending}
          disabled={!valide}
        >
          {enCorrection ? 'Enregistrer' : 'Ajouter'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
