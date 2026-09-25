import { Clock, Plus, UserPlus, Users, X } from 'lucide-react'
import { Button, Input, Select } from '@/components/ui'
import { ajouterMinutes, decalerJours, formaterDuree, jourCourant, jourEnFrancais, minutesEntre } from '@/lib/duree'
import { cn } from '@/lib/utils'

/**
 * Les morceaux d'une saisie d'heures, partagés par le planning et la clôture
 * d'une demande.
 *
 * « Mettre le temps passé et s'il a été aidé, comme sur le planning » : c'est
 * littéralement le même formulaire, et il doit le rester. Deux copies
 * finiraient par ne plus compter pareil un renfort sans durée.
 */

export interface RenfortSaisi {
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

export const DUREES_RAPIDES = [30, 60, 120, 240]

/** La durée entre deux heures, ou `null` tant que la saisie ne permet pas de la dire. */
export function dureeEntre(heureDebut: string, heureFin: string): number | null {
  if (!heureDebut || !heureFin) return null
  try {
    return minutesEntre(heureDebut, heureFin)
  } catch {
    return null
  }
}

/** Les renforts d'une tâche lue, remis en lignes de saisie. */
export function renfortsDepuis(
  participants: { personne: { id: number } | null; libelle: string | null; minutes: number }[]
): RenfortSaisi[] {
  return participants.map((p, index) => ({
    cle: index,
    nomme: Boolean(p.personne),
    userId: p.personne?.id ?? null,
    libelle: p.libelle ?? '',
    minutes: p.minutes,
  }))
}

/** Les renforts tels que le serveur les attend ; sans durée, le renfort a fait la tâche entière. */
export function participantsDepuis(renforts: RenfortSaisi[], minutes: number | null) {
  return renforts.map((r) => ({
    userId: r.nomme ? r.userId : null,
    libelle: r.nomme ? null : r.libelle.trim(),
    minutes: r.minutes ?? minutes,
  }))
}

export function renfortsComplets(renforts: RenfortSaisi[]): boolean {
  return renforts.every((r) => (r.nomme ? r.userId != null : r.libelle.trim().length > 0))
}

/** Le jour, les heures, et les durées rapides. */
export function ChampsQuand({
  jour,
  heureDebut,
  heureFin,
  onJour,
  onHeureDebut,
  onHeureFin,
}: {
  jour: string
  heureDebut: string
  heureFin: string
  onJour: (v: string) => void
  onHeureDebut: (v: string) => void
  onHeureFin: (v: string) => void
}) {
  const franchitMinuit = Boolean(heureDebut && heureFin && heureFin < heureDebut)

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Quand</label>
        <div className="flex gap-1">
          <PuceJour libelle="Hier" jour={decalerJours(jourCourant(), -1)} actif={jour} onChoisir={onJour} />
          <PuceJour libelle="Aujourd'hui" jour={jourCourant()} actif={jour} onChoisir={onJour} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input type="date" value={jour} onChange={(e) => onJour(e.target.value)} />
        <Input
          type="time"
          value={heureDebut}
          onChange={(e) => onHeureDebut(e.target.value)}
          aria-label="Heure de début"
        />
        <Input
          type="time"
          value={heureFin}
          onChange={(e) => onHeureFin(e.target.value)}
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
              onHeureDebut(depart)
              onHeureFin(ajouterMinutes(depart, duree))
            }}
            className="min-h-[36px] rounded-full border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {formaterDuree(duree)}
          </button>
        ))}
      </div>

      {franchitMinuit && (
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
          Cette tâche se termine le lendemain, le{' '}
          {jourEnFrancais(decalerJours(jour, 1), { day: 'numeric', month: 'long' })} à {heureFin}.
        </p>
      )}
    </div>
  )
}

/** Les personnes qui ont aidé, nommées ou non, et combien de temps. */
export function RenfortsEditor({
  renforts,
  onChange,
  options,
  minutes,
  titre = "J'étais accompagné",
}: {
  renforts: RenfortSaisi[]
  onChange: (renforts: RenfortSaisi[]) => void
  /** Les personnes proposées, titulaire exclu. */
  options: { value: number; label: string }[]
  /** La durée du titulaire : ce que vaut un renfort sans durée. */
  minutes: number | null
  titre?: string
}) {
  const ajouter = (nomme: boolean) =>
    onChange([
      ...renforts,
      { cle: Date.now() + renforts.length, nomme, userId: null, libelle: '', minutes: null },
    ])
  const maj = (cle: number, champs: Partial<RenfortSaisi>) =>
    onChange(renforts.map((r) => (r.cle === cle ? { ...r, ...champs } : r)))

  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <Users className="h-4 w-4" />
          {titre}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" icon={<UserPlus className="h-4 w-4" />}
            onClick={() => ajouter(true)}>
            Un collègue
          </Button>
          <Button type="button" variant="ghost" size="sm" icon={<Plus className="h-4 w-4" />}
            onClick={() => ajouter(false)}>
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
                  onChange={(e) => maj(renfort.cle, { userId: e.target.value ? Number(e.target.value) : null })}
                  options={options}
                />
              ) : (
                <Input
                  value={renfort.libelle}
                  placeholder="Ex. : un agent des espaces verts"
                  onChange={(e) => maj(renfort.cle, { libelle: e.target.value })}
                />
              )}

              <Input
                type="number"
                min={1}
                max={1440}
                className="sm:w-28"
                value={renfort.minutes ?? minutes ?? ''}
                onChange={(e) => maj(renfort.cle, { minutes: e.target.value ? Number(e.target.value) : null })}
                aria-label="Minutes de participation"
                rightIcon={<span className="text-xs text-gray-500">min</span>}
              />

              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Retirer ce renfort"
                onClick={() => onChange(renforts.filter((r) => r.cle !== renfort.cle))}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Le temps du titulaire, et le travail mobilisé dès qu'un renfort s'ajoute. */
export function TotalTemps({
  minutes,
  renforts,
  pourQui = 'pour vous',
}: {
  minutes: number | null
  renforts: RenfortSaisi[]
  pourQui?: string
}) {
  const mobilisees = minutes == null ? null : renforts.reduce((total, r) => total + (r.minutes ?? minutes), minutes)

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
        minutes == null
          ? 'bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-400'
          : 'bg-primary-50 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200'
      )}
    >
      <Clock className="h-4 w-4 flex-shrink-0" />
      {minutes == null ? (
        <span>Indiquez une heure de début et une heure de fin.</span>
      ) : renforts.length === 0 ? (
        <span>
          <strong>{formaterDuree(minutes)}</strong>
        </span>
      ) : (
        <span>
          <strong>{formaterDuree(minutes)}</strong> {pourQui},{' '}
          <strong>{formaterDuree(mobilisees ?? minutes)}</strong> de travail mobilisé
        </span>
      )}
    </div>
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
