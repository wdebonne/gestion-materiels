import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import dayGridPlugin from '@fullcalendar/daygrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import frLocale from '@fullcalendar/core/locales/fr'
import { CalendarOff, ChevronLeft, ChevronRight, FileDown, Plus, Users } from 'lucide-react'
import { Button, Card, CardBody, LoadingInline, Select } from '@/components/ui'
import { TachePlanning, planningApi } from '@/lib/api'
import { couleurDe, encreSur } from '@/lib/paletteCategories'
import { useThemeSombre } from '@/lib/useThemeSombre'
import toast from 'react-hot-toast'
import { decalerJours, formaterDuree, jourCourant } from '@/lib/duree'
import { exporterPlanningPdf } from './exportPdf'

/**
 * Le planning, en grille horaire.
 *
 * Complémentaire de « Ma semaine » et non redondant : celle-ci sert à saisir,
 * celui-ci à voir la forme d'une journée et les trous — ce que cherche un
 * responsable qui prépare la semaine suivante, ou qui veut savoir où sont
 * passées les heures d'un mardi.
 *
 * Un clic sur un créneau vide ouvre le formulaire avec le jour et l'heure déjà
 * remplis. Les tâches ne sont pas déplaçables à la souris : un glissement
 * involontaire changerait des heures déjà déclarées, et rien ne le signalerait.
 *
 * Trois partis pris de lisibilité, appris de ce que la grille rendait mal :
 *
 * - **Deux tâches à la même heure se partagent la largeur**, au lieu de se
 *   recouvrir en escalier comme le fait un agenda par défaut. Le recouvrement
 *   convient à des rendez-vous, dont seule l'heure compte ; ici chaque bloc
 *   porte un libellé, et celui de dessous devenait illisible.
 * - **L'encre se calcule sur le fond** plutôt que d'être blanche partout : sur
 *   le jaune de la palette, du blanc tombe à 2:1 de contraste.
 * - **Le bloc dit ce qu'il peut** selon sa hauteur : une tâche d'un quart
 *   d'heure n'a la place que de son horaire, pas de trois lignes empilées.
 */

interface VuePlanningProps {
  personnes: { id: number; nom: string }[]
  moi: number
  onSaisir: (options: { jour?: string; tache?: TachePlanning | null }) => void
}

type Vue = 'timeGridWeek' | 'timeGridDay' | 'listWeek'

/** En dessous, un bloc n'a la place que d'une ligne. */
const MINUTES_BLOC_COMPACT = 45

/** Référence stable : sans elle, la semaine se recalcule à chaque rendu. */
const AUCUNE_TACHE: TachePlanning[] = []

