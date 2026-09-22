import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, Plus, UserPlus, Users, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button, Input, Modal, ModalBody, ModalFooter, ReferenceSelect, Select, TextArea } from '@/components/ui'
import api, { CategorieTemps, TachePlanning, planningApi } from '@/lib/api'
import { ajouterMinutes, decalerJours, formaterDuree, jourCourant, jourEnFrancais, minutesEntre } from '@/lib/duree'
import { cn } from '@/lib/utils'

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
 */

interface RenfortSaisi {
  /** Identifiant local, pour distinguer deux lignes encore vides. */
  cle: number
  /**
   * Le renfort est-il quelqu'un de l'annuaire ?
   *
   * Porté explicitement plutôt que déduit de `userId === null`, qui
   * confondrait « pas encore choisi » et « volontairement anonyme » : une
   * ligne « collègue » fraîchement ajoutée a les deux champs vides.
   */
  nomme: boolean
  userId: number | null
  libelle: string
  minutes: number | null
}

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

const DUREES_RAPIDES = [30, 60, 120, 240]

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
      setRenforts(
        tache.participants.map((p, index) => ({
          cle: index,
          nomme: Boolean(p.personne),
          userId: p.personne?.id ?? null,
          libelle: p.libelle ?? '',
          minutes: p.minutes,
        }))
      )
    } else {
      setJour(jourInitial ?? jourCourant())
      setHeureDebut('')
      setHeureFin('')
      setCategorie('')
      setDescription('')
      setManifestationId('')
      setPour(titulaireId)
      setRenforts([])
    }
  }, [ouvert, tache, jourInitial, titulaireId])

  /** La durée du titulaire, ou `null` tant que la saisie ne permet pas de la dire. */
  const minutes = useMemo(() => {
    if (!heureDebut || !heureFin) return null
    try {
      return minutesEntre(heureDebut, heureFin)
    } catch {
      return null
    }
  }, [heureDebut, heureFin])

  const franchitMinuit = Boolean(heureDebut && heureFin && heureFin < heureDebut)

  const minutesMobilisees = useMemo(() => {
    if (minutes == null) return null
    return renforts.reduce((total, r) => total + (r.minutes ?? minutes), minutes)
  }, [minutes, renforts])

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
        participants: renforts.map((r) => ({
          userId: r.nomme ? r.userId : null,
          libelle: r.nomme ? null : r.libelle.trim(),
          minutes: r.minutes ?? minutes,
        })),
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

  const ajouterRenfort = (nomme: boolean) =>
    setRenforts((liste) => [
      ...liste,
      { cle: Date.now() + liste.length, nomme, userId: null, libelle: '', minutes: null },
    ])

  const majRenfort = (cle: number, champs: Partial<RenfortSaisi>) =>
    setRenforts((liste) => liste.map((r) => (r.cle === cle ? { ...r, ...champs } : r)))

  const renfortsComplets = renforts.every((r) => (r.nomme ? r.userId != null : r.libelle.trim().length > 0))
  const valide = Boolean(jour && heureDebut && heureFin && minutes != null && renfortsComplets)

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

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Quand</label>
              <div className="flex gap-1">
                <PuceJour libelle="Hier" jour={decalerJours(jourCourant(), -1)} actif={jour} onChoisir={setJour} />
                <PuceJour libelle="Aujourd'hui" jour={jourCourant()} actif={jour} onChoisir={setJour} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input type="date" value={jour} onChange={(e) => setJour(e.target.value)} />
              <Input
                type="time"
                value={heureDebut}
                onChange={(e) => setHeureDebut(e.target.value)}
                aria-label="Heure de début"
              />
              <Input
                type="time"
                value={heureFin}
                onChange={(e) => setHeureFin(e.target.value)}
                aria-label="Heure de fin"
              />
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {DUREES_RAPIDES.map((duree) => (
                <button
                  key={duree}
                  type="button"
                  onClick={() => {
                    const depart = heureDebut || '08:00'
                    setHeureDebut(depart)
                    setHeureFin(ajouterMinutes(depart, duree))
                  }}
                  className="min-h-[36px] rounded-full border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  {formaterDuree(duree)}
                </button>
              ))}
            </div>

            {franchitMinuit && (
              <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
                Cette tâche se termine le lendemain, le {jourEnFrancais(decalerJours(jour, 1), { day: 'numeric', month: 'long' })} à {heureFin}.
              </p>
            )}
          </div>

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

          <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Users className="h-4 w-4" />
                J'étais accompagné
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" icon={<UserPlus className="h-4 w-4" />}
                  onClick={() => ajouterRenfort(true)}>
                  Un collègue
                </Button>
                <Button type="button" variant="ghost" size="sm" icon={<Plus className="h-4 w-4" />}
                  onClick={() => ajouterRenfort(false)}>
                  Renfort non nommé
                </Button>
              </div>
            </div>

            {renforts.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Deux agents une heure sur la même tâche comptent pour deux heures de travail.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {renforts.map((renfort) => (
                  <li key={renfort.cle} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                    {renfort.nomme ? (
                      <Select
                        value={renfort.userId ?? ''}
                        placeholder="Choisir dans l'annuaire…"
                        onChange={(e) =>
                          majRenfort(renfort.cle, { userId: e.target.value ? Number(e.target.value) : null })
                        }
                        options={optionsAnnuaire}
                      />
                    ) : (
                      <Input
                        value={renfort.libelle}
                        placeholder="Ex. : un agent des espaces verts"
                        onChange={(e) => majRenfort(renfort.cle, { libelle: e.target.value })}
                      />
                    )}

                    <Input
                      type="number"
                      min={1}
                      max={1440}
                      className="sm:w-28"
                      value={renfort.minutes ?? minutes ?? ''}
                      onChange={(e) =>
                        majRenfort(renfort.cle, { minutes: e.target.value ? Number(e.target.value) : null })
                      }
                      aria-label="Minutes de participation"
                      rightIcon={<span className="text-xs text-gray-500">min</span>}
                    />

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Retirer ce renfort"
                      onClick={() => setRenforts((l) => l.filter((r) => r.cle !== renfort.cle))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ------------------------------------------------ le total */}

          <div className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
            minutes == null
              ? 'bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-400'
              : 'bg-primary-50 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200'
          )}>
            <Clock className="h-4 w-4 flex-shrink-0" />
            {minutes == null ? (
              <span>Indiquez une heure de début et une heure de fin.</span>
            ) : renforts.length === 0 ? (
              <span><strong>{formaterDuree(minutes)}</strong></span>
            ) : (
              <span>
                <strong>{formaterDuree(minutes)}</strong> pour vous,{' '}
                <strong>{formaterDuree(minutesMobilisees ?? minutes)}</strong> de travail mobilisé
              </span>
            )}
          </div>
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

function PuceJour({
  libelle,
  jour,
  actif,
  onChoisir,
}: { libelle: string; jour: string; actif: string; onChoisir: (j: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChoisir(jour)}
      className={cn(
        'min-h-[32px] rounded-full px-3 text-sm',
        actif === jour
          ? 'bg-primary-600 text-white'
          : 'border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'
      )}
    >
      {libelle}
    </button>
  )
}
