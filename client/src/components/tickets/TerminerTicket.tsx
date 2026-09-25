import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CheckCircle2, Undo2 } from 'lucide-react'
import { Button, Modal, ModalBody, ModalFooter, Select, TextArea } from '@/components/ui'
import { ticketApi, type DroitsTicket, type Ticket } from '@/lib/api'
import { ajouterMinutes, jourCourant } from '@/lib/duree'
import { useAuthStore } from '@/stores/auth.store'
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
 * Terminer une demande — ou contrôler la clôture d'un agent avant de la valider.
 *
 * « Le technicien valide le ticket, met le temps passé et s'il a été aidé,
 * comme sur le planning. » Les champs sont ceux de la saisie d'heures, et
 * l'enregistrement crée la tâche au planning : il n'y a rien à ressaisir le
 * soir.
 *
 * Deux usages, un seul formulaire :
 *
 *   - **terminer** : l'agent dit quand, combien de temps, avec qui. Le bouton
 *     annonce ce qui va se passer — « Résoudre », ou « Soumettre à validation »
 *     quand l'agent n'est pas autonome sur la catégorie ;
 *   - **valider** : le superviseur retrouve la saisie de l'agent, la corrige au
 *     besoin — la durée, les personnes qui ont travaillé — puis valide, ou
 *     renvoie la demande avec ce qui reste à faire.
 */