export default function VuePlanning({ personnes, moi, onSaisir }: VuePlanningProps) {
  const sombre = useThemeSombre()
  const calendrier = useRef<FullCalendar>(null)

  const [vue, setVue] = useState<Vue>('timeGridWeek')
  const [ancre, setAncre] = useState(jourCourant())
  const [personneId, setPersonneId] = useState<number | 'toutes'>(moi)
  const [titre, setTitre] = useState('')
  const [pdfEnCours, setPdfEnCours] = useState(false)
  const grille = useRef<HTMLDivElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['plannings', 'planning', ancre, personneId],
    queryFn: async () =>
      (await planningApi.taches({
        // Un mois de marge de part et d'autre : la grille affiche parfois les
        // derniers jours du mois précédent, et une semaine qui déborde ne doit
        // pas apparaître vide.
        debut: decalerJours(ancre, -40),
        fin: decalerJours(ancre, 40),
        ...(personneId === 'toutes' ? {} : { personneIds: [personneId] }),
      })).data.data,
  })

  const taches = data?.taches ?? AUCUNE_TACHE

  const evenements = useMemo(
    () =>
      taches.map((tache) => {
        const couleur = couleurDe(tache.categorie?.couleur, sombre)
        const titreTache = tache.categorie?.nom ?? 'Sans catégorie'
        const commun = {
          id: String(tache.id),
          title: personneId === 'toutes' ? `${titreTache} — ${tache.titulaire.nom}` : titreTache,
          backgroundColor: couleur,
          borderColor: couleur,
          textColor: encreSur(couleur),
          extendedProps: { tache },
        }

        // Une tâche sans horaires — « deux heures, je ne sais plus quand » —
        // n'a pas de place dans une grille horaire : elle se pose sur la
        // journée entière plutôt qu'à une heure inventée.
        if (!tache.heureDebut || !tache.heureFin) {
          return { ...commun, start: tache.jour, allDay: true }
        }

        // Une tâche de nuit finit le lendemain : sans ce report, FullCalendar
        // la dessinerait à l'envers, de 2 h à 22 h.
        const finLendemain = tache.heureFin < tache.heureDebut
        return {
          ...commun,
          start: `${tache.jour}T${tache.heureDebut}:00`,
          end: `${finLendemain ? decalerJours(tache.jour, 1) : tache.jour}T${tache.heureFin}:00`,
        }
      }),
    [taches, sombre, personneId]
  )

  /**
   * Le total de chaque journée, pour le porter dans l'en-tête de colonne.
   *
   * Sur une personne, c'est **son** temps ; sur tout le monde, le temps
   * mobilisé. C'est la même règle que dans « Ma semaine » : afficher les heures
   * des collègues dans la colonne de quelqu'un gonflerait son total sans qu'il
   * comprenne pourquoi.
   */
  const minutesParJour = useMemo(() => {
    const parJour = new Map<string, number>()
    for (const tache of taches) {
      const minutes = personneId === 'toutes' ? tache.minutesMobilisees : minutesDe(tache, personneId)
      if (minutes > 0) parJour.set(tache.jour, (parJour.get(tache.jour) ?? 0) + minutes)
    }
    return parJour
  }, [taches, personneId])

  /** Les catégories présentes à l'écran, pour la légende. */
  const legende = useMemo(() => {
    const parNom = new Map<string, { nom: string; couleur: string; minutes: number }>()
    for (const tache of taches) {
      const nom = tache.categorie?.nom ?? 'Sans catégorie'
      const entree = parNom.get(nom)
        ?? { nom, couleur: couleurDe(tache.categorie?.couleur, sombre), minutes: 0 }
      entree.minutes += tache.minutes
      parNom.set(nom, entree)
    }
    return [...parNom.values()].sort((a, b) => b.minutes - a.minutes)
  }, [taches, sombre])

  // La ligne « Sans horaire » n'occupe la place que si quelque chose s'y range :
  // le reste du temps, elle prend une bande vide en haut de chaque semaine.
  const aDesTachesSansHoraire = taches.some((t) => !t.heureDebut || !t.heureFin)

  /**
   * Le PDF ne reçoit que les tâches de la période affichée.
   *
   * La requête en charge quarante jours de part et d'autre, pour que la
   * navigation soit instantanée ; les verser telles quelles dans le document
   * produirait trois mois de détail sous une grille d'une seule semaine.
   */
  const exporterPdf = async () => {
    setPdfEnCours(true)
    try {
      const api = calendrier.current?.getApi()
      const debut = api ? jourCourant(api.view.activeStart) : ancre
      // `activeEnd` est exclusif : le dernier jour affiché est la veille.
      const fin = api ? decalerJours(jourCourant(api.view.activeEnd), -1) : ancre
      const visibles = taches.filter((t) => t.jour >= debut && t.jour <= fin)

      await exporterPlanningPdf({
        grille: grille.current,
        taches: visibles,
        periode: titre || `${debut} – ${fin}`,
        perimetre:
          personneId === 'toutes'
            ? 'Tout le monde'
            : personnes.find((p) => p.id === personneId)?.nom ?? 'Une personne',
        minutesParJour: new Map(
          [...minutesParJour.entries()].filter(([jour]) => jour >= debut && jour <= fin)
        ),
      })
    } catch {
      toast.error("Le PDF n'a pas pu être produit.")
    } finally {
      setPdfEnCours(false)
    }
  }

  const deplacer = (sens: 1 | -1) => {
    const api = calendrier.current?.getApi()
    if (!api) return
    sens === 1 ? api.next() : api.prev()
    setAncre(jourCourant(api.getDate()))
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        {/* ------------------------------------------------------ la barre */}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 sm:gap-2">
            <Button variant="ghost" size="icon" aria-label="Période précédente" onClick={() => deplacer(-1)}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="min-w-[10rem] text-center font-medium capitalize text-gray-900 dark:text-white sm:min-w-[11rem]">
              {titre}
            </span>
            <Button variant="ghost" size="icon" aria-label="Période suivante" onClick={() => deplacer(1)}>
              <ChevronRight className="h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                calendrier.current?.getApi().today()
                setAncre(jourCourant())
              }}
            >
              Aujourd'hui
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<FileDown className="h-4 w-4" />}
              loading={pdfEnCours}
              onClick={exporterPdf}
            >
              PDF
            </Button>
            {personnes.length > 1 && (
              <Select
                value={personneId}
                onChange={(e) =>
                  setPersonneId(e.target.value === 'toutes' ? 'toutes' : Number(e.target.value))
                }
                options={[
                  { value: 'toutes', label: 'Tout le monde' },
                  ...personnes.map((p) => ({ value: p.id, label: p.id === moi ? `${p.nom} (moi)` : p.nom })),
                ]}
                className="w-auto"
              />
            )}
            <Select
              value={vue}
              onChange={(e) => {
                const choisie = e.target.value as Vue
                setVue(choisie)
                calendrier.current?.getApi().changeView(choisie)
              }}
              options={[
                { value: 'timeGridWeek', label: 'Semaine' },
                { value: 'timeGridDay', label: 'Jour' },
                { value: 'listWeek', label: 'Liste' },
              ]}
              className="w-auto"
            />
          </div>
        </div>

        {isLoading && <LoadingInline message="Chargement du planning…" />}

        {/* ----------------------------------------------------- la grille */}

        <div ref={grille} className="planning-grille h-[38rem]">
          <FullCalendar
            ref={calendrier}
            plugins={[timeGridPlugin, dayGridPlugin, listPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            locale={frLocale}
            headerToolbar={false}
            events={evenements}
            height="100%"
            allDaySlot={aDesTachesSansHoraire}
            allDayText="Sans horaire"
            nowIndicator
            // Les journées d'une commune commencent tôt et finissent tard :
            // cadrer sur 6 h – 21 h évite de faire défiler pour trouver 7 h 30.
            slotMinTime="06:00:00"
            slotMaxTime="21:00:00"
            // Un créneau par heure, et non par demi-heure : avec trente lignes,
            // la journée ne tenait pas dans la carte et l'après-midi se trouvait
            // sous la ligne de flottaison.
            slotDuration="01:00:00"
            scrollTime="06:00:00"
            expandRows
            // Deux tâches à la même heure se partagent la largeur au lieu de se
            // recouvrir : c'est ce qui rendait le libellé de dessous illisible.
            slotEventOverlap={false}
            // Au-dela de deux taches sur le meme creneau, la colonne ne laisse
            // plus quarante pixels a chacune et aucun libelle n’y tient. Le
            // troisieme et les suivants se replient donc derriere un « +N » qui
            // les ouvre en liste : mieux vaut dire qu’il y en a d’autres que
            // les afficher illisibles.
            eventMaxStack={2}
            moreLinkClick="popover"
            moreLinkText={(n) => `+${n}`}
            weekends
            editable={false}
            selectable
            dateClick={(info) => onSaisir({ jour: info.dateStr.slice(0, 10) })}
            eventClick={(info) => onSaisir({ tache: info.event.extendedProps.tache as TachePlanning })}
            datesSet={(info) => setTitre(info.view.title)}
            eventTimeFormat={{ hour: '2-digit', minute: '2-digit', meridiem: false, hour12: false }}
            slotLabelFormat={{ hour: '2-digit', minute: '2-digit', meridiem: false, hour12: false }}
            noEventsText="Aucune heure saisie sur cette période"
            dayHeaderContent={(arg) => enTeteDeJour(arg, minutesParJour)}
            eventContent={(arg) => blocDeTache(arg, personneId === 'toutes')}
          />
        </div>

        {/* ---------------------------------------------------- la légende */}

        {legende.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-gray-100 pt-3 dark:border-gray-700">
            {legende.map((entree) => (
              <span key={entree.nom} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
                <span
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: entree.couleur }}
                  aria-hidden
                />
                {entree.nom}
                <span className="text-gray-500 dark:text-gray-400">{formaterDuree(entree.minutes)}</span>
              </span>
            ))}
          </div>
        ) : (
          !isLoading && (
            <div className="flex flex-wrap items-center justify-center gap-3 border-t border-gray-100 pt-4 text-center dark:border-gray-700">
              <span className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                <CalendarOff className="h-4 w-4" />
                Rien de saisi sur cette période.
              </span>
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => onSaisir({})}>
                Saisir du temps
              </Button>
            </div>
          )
        )}
      </CardBody>
    </Card>
  )
}

