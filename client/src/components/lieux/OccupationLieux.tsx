import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import frLocale from '@fullcalendar/core/locales/fr'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  LoadingInline,
  Modal,
  ModalBody,
  ModalFooter,
  Select,
  TextArea,
  useConfirm,
} from '@/components/ui'
import Can from '@/components/Can'
import api from '@/lib/api'
import toast from 'react-hot-toast'

/**
 * L'agenda des lieux : qui occupe quelle salle, et quand.
 *
 * L'information tenait jusqu'ici de l'agenda mural. La salle des mariages était
 * réservée le 28 septembre de 16h à 18h dans la tête du régisseur, et la
 * deuxième demande pour le même créneau se découvrait au téléphone — ou le jour
 * même.
 *
 * **Le conflit est vérifié par le serveur, jamais recalculé ici.** L'écran
 * appelle `/sites/disponibilite`, qui est la fonction même dont se sert le refus
 * à l'enregistrement. Une seconde implémentation côté navigateur finirait par
 * annoncer « libre » là où le serveur répondrait 409, et l'utilisateur cesserait
 * de croire l'indication — c'est la règle que `reservation.routes.ts` pose déjà
 * pour le parc.
 */

interface Occupation {
  id: number
  site_id: number
  piece_id: number | null
  manifestation_id: number | null
  titre: string
  debut: string
  fin: string
  statut: 'demande' | 'confirme' | 'annule'
  demandeur: string | null
  notes: string | null
  site_name: string | null
  piece_name: string | null
}

interface Piece {
  id: number
  name: string
}

interface SiteArbre {
  id: number
  name: string
  pieces: Piece[]
}

interface FormOccupation {
  id?: number
  siteId: string
  pieceId: string
  titre: string
  debut: string
  fin: string
  statut: 'demande' | 'confirme' | 'annule'
  demandeur: string
  notes: string
}

/** `2026-09-28 16:00:00` → `2026-09-28T16:00`, ce qu'attend un `datetime-local`. */
const versChamp = (valeur: string): string => (valeur ? valeur.replace(' ', 'T').slice(0, 16) : '')

/**
 * `2026-09-28T16:00` → `2026-09-28 16:00:00`.
 *
 * Passer par un objet `Date` puis `toISOString()` serait le réflexe, et
 * décalerait tout d'une ou deux heures selon le fuseau : ce que l'utilisateur a
 * saisi est une heure locale, et c'est une heure locale que la base attend.
 */
const versApi = (valeur: string): string => (valeur ? `${valeur.replace('T', ' ')}:00`.slice(0, 19) : '')

/** Les bornes du mois autour d'une date, au format de l'API. */
function bornesAutour(date: Date): { debut: string; fin: string } {
  const premier = new Date(date.getFullYear(), date.getMonth() - 1, 1)
  const dernier = new Date(date.getFullYear(), date.getMonth() + 2, 0)
  const jour = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { debut: `${jour(premier)} 00:00:00`, fin: `${jour(dernier)} 23:59:59` }
}

const COULEURS: Record<Occupation['statut'], string> = {
  confirme: '#0ea5e9',
  // L'ambre dit « à arbitrer » : une demande n'interdit rien, elle attend.
  demande: '#f59e0b',
  annule: '#9ca3af',
}

