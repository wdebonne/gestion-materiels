import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { User, Building2, MapPin, Briefcase } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  Select,
  TextArea,
} from '@/components/ui'

/**
 * Remise d'un trousseau ou d'une clé.
 *
 * Quatre natures de détenteur, parce que les clés d'une commune ne vont pas
 * qu'à des agents :
 *
 *   une **personne**  l'agent d'astreinte, le gardien. La liste vient de
 *                     l'annuaire — `users` — où figurent aussi bien les comptes
 *                     de l'application que les gens qui ne s'y connectent
 *                     jamais. Un nom écrit une fois y est le même partout, là
 *                     où « un externe » en produit une orthographe par saisie ;
 *   un **service**    le trousseau appartient à l'équipe, pas à quelqu'un —
 *                     il survit aux départs et n'a pas à être réattribué à
 *                     chaque changement de poste ;
 *   un **lieu**       la clé vit dans une armoire, à un endroit connu. C'est
 *                     une réponse légitime à « où est-elle ? », et la seule
 *                     honnête pour un double de secours ;
 *   un **externe**    une entreprise, un prestataire, un élu. Sans cette
 *                     option, une clé confiée au-dehors devrait être notée
 *                     rendue pour ne pas fausser le stock, et sa trace serait
 *                     perdue au moment où elle compte le plus.
 */

interface Props {
  objectId: number
  estLot: boolean
  disponibles: number
  onClose: () => void
}

type Nature = 'user' | 'service' | 'ouvrant' | 'externe'

const NATURES: Array<{ valeur: Nature; label: string; icone: typeof User }> = [
  { valeur: 'user', label: 'Une personne', icone: User },
  { valeur: 'service', label: 'Un service', icone: Building2 },
  { valeur: 'ouvrant', label: 'Un lieu', icone: MapPin },
  { valeur: 'externe', label: 'Un externe', icone: Briefcase },
]

export default function AttribuerTrousseau({ objectId, estLot, disponibles, onClose }: Props) {
  const queryClient = useQueryClient()

  const [nature, setNature] = useState<Nature>('user')
  const [cible, setCible] = useState('')
  const [libelle, setLibelle] = useState('')
  const [quantite, setQuantite] = useState(1)
  const [notes, setNotes] = useState('')

  /*
   * `GET /api/users/annuaire`, et non `GET /api/users`.
   *
   * Deux défauts se cumulaient ici. La liste lisait `res.data.data`, alors que
   * la route répond `{ users }` : elle était donc vide quoi qu'il arrive, et le
   * champ « Personne » ne proposait jamais personne. Et `GET /api/users` est
   * réservé à l'administrateur, si bien qu'un agent — qui a pourtant le droit
   * de remettre une clé — n'aurait de toute façon reçu qu'un 403 silencieux.
   *
   * L'annuaire répond aux deux : ouvert à la saisie de terrain, il ne rend que
   * des noms, et il rend aussi les personnes sans compte.
   */
  const { data: utilisateurs = [] } = useQuery<any[]>({
    queryKey: ['annuaire'],
    queryFn: async () => (await api.get('/users/annuaire')).data.users ?? [],
    enabled: nature === 'user',
  })

  const { data: services = [] } = useQuery<any[]>({
    queryKey: ['services-actifs'],
    queryFn: async () => (await api.get('/services')).data.data ?? [],
    enabled: nature === 'service',
  })

  const { data: referentiel = [] } = useQuery<any[]>({
    queryKey: ['cles-referentiel'],
    queryFn: async () => (await api.get('/cles/referentiel')).data.data,
    enabled: nature === 'ouvrant',
  })

  const attribuer = useMutation({
    mutationFn: async () =>
      api.post(`/cles/${objectId}/attribuer`, {
        holderType: nature,
        holderUserId: nature === 'user' ? Number(cible) : undefined,
        holderServiceId: nature === 'service' ? Number(cible) : undefined,
        holderOuvrantId: nature === 'ouvrant' ? Number(cible) : undefined,
        holderLabel: nature === 'externe' ? libelle : undefined,
        quantity: estLot ? quantite : 1,
        notes,
      }),
    onSuccess: () => {
      toast.success('Remise enregistrée')
      queryClient.invalidateQueries({ queryKey: ['cle', objectId] })
      queryClient.invalidateQueries({ queryKey: ['cle-historique', objectId] })
      queryClient.invalidateQueries({ queryKey: ['cles'] })
      onClose()
    },
    onError: (erreur: any) => {
      toast.error(erreur?.response?.data?.message ?? 'Remise impossible')
    },
  })

  const optionsCible =
    nature === 'user'
      ? utilisateurs.map((u) => ({
          value: String(u.id),
          label: [u.firstName, u.lastName].filter(Boolean).join(' ') || `Compte n° ${u.id}`,
        }))
      : nature === 'service'
        ? services.map((s) => ({ value: String(s.id), label: s.name }))
        : nature === 'ouvrant'
          ? referentiel.flatMap((site: any) =>
              (site.ouvrants ?? []).map((o: any) => ({
                value: String(o.id),
                label: `${site.name} — ${o.name}`,
              }))
            )
          : []

  const pret = nature === 'externe' ? libelle.trim() !== '' : cible !== ''

  return (
    <Modal isOpen onClose={onClose} title="Remettre le matériel" size="md">
      <ModalBody>
        <div className="space-y-4">
          <div>
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Remis à
            </span>
            <div className="grid grid-cols-2 gap-2">
              {NATURES.map(({ valeur, label, icone: Icone }) => (
                <button
                  key={valeur}
                  type="button"
                  onClick={() => {
                    setNature(valeur)
                    setCible('')
                  }}
                  className={`touch-target flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    nature === valeur
                      ? 'border-primary-600 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700/50'
                  }`}
                >
                  <Icone className="h-4 w-4 flex-shrink-0" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {nature === 'externe' ? (
            <Input
              label="Nom de l'externe"
              value={libelle}
              onChange={(e) => setLibelle(e.target.value)}
              placeholder="Entreprise Dupont, prestataire ménage…"
              hint="Personne ou société sans compte dans l'application."
            />
          ) : (
            <Select
              label={
                nature === 'user' ? 'Personne' : nature === 'service' ? 'Service' : 'Lieu'
              }
              value={cible}
              onChange={(e) => setCible(e.target.value)}
              placeholder="Choisir"
              options={optionsCible}
              hint={
                nature === 'user' && optionsCible.length === 0
                  ? "Personne dans l'annuaire. Un administrateur les ajoute dans Paramètres > Utilisateurs — une personne qui ne se connecte pas y tient en un nom."
                  : undefined
              }
            />
          )}

          {estLot && (
            <Input
              label="Nombre d'exemplaires"
              type="number"
              min={1}
              max={disponibles}
              value={quantite}
              onChange={(e) => setQuantite(Math.max(1, Number(e.target.value) || 1))}
              hint={`${disponibles} disponible${disponibles > 1 ? 's' : ''} au coffre`}
            />
          )}

          <TextArea
            label="Note"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Motif, durée prévue, consigne particulière…"
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>
          Annuler
        </Button>
        <Button onClick={() => attribuer.mutate()} disabled={!pret || attribuer.isPending}>
          Enregistrer la remise
        </Button>
      </ModalFooter>
    </Modal>
  )
}