/**
 * L'en-tête d'une colonne : le jour, et ce qu'il totalise.
 *
 * Le total là plutôt qu'ailleurs parce que c'est la question qu'on se pose en
 * regardant une colonne — « combien, ce mardi ? » — et qu'il faudrait sinon
 * additionner les blocs de tête.
 */
function enTeteDeJour(arg: any, minutesParJour: Map<string, number>) {
  // La vue liste a ses propres en-têtes de journée, et son propre rendu de
  // ligne : on la laisse tranquille. `true` rend la main à FullCalendar ;
  // `undefined` effacerait le contenu au lieu de le laisser être — la liste
  // s'est retrouvée avec des bandeaux de date vides.
  if (arg.view.type === 'listWeek') return true

  const minutes = minutesParJour.get(jourCourant(arg.date)) ?? 0

  return (
    <div className="flex flex-col items-center py-1 leading-tight">
      <span className={arg.isToday ? 'font-semibold text-primary-600 dark:text-primary-400' : ''}>
        {arg.text}
      </span>
      <span
        className={
          minutes > 0
            ? 'text-xs font-medium text-gray-700 dark:text-gray-300'
            : 'text-xs text-gray-400 dark:text-gray-600'
        }
      >
        {minutes > 0 ? formaterDuree(minutes) : '—'}
      </span>
    </div>
  )
}