export default function TerminerTicket({
  ticket,
  droits,
  mode,
  ouvert,
  onClose,
}: {
  ticket: Ticket
  droits: DroitsTicket
  mode: 'terminer' | 'valider'
  ouvert: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const moi = useAuthStore((s) => s.user?.id)

  const [jour, setJour] = useState(jourCourant())
  const [heureDebut, setHeureDebut] = useState('')
  const [heureFin, setHeureFin] = useState('')
  const [titulaireId, setTitulaireId] = useState<number | null>(null)
  const [renforts, setRenforts] = useState<RenfortSaisi[]>([])
  const [commentaire, setCommentaire] = useState('')
  const [motif, setMotif] = useState('')
  const [renvoi, setRenvoi] = useState(false)
  const [erreur, setErreur] = useState('')

  const { data: personnes = [] } = useQuery({
    queryKey: ['tickets', 'renforts', ticket.id],
    queryFn: async () => (await ticketApi.renfortsPossibles(ticket.id)).data.personnes,
    enabled: ouvert,
  })

  const { data: cloture } = useQuery({
    queryKey: ['tickets', 'cloture', ticket.id],
    queryFn: async () => (await ticketApi.cloture(ticket.id)).data,
    enabled: ouvert && mode === 'valider',
  })

  // Remise à zéro à chaque ouverture ; en validation, la saisie de l'agent.
  useEffect(() => {
    if (!ouvert) return
    setErreur('')
    setCommentaire('')
    setMotif('')
    setRenvoi(false)

    const tache = mode === 'valider' ? cloture?.tacheCloture : null
    if (tache) {
      setJour(tache.jour)
      // Une tâche saisie en durée seule n'a pas d'horaires : on les pose à
      // partir de 8 h pour que la durée reste lisible et corrigible.
      const debut = tache.heureDebut ?? '08:00'
      setHeureDebut(debut)
      setHeureFin(tache.heureFin ?? ajouterMinutes(debut, tache.minutes))
      setTitulaireId(tache.titulaire.id)
      setRenforts(renfortsDepuis(tache.participants))
    } else {
      setJour(jourCourant())
      setHeureDebut('')
      setHeureFin('')
      setTitulaireId(moi ? Number(moi) : null)
      setRenforts([])
    }
  }, [ouvert, mode, cloture, moi])

  const minutes = useMemo(() => dureeEntre(heureDebut, heureFin), [heureDebut, heureFin])
  const options = personnes
    .filter((p) => p.id !== titulaireId)
    .map((p) => ({ value: p.id, label: p.nom }))
  const valide = Boolean(jour && minutes != null && renfortsComplets(renforts))

  const saisie = () => ({
    jour,
    heureDebut,
    heureFin,
    participants: participantsDepuis(renforts, minutes),
    titulaireId,
  })

  const apres = (message: string) => {
    toast.success(message)
    queryClient.invalidateQueries({ queryKey: ['tickets'] })
    queryClient.invalidateQueries({ queryKey: ['plannings'] })
    onClose()
  }
  const surErreur = (e: any) => setErreur(e?.response?.data?.message ?? "L'enregistrement n'a pas abouti.")

  const terminer = useMutation({
    mutationFn: () => ticketApi.terminer(ticket.id, { ...saisie(), commentaire: commentaire.trim() || null }),
    onSuccess: ({ data }) =>
      apres(data.statut.validation ? 'Demande soumise à validation' : 'Demande résolue, temps enregistré au planning'),
    onError: surErreur,
  })

  const valider = useMutation({
    mutationFn: () =>
      ticketApi.valider(ticket.id, { corrections: saisie(), commentaire: commentaire.trim() || null }),
    onSuccess: () => apres('Clôture validée'),
    onError: surErreur,
  })

  const renvoyer = useMutation({
    mutationFn: () => ticketApi.renvoyer(ticket.id, motif.trim()),
    onSuccess: () => apres('Demande renvoyée à l’agent'),
    onError: surErreur,
  })

  const peutChoisirTitulaire = droits.superviseur && personnes.length > 0
  const titre =
    mode === 'valider' ? `Contrôler la clôture — ${ticket.reference ?? ''}` : `Terminer — ${ticket.reference ?? ''}`

  return (
    <Modal isOpen={ouvert} onClose={onClose} title={titre} size="lg">
      <ModalBody>
        <div className="space-y-5">
          {erreur && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {erreur}
            </p>
          )}

          {mode === 'terminer' && !droits.autonome && (
            <p className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800 dark:bg-teal-900/30 dark:text-teal-200">
              Votre clôture sera relue par un superviseur de la catégorie avant d’être définitive.
            </p>
          )}
          {mode === 'valider' && (
            <p className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800 dark:bg-teal-900/30 dark:text-teal-200">
              Voici ce que l’agent a saisi. Corrigez la durée ou les personnes au besoin : la tâche du planning est
              modifiée en conséquence, pas dupliquée.
            </p>
          )}

          {peutChoisirTitulaire && (
            <Select
              label="Qui est intervenu"
              value={titulaireId ?? ''}
              onChange={(e) => setTitulaireId(e.target.value ? Number(e.target.value) : null)}
              options={personnes.map((p) => ({ value: p.id, label: p.nom }))}
            />
          )}

          <ChampsQuand
            jour={jour}
            heureDebut={heureDebut}
            heureFin={heureFin}
            onJour={setJour}
            onHeureDebut={setHeureDebut}
            onHeureFin={setHeureFin}
          />

          <RenfortsEditor
            renforts={renforts}
            onChange={setRenforts}
            options={options}
            minutes={minutes}
            titre={mode === 'valider' ? 'Personnes qui ont aidé' : "J'ai été aidé"}
          />

          <TotalTemps minutes={minutes} renforts={renforts} pourQui={mode === 'valider' ? 'pour l’agent' : 'pour vous'} />

          <TextArea
            label={mode === 'valider' ? 'Un mot pour le demandeur' : 'Ce qui a été fait'}
            hint="Facultatif — publié dans le fil de la demande"
            rows={2}
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
          />

          {renvoi && (
            <TextArea
              label="Ce qui reste à faire"
              hint="Obligatoire — l’agent le lira dans le fil de la demande"
              rows={2}
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
            />
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Annuler
        </Button>
        {mode === 'terminer' ? (
          <Button
            icon={<CheckCircle2 className="h-4 w-4" />}
            onClick={() => terminer.mutate()}
            loading={terminer.isPending}
            disabled={!valide}
          >
            {droits.autonome ? 'Résoudre' : 'Soumettre à validation'}
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              icon={<Undo2 className="h-4 w-4" />}
              onClick={() => (renvoi ? renvoyer.mutate() : setRenvoi(true))}
              loading={renvoyer.isPending}
              disabled={renvoi && !motif.trim()}
            >
              {renvoi ? 'Confirmer le renvoi' : 'Renvoyer à l’agent'}
            </Button>
            <Button
              icon={<CheckCircle2 className="h-4 w-4" />}
              onClick={() => valider.mutate()}
              loading={valider.isPending}
              disabled={!valide || renvoi}
            >
              Valider
            </Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  )
}
