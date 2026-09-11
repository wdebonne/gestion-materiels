import { useState } from 'react'
import { Crosshair, Filter, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react'
import type { FacettesMobilier, FiltresMobilier } from '@/lib/api'
import { ETATS, SOURCES, STATUTS } from '@/lib/mobilierUrbain'

/**
 * Chercher un mobilier parmi mille.
 *
 * Deux niveaux, et l'ordre n'est pas décoratif. **Le simple** — un mot, une
 * catégorie, un modèle, un statut — répond à ce qu'on demande vingt fois par
 * jour : « montre-moi les candélabres », « qu'est-ce qui est hors service ».
 * Il tient sur une ligne et reste utilisable sur un téléphone tenu d'une main.
 *
 * **L'avancé** est replié, parce qu'il répond à ce qu'on demande une fois par
 * mois : préparer une tournée rue par rue, sortir ce qui n'a jamais été revu
 * depuis la pose, retrouver ce qui traîne à cent mètres d'ici. Le déplier
 * d'office ferait payer à tout le monde le prix d'un besoin occasionnel.
 *
 * Les valeurs proposées viennent de ce qui a **déjà été saisi** (`facettes`) :
 * une rue tapée quatre fois avec quatre casses différentes ferait quatre rues,
 * et le filtre par rue ne vaudrait plus rien. Proposer ce qui existe est le
 * seul moyen de le prévenir sans imposer un référentiel à garnir d'avance.
 */

interface Props {
  filtres: FiltresMobilier
  onChange: (filtres: FiltresMobilier) => void
  facettes?: FacettesMobilier
  /** La position de l'appareil, si elle a été relevée : active « autour de moi ». */
  maPosition?: { lat: number; lng: number } | null
  onRelever?: () => void
  /** Ce que la recherche en cours a trouvé, pour l'annoncer avant de fermer. */
  resultats?: number
}

const CHAMP =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'
const LIBELLE = 'mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400'

/** Les rayons qui ont un sens à pied : le trottoir, la rue, le quartier. */
const RAYONS = [
  { valeur: '100', libelle: '100 m' },
  { valeur: '300', libelle: '300 m' },
  { valeur: '1000', libelle: '1 km' },
]

export default function FiltresMobilier({
  filtres,
  onChange,
  facettes,
  maPosition,
  onRelever,
  resultats,
}: Props) {
  const [avance, setAvance] = useState(false)

  const poser = (partiel: Partial<FiltresMobilier>) => onChange({ ...filtres, ...partiel })

  /**
   * Le nombre de critères posés, hors recherche libre.
   *
   * Affiché sur le bouton parce qu'un filtre replié est un filtre oublié : la
   * liste paraît alors incomplète, et la réponse « il n'y a rien » est fausse.
   */
  const poses = [
    filtres.source,
    filtres.green_space_id,
    filtres.condition_state,
    filtres.street,
    filtres.sector,
    filtres.pose_du,
    filtres.pose_au,
    filtres.echeance_avant,
    filtres.en_retard,
    filtres.jamais_entretenu,
    filtres.avec_deposes,
    filtres.rayon,
  ].filter(Boolean).length

  const toutEffacer = () => onChange({})
  const quelqueChose = Object.values(filtres).some((v) => v !== undefined && v !== '')

  return (
    <div className="space-y-3">
      {/* Ligne simple */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[200px] flex-1 basis-56 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={filtres.q ?? ''}
            onChange={(e) => poser({ q: e.target.value })}
            placeholder="Nom, code, rue, modèle…"
            className={`${CHAMP} pl-9`}
          />
        </div>

        <select
          value={filtres.category_id ?? ''}
          onChange={(e) => poser({ category_id: e.target.value })}
          className={`${CHAMP} w-auto min-w-[150px] flex-1 sm:max-w-[220px]`}
          aria-label="Catégorie"
        >
          <option value="">Toutes les catégories</option>
          {(facettes?.categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nom} ({c.cnt})
            </option>
          ))}
        </select>

        <select
          value={filtres.object_id ?? ''}
          onChange={(e) => poser({ object_id: e.target.value })}
          className={`${CHAMP} w-auto min-w-[150px] flex-1 sm:max-w-[220px]`}
          aria-label="Modèle de matériel"
        >
          <option value="">Tous les matériels</option>
          {(facettes?.modeles ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.nom} ({m.cnt})
            </option>
          ))}
        </select>

        {/*
          « Où » plutôt que « quoi ».

          La carte montre par défaut **les deux** gisements : c'est le sens même
          de l'écran, un banc est un banc qu'il soit sur un trottoir ou dans un
          parc. Mais préparer une tournée de voirie, ou lister ce qui relève des
          espaces verts, sont deux demandes réelles — d'où ce choix, au premier
          rang et non replié.
        */}
        <select
          value={filtres.source ?? ''}
          onChange={(e) => poser({ source: e.target.value })}
          className={`${CHAMP} w-auto min-w-[140px] flex-1 sm:max-w-[170px]`}
          aria-label="Où"
        >
          <option value="">Partout</option>
          {SOURCES.map((s) => (
            <option key={s.valeur} value={s.valeur}>
              {s.icone} {s.libelle}
            </option>
          ))}
        </select>

        <select
          value={filtres.status ?? ''}
          onChange={(e) => poser({ status: e.target.value })}
          className={`${CHAMP} w-auto min-w-[140px] flex-1 sm:max-w-[180px]`}
          aria-label="Statut"
        >
          <option value="">Tous les statuts</option>
          {STATUTS.map((s) => (
            <option key={s.valeur} value={s.valeur}>
              {s.libelle}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setAvance((v) => !v)}
          className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
            avance || poses > 0
              ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filtres
          {poses > 0 && (
            <span className="rounded-full bg-primary-600 px-1.5 text-xs text-white">{poses}</span>
          )}
        </button>

        {quelqueChose && (
          <button
            type="button"
            onClick={toutEffacer}
            title="Tout effacer"
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-3 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <RotateCcw className="h-4 w-4" />
            Effacer
          </button>
        )}
      </div>

      {/* Panneau avancé */}
      {avance && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
              <Filter className="h-4 w-4" />
              Recherche avancée
              {resultats !== undefined && (
                <span className="font-normal text-gray-500 dark:text-gray-400">
                  — {resultats} résultat{resultats > 1 ? 's' : ''}
                </span>
              )}
            </h4>
            <button
              type="button"
              onClick={() => setAvance(false)}
              aria-label="Replier la recherche avancée"
              className="rounded p-1 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={LIBELLE}>État physique</label>
              <select
                value={filtres.condition_state ?? ''}
                onChange={(e) => poser({ condition_state: e.target.value })}
                className={CHAMP}
              >
                <option value="">Tous les états</option>
                {ETATS.map((e) => (
                  <option key={e.valeur} value={e.valeur}>
                    {e.libelle}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LIBELLE}>Rue</label>
              <input
                list="carto-rues"
                value={filtres.street ?? ''}
                onChange={(e) => poser({ street: e.target.value })}
                placeholder="Toutes les rues"
                className={CHAMP}
              />
              <datalist id="carto-rues">
                {(facettes?.rues ?? []).map((r) => (
                  <option key={r.valeur} value={r.valeur}>
                    {r.cnt}
                  </option>
                ))}
              </datalist>
            </div>

            <div>
              <label className={LIBELLE}>Zone / secteur</label>
              <input
                list="carto-secteurs"
                value={filtres.sector ?? ''}
                onChange={(e) => poser({ sector: e.target.value })}
                placeholder="Toutes les zones"
                className={CHAMP}
              />
              <datalist id="carto-secteurs">
                {(facettes?.secteurs ?? []).map((s) => (
                  <option key={s.valeur} value={s.valeur}>
                    {s.cnt}
                  </option>
                ))}
              </datalist>
              {/* Un élément de parc n'a pas de rue : il a un parc. Filtrer par
                  rue écarte donc les espaces verts, et mieux vaut l'annoncer
                  que laisser croire à une liste incomplète. */}
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                Rue et zone ne concernent que la voie publique.
              </p>
            </div>

            <div>
              <label className={LIBELLE}>Espace vert</label>
              <select
                value={filtres.green_space_id ?? ''}
                onChange={(e) => poser({ green_space_id: e.target.value })}
                className={CHAMP}
              >
                <option value="">Tous les espaces verts</option>
                {(facettes?.espaces_verts ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nom} ({e.cnt})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LIBELLE}>Entretien prévu avant le</label>
              <input
                type="date"
                value={filtres.echeance_avant ?? ''}
                onChange={(e) => poser({ echeance_avant: e.target.value })}
                className={CHAMP}
              />
            </div>

            <div>
              <label className={LIBELLE}>Posé à partir du</label>
              <input
                type="date"
                value={filtres.pose_du ?? ''}
                onChange={(e) => poser({ pose_du: e.target.value })}
                className={CHAMP}
              />
            </div>

            <div>
              <label className={LIBELLE}>Posé jusqu’au</label>
              <input
                type="date"
                value={filtres.pose_au ?? ''}
                onChange={(e) => poser({ pose_au: e.target.value })}
                className={CHAMP}
              />
            </div>

            {/* « Autour de moi » : la question du terrain, qui n'a de sens
                qu'une fois la position connue. */}
            <div className="sm:col-span-2">
              <label className={LIBELLE}>Autour de moi</label>
              {maPosition ? (
                <div className="flex gap-2">
                  {RAYONS.map((r) => (
                    <button
                      key={r.valeur}
                      type="button"
                      onClick={() =>
                        poser({
                          rayon: filtres.rayon === r.valeur ? '' : r.valeur,
                          lat: String(maPosition.lat),
                          lng: String(maPosition.lng),
                        })
                      }
                      className={`flex-1 rounded-lg border px-2 py-2 text-sm transition-colors ${
                        filtres.rayon === r.valeur
                          ? 'border-sky-500 bg-sky-50 font-medium text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      {r.libelle}
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onRelever}
                  disabled={!onRelever}
                  className="inline-flex min-h-[38px] w-full items-center justify-center gap-2 rounded-lg border border-sky-500 px-3 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:text-sky-400 dark:hover:bg-sky-900/30"
                >
                  <Crosshair className="h-4 w-4" />
                  Relever ma position
                </button>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-4 border-t border-gray-200 pt-3 dark:border-gray-700">
            <Case
              coche={filtres.en_retard === '1'}
              onChange={(v) => poser({ en_retard: v ? '1' : '' })}
              libelle="Entretien en retard"
            />
            <Case
              coche={filtres.jamais_entretenu === '1'}
              onChange={(v) => poser({ jamais_entretenu: v ? '1' : '' })}
              libelle="Jamais entretenu depuis la pose"
            />
            <Case
              coche={filtres.avec_deposes === '1'}
              onChange={(v) => poser({ avec_deposes: v ? '1' : '' })}
              libelle="Inclure le mobilier déposé"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function Case({
  coche,
  onChange,
  libelle,
}: {
  coche: boolean
  onChange: (valeur: boolean) => void
  libelle: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
      <input
        type="checkbox"
        checked={coche}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-primary-600"
      />
      {libelle}
    </label>
  )
}