/**
 * Ce qu'un bloc affiche, selon la place dont il dispose.
 *
 * **Le libellé s'enroule, il ne se tronque pas.** Trois tâches qui se partagent
 * une colonne laissent chacune une soixantaine de pixels de large : sur une
 * seule ligne, « Entretien du matériel » devenait « En… », et la grille ne
 * disait plus rien de ce qu'on y avait fait. En hauteur, en revanche, la place
 * ne manque pas — une tâche d'une heure et demie fait près de quatre-vingts
 * pixels. Le texte occupe donc deux ou trois lignes, et c'est le nombre de
 * lignes, borné par la durée, qui l'arrête.
 *
 * Sous trois quarts d'heure il n'y a plus de hauteur non plus : le bloc se
 * réduit à une ligne, et la couleur renvoie à la légende. Le détail complet
 * reste au survol et au clic dans les deux cas.
 */
function blocDeTache(arg: any, avecTitulaire: boolean) {
  // La vue liste présente déjà l'heure, la pastille et le titre en colonnes :
  // y plaquer la mise en forme d'un bloc de grille la défigurerait.
  if (arg.view.type === 'listWeek') return true

  const tache = arg.event.extendedProps.tache as TachePlanning
  const categorie = tache.categorie?.nom ?? 'Sans catégorie'
  const compact = tache.minutes < MINUTES_BLOC_COMPACT

  // Deux lignes de titre, trois à partir de deux heures : au-delà, le titre
  // mangerait la ligne de la durée, qui est ce qu'on vient lire ensuite.
  const lignes = tache.minutes >= 120 ? 3 : 2

  const infobulle = [
    `${categorie} — ${formaterDuree(tache.minutes)}`,
    tache.heureDebut && tache.heureFin ? `${tache.heureDebut} – ${tache.heureFin}` : null,
    avecTitulaire ? `Par ${tache.titulaire.nom}` : null,
    tache.description,
    tache.manifestation?.titre,
    tache.participants.length > 0
      ? `Avec ${tache.participants
          .map((p) => `${p.personne?.nom ?? p.libelle} (${formaterDuree(p.minutes)})`)
          .join(', ')}`
      : null,
    tache.participants.length > 0 ? `${formaterDuree(tache.minutesMobilisees)} mobilisées` : null,
  ]
    .filter(Boolean)
    .join('\n')

  if (compact) {
    return (
      <div
        className="flex items-baseline gap-1 overflow-hidden px-1 text-[11px] leading-none"
        title={infobulle}
      >
        <span className="truncate font-medium">{categorie}</span>
        <span className="flex-shrink-0 opacity-90">{formaterDuree(tache.minutes)}</span>
      </div>
    )
  }

  return (
    <div className="overflow-hidden px-1 py-0.5 leading-tight" title={infobulle}>
      {/*
       * Le retour à la ligne se fait **entre les mots**, jamais à l'intérieur :
       * « Livraison » coupé en « Livr / aison » se lit plus mal que tronqué net.
       * Un mot trop long pour la colonne déborde donc, et c'est `overflow`
       * qui l'arrête ; les autres s'empilent sur le nombre de lignes que la
       * durée autorise.
       *
       * Pas de `h-full` ici : `.fc-event-main` ne donne pas toujours de hauteur
       * à son enfant, et le titre se retrouvait à zéro pixel — les blocs
       * étroits n'affichaient plus que leur durée.
       */}
      <div
        className="text-xs font-medium"
        style={{
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: lignes,
          overflow: 'hidden',
          overflowWrap: 'normal',
          wordBreak: 'normal',
        }}
      >
        {categorie}
      </div>

      <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] opacity-90">
        <span>{formaterDuree(tache.minutes)}</span>
        {tache.participants.length > 0 && (
          <span className="inline-flex items-center gap-0.5" title="Temps total mobilisé">
            <Users className="h-3 w-3" />
            {formaterDuree(tache.minutesMobilisees)}
          </span>
        )}
      </div>

      {avecTitulaire && <div className="truncate text-[11px] opacity-90">{tache.titulaire.nom}</div>}
    </div>
  )
}

/**
 * Le temps d'une personne sur une tâche : le sien, qu'elle en soit titulaire ou
 * qu'elle y ait seulement prêté main-forte. Jamais la durée totale.
 */
function minutesDe(tache: TachePlanning, personneId: number): number {
  if (tache.titulaire.id === personneId) return tache.minutes
  return tache.participants.find((p) => p.personne?.id === personneId)?.minutes ?? 0
}