export default function OccupationLieux() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const calendrier = useRef<FullCalendar>(null)

  const [mois, setMois] = useState(new Date())
  const [siteFiltre, setSiteFiltre] = useState('')
  const [pieceFiltre, setPieceFiltre] = useState('')
  const [form, setForm] = useState<FormOccupation | null>(null)

  const { data: sites = [] } = useQuery<SiteArbre[]>({
    queryKey: ['lieux-arbre'],
    queryFn: async () => (await api.get('/sites/arbre')).data.sites,
  })

  const bornes = useMemo(() => bornesAutour(mois), [mois])

  const { data: occupations = [], isLoading } = useQuery<Occupation[]>({
    queryKey: ['lieux-occupations', bornes.debut, bornes.fin, siteFiltre, pieceFiltre],
    queryFn: async () =>
      (
        await api.get('/sites/occupations', {
          params: {
            debut: bornes.debut,
            fin: bornes.fin,
            siteId: siteFiltre || undefined,
            pieceId: pieceFiltre || undefined,
          },
        })
      ).data.occupations,
  })

  /**
   * Ce qui heurterait le créneau en cours de saisie.
   *
   * Interrogé au serveur à chaque changement de lieu ou d'horaire, et pas
   * seulement à l'enregistrement : l'intérêt de l'alerte est d'arriver avant que
   * la personne ait fini de remplir le reste.
   */
  const { data: disponibilite } = useQuery<{
    libre: boolean
    bloquants: Occupation[]
    avertissements: Occupation[]
  }>({
    queryKey: ['lieux-dispo', form?.siteId, form?.pieceId, form?.debut, form?.fin, form?.id],
    enabled: Boolean(form?.siteId && form?.debut && form?.fin && form.fin > form.debut),
    queryFn: async () =>
      (
        await api.get('/sites/disponibilite', {
          params: {
            siteId: form!.siteId,
            pieceId: form!.pieceId || undefined,
            debut: versApi(form!.debut),
            fin: versApi(form!.fin),
            ignorerId: form!.id,
          },
        })
      ).data,
  })

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['lieux-occupations'] })
    queryClient.invalidateQueries({ queryKey: ['lieux-dispo'] })
  }

  const enregistrer = useMutation({
    mutationFn: async (valeurs: FormOccupation) => {
      const corps = {
        siteId: Number(valeurs.siteId),
        pieceId: valeurs.pieceId ? Number(valeurs.pieceId) : null,
        titre: valeurs.titre,
        debut: versApi(valeurs.debut),
        fin: versApi(valeurs.fin),
        statut: valeurs.statut,
        demandeur: valeurs.demandeur || null,
        notes: valeurs.notes || null,
      }
      if (valeurs.id) return api.put(`/sites/occupations/${valeurs.id}`, corps)
      return api.post('/sites/occupations', corps)
    },
    onSuccess: () => {
      setForm(null)
      rafraichir()
    },
    onError: (erreur: any) => {
      // Le 409 du serveur porte la liste des créneaux qui bloquent : le message
      // est remonté tel quel, parce qu'il dit lequel.
      toast.error(erreur?.response?.data?.message ?? 'Enregistrement impossible')
    },
    meta: { successMessage: 'Créneau enregistré' },
  })

  const supprimer = async (occupation: Occupation) => {
    const ok = await confirm({
      title: `Supprimer « ${occupation.titre} » ?`,
      message: 'Le créneau sera retiré de l’agenda du lieu.',
      confirmLabel: 'Supprimer',
      variant: 'danger',
    })
    if (!ok) return

    try {
      await api.delete(`/sites/occupations/${occupation.id}`)
      toast.success('Créneau supprimé')
      setForm(null)
      rafraichir()
    } catch (erreur: any) {
      toast.error(erreur?.response?.data?.message ?? 'Suppression impossible')
    }
  }

  const evenements = useMemo(
    () =>
      occupations.map((o) => ({
        id: String(o.id),
        title: `${o.piece_name ?? o.site_name ?? ''} — ${o.titre}`,
        start: o.debut.replace(' ', 'T'),
        end: o.fin.replace(' ', 'T'),
        backgroundColor: COULEURS[o.statut],
        borderColor: COULEURS[o.statut],
        extendedProps: { occupation: o },
      })),
    [occupations]
  )

  const piecesDuSite = (siteId: string): Piece[] =>
    sites.find((s) => String(s.id) === String(siteId))?.pieces ?? []

  const ouvrirCreation = (debut?: string, fin?: string) =>
    setForm({
      siteId: siteFiltre || (sites[0] ? String(sites[0].id) : ''),
      pieceId: pieceFiltre || '',
      titre: '',
      debut: debut ?? '',
      fin: fin ?? '',
      statut: 'confirme',
      demandeur: '',
      notes: '',
    })

  const conflitsAffiches = [
    ...(disponibilite?.bloquants ?? []),
    ...(disponibilite?.avertissements ?? []),
  ]

  return (
    <div className="space-y-4">
      {/* -------------------------------------------------------- filtres */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <Select
              label="Bâtiment"
              value={siteFiltre}
              onChange={(e) => {
                setSiteFiltre(e.target.value)
                setPieceFiltre('')
              }}
              options={[
                { value: '', label: 'Tous les bâtiments' },
                ...sites.map((s) => ({ value: String(s.id), label: s.name })),
              ]}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <Select
              label="Pièce"
              value={pieceFiltre}
              onChange={(e) => setPieceFiltre(e.target.value)}
              disabled={!siteFiltre}
              options={[
                { value: '', label: siteFiltre ? 'Tout le bâtiment' : '—' },
                ...piecesDuSite(siteFiltre).map((p) => ({ value: String(p.id), label: p.name })),
              ]}
            />
          </div>
          <Can manage>
            <Button onClick={() => ouvrirCreation()}>
              <Plus className="mr-2 h-4 w-4" />
              Occuper un lieu
            </Button>
          </Can>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-300">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded" style={{ background: COULEURS.confirme }} />
            Confirmé
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded" style={{ background: COULEURS.demande }} />
            Demandé — à arbitrer
          </span>
        </div>
      </Card>

      {/* ------------------------------------------------------ calendrier */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                calendrier.current?.getApi().prev()
                setMois(calendrier.current?.getApi().getDate() ?? mois)
              }}
              className="touch-target rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Période précédente"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                calendrier.current?.getApi().next()
                setMois(calendrier.current?.getApi().getDate() ?? mois)
              }}
              className="touch-target rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Période suivante"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                calendrier.current?.getApi().today()
                setMois(new Date())
              }}
            >
              Aujourd'hui
            </Button>
          </div>
          {isLoading && <LoadingInline />}
        </div>

        <div className="h-[600px]">
          <FullCalendar
            ref={calendrier}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            locale={frLocale}
            headerToolbar={{ left: '', center: 'title', right: 'dayGridMonth,timeGridWeek,listWeek' }}
            events={evenements}
            height="100%"
            nowIndicator
            selectable
            // La sélection d'une plage ouvre le formulaire déjà rempli : c'est le
            // geste naturel du régisseur, qui sait d'abord quand, puis quoi.
            select={(info) =>
              ouvrirCreation(versChamp(info.startStr.replace('T', ' ')), versChamp(info.endStr.replace('T', ' ')))
            }
            eventClick={(info) => {
              const o: Occupation = info.event.extendedProps.occupation
              setForm({
                id: o.id,
                siteId: String(o.site_id),
                pieceId: o.piece_id ? String(o.piece_id) : '',
                titre: o.titre,
                debut: versChamp(o.debut),
                fin: versChamp(o.fin),
                statut: o.statut,
                demandeur: o.demandeur ?? '',
                notes: o.notes ?? '',
              })
            }}
            datesSet={(info) => setMois(info.view.currentStart)}
            eventTimeFormat={{ hour: '2-digit', minute: '2-digit', meridiem: false, hour12: false }}
            slotMinTime="06:00:00"
            slotMaxTime="24:00:00"
          />
        </div>
      </Card>

      {/* ------------------------------------------------------ formulaire */}
      {form && (
        <Modal
          isOpen
          onClose={() => setForm(null)}
          title={form.id ? 'Modifier le créneau' : 'Occuper un lieu'}
        >
          <ModalBody>
            <div className="space-y-4">
              <Input
                label="Intitulé"
                value={form.titre}
                onChange={(e) => setForm({ ...form, titre: e.target.value })}
                placeholder="Mariage Dupont, Conseil municipal, Loto des écoles…"
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label="Bâtiment"
                  value={form.siteId}
                  onChange={(e) => setForm({ ...form, siteId: e.target.value, pieceId: '' })}
                  options={sites.map((s) => ({ value: String(s.id), label: s.name }))}
                  placeholder="Choisir…"
                />
                <Select
                  label="Pièce"
                  value={form.pieceId}
                  onChange={(e) => setForm({ ...form, pieceId: e.target.value })}
                  options={[
                    { value: '', label: 'Tout le bâtiment' },
                    ...piecesDuSite(form.siteId).map((p) => ({ value: String(p.id), label: p.name })),
                  ]}
                  hint="Réserver le bâtiment entier rend toutes ses pièces indisponibles."
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Début"
                  type="datetime-local"
                  value={form.debut}
                  onChange={(e) => setForm({ ...form, debut: e.target.value })}
                />
                <Input
                  label="Fin"
                  type="datetime-local"
                  value={form.fin}
                  onChange={(e) => setForm({ ...form, fin: e.target.value })}
                />
              </div>

              {/* Le serveur a répondu : on montre ce qu'il a trouvé. */}
              {conflitsAffiches.length > 0 && (
                <Alert
                  type={(disponibilite?.bloquants?.length ?? 0) > 0 ? 'error' : 'warning'}
                  title={
                    (disponibilite?.bloquants?.length ?? 0) > 0
                      ? 'Ce lieu est déjà retenu sur ce créneau'
                      : 'Une demande porte déjà sur ce créneau'
                  }
                >
                  <ul className="space-y-0.5 text-sm">
                    {conflitsAffiches.map((c) => (
                      <li key={c.id}>
                        {c.piece_name ?? c.site_name} — {c.titre}, du{' '}
                        {c.debut.slice(0, 16).replace('T', ' ')} au{' '}
                        {c.fin.slice(0, 16).replace('T', ' ')}
                        {c.statut === 'demande' && (
                          <Badge variant="warning" size="sm" className="ml-2">
                            à arbitrer
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label="Statut"
                  value={form.statut}
                  onChange={(e) => setForm({ ...form, statut: e.target.value as any })}
                  options={[
                    { value: 'confirme', label: 'Confirmé' },
                    { value: 'demande', label: 'Demandé — à arbitrer' },
                    { value: 'annule', label: 'Annulé' },
                  ]}
                  hint="Un créneau annulé reste lisible et ne bloque plus personne."
                />
                <Input
                  label="Demandeur"
                  value={form.demandeur}
                  onChange={(e) => setForm({ ...form, demandeur: e.target.value })}
                  placeholder="Association, service, particulier…"
                />
              </div>

              <TextArea
                label="Notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            {form.id && (
              <Button
                variant="outline"
                onClick={() => {
                  const o = occupations.find((x) => x.id === form.id)
                  if (o) supprimer(o)
                }}
                className="mr-auto text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Supprimer
              </Button>
            )}
            <Button variant="outline" onClick={() => setForm(null)}>
              Annuler
            </Button>
            <Button
              onClick={() => enregistrer.mutate(form)}
              disabled={
                !form.titre.trim() ||
                !form.siteId ||
                !form.debut ||
                !form.fin ||
                form.fin <= form.debut ||
                enregistrer.isPending
              }
            >
              Enregistrer
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
