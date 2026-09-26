import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Check, Pencil, Plus, RotateCcw, X } from 'lucide-react'
import { Button, Modal, ModalBody, ModalFooter } from '@/components/ui'
import { useAccueil, useFavoris, MAX_ACTIONS, type BlocAffiche, type Favori, type IdAction } from '@/lib/accueil'
import { useActionsRapides } from '@/components/QuickActions'
import { cn } from '@/lib/utils'
import { TYPES_FAVORI, nomFavori } from './MesFavoris'

interface PanneauPersonnalisationProps {
  ouvert: boolean
  onFermer: () => void
}

/**
 * Composer son accueil : quels blocs, dans quel ordre ; quelles actions
 * rapides ; ses favoris et raccourcis.
 *
 * Des flèches plutôt qu'un glisser-déposer : elles marchent au doigt, au
 * clavier et au lecteur d'écran, sans bibliothèque de plus. Chaque geste est
 * enregistré tout de suite, sur le compte : rien à valider, rien à perdre.
 */
export default function PanneauPersonnalisation({ ouvert, onFermer }: PanneauPersonnalisationProps) {
  const { blocs, actions, enregistrer, personnalise } = useAccueil()

  return (
    <Modal isOpen={ouvert} onClose={onFermer} title="Personnaliser mon tableau de bord" size="lg">
      <ModalBody className="space-y-8">
        <SectionBlocs blocs={blocs} onChanger={(b) => enregistrer({ blocs: b.map(({ id, visible }) => ({ id, visible })) })} />
        <SectionActions actions={actions} onChanger={(a) => enregistrer({ actions: a })} />
        <SectionFavoris />
      </ModalBody>
      <ModalFooter className="flex flex-wrap justify-between gap-2 dark:bg-gray-900/40 dark:border-gray-700">
        <Button
          variant="ghost"
          icon={<RotateCcw className="w-4 h-4" />}
          disabled={!personnalise}
          onClick={() => enregistrer({ blocs: null, actions: null })}
        >
          Disposition d'origine
        </Button>
        <Button onClick={onFermer}>Terminé</Button>
      </ModalFooter>
    </Modal>
  )
}

// ------------------------------------------------------------------ briques

function Section({ titre, aide, children }: { titre: string; aide: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="font-semibold text-gray-900 dark:text-gray-100">{titre}</h3>
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">{aide}</p>
      {children}
    </section>
  )
}

function Fleches({
  nom,
  premier,
  dernier,
  onMonter,
  onDescendre,
}: {
  nom: string
  premier: boolean
  dernier: boolean
  onMonter: () => void
  onDescendre: () => void
}) {
  const classe =
    'flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-gray-300 dark:hover:bg-gray-700'
  return (
    <>
      <button type="button" className={classe} disabled={premier} onClick={onMonter} aria-label={`Monter ${nom}`} title="Monter">
        <ArrowUp className="h-4 w-4" />
      </button>
      <button type="button" className={classe} disabled={dernier} onClick={onDescendre} aria-label={`Descendre ${nom}`} title="Descendre">
        <ArrowDown className="h-4 w-4" />
      </button>
    </>
  )
}

/** Échange deux éléments d'une liste, sans la modifier. */
function echanger<T>(liste: T[], i: number, j: number): T[] {
  const copie = [...liste]
  ;[copie[i], copie[j]] = [copie[j], copie[i]]
  return copie
}

// ------------------------------------------------------------------ les blocs

function SectionBlocs({ blocs, onChanger }: { blocs: BlocAffiche[]; onChanger: (b: BlocAffiche[]) => void }) {
  // Les blocs d'un module inactif gardent leur place, sans être proposés.
  const proposes = blocs.map((b, index) => ({ b, index })).filter(({ b }) => b.disponible)

  const deplacer = (rang: number, sens: -1 | 1) => {
    const voisin = proposes[rang + sens]
    if (!voisin) return
    onChanger(echanger(blocs, proposes[rang].index, voisin.index))
  }

  return (
    <Section titre="Blocs" aide="Cochez ce que vous voulez voir, et rangez-le dans l'ordre qui vous convient.">
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
        {proposes.map(({ b, index }, rang) => (
          <li key={b.id} className="flex items-center gap-2 px-2">
            <label className="flex min-h-[52px] flex-1 cursor-pointer items-center gap-3 px-1">
              <input
                type="checkbox"
                className="h-5 w-5 rounded border-gray-300 text-primary-600"
                checked={b.visible}
                onChange={() => onChanger(blocs.map((x, i) => (i === index ? { ...x, visible: !x.visible } : x)))}
              />
              <span className="min-w-0">
                <span className={cn('block font-medium', b.visible ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400')}>
                  {b.libelle}
                </span>
                <span className="block truncate text-sm text-gray-500 dark:text-gray-400">{b.description}</span>
              </span>
            </label>
            <Fleches
              nom={b.libelle}
              premier={rang === 0}
              dernier={rang === proposes.length - 1}
              onMonter={() => deplacer(rang, -1)}
              onDescendre={() => deplacer(rang, 1)}
            />
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ------------------------------------------------------------------ les actions

function SectionActions({ actions, onChanger }: { actions: IdAction[]; onChanger: (a: IdAction[]) => void }) {
  const catalogue = useActionsRapides(() => {}).filter((a) => a.visible)
  const choisies = actions.filter((id) => catalogue.some((a) => a.id === id))
  const libelle = (id: IdAction) => catalogue.find((a) => a.id === id)?.libelle ?? id
  const restantes = catalogue.filter((a) => !choisies.includes(a.id))
  const plein = choisies.length >= MAX_ACTIONS

  return (
    <Section
      titre="Actions rapides"
      aide={`Les tuiles en haut de l'accueil : ${MAX_ACTIONS} au plus, pour les gestes que vous faites chaque jour.`}
    >
      <ul className="mb-3 divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
        {choisies.length === 0 && <li className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">Aucune tuile : la rangée est masquée.</li>}
        {choisies.map((id, rang) => (
          <li key={id} className="flex items-center gap-2 px-2">
            <span className="min-h-[52px] flex-1 px-1 py-3 font-medium text-gray-900 dark:text-gray-100">{libelle(id)}</span>
            <Fleches
              nom={libelle(id)}
              premier={rang === 0}
              dernier={rang === choisies.length - 1}
              onMonter={() => onChanger(echanger(choisies, rang, rang - 1))}
              onDescendre={() => onChanger(echanger(choisies, rang, rang + 1))}
            />
            <button
              type="button"
              onClick={() => onChanger(choisies.filter((x) => x !== id))}
              aria-label={`Retirer la tuile ${libelle(id)}`}
              title="Retirer"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      {restantes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {restantes.map((a) => (
            <Button
              key={a.id}
              size="sm"
              variant="outline"
              icon={<Plus className="w-4 h-4" />}
              disabled={plein}
              title={plein ? `Retirez d'abord une tuile : ${MAX_ACTIONS} au plus` : undefined}
              onClick={() => onChanger([...choisies, a.id])}
            >
              {a.libelle}
            </Button>
          ))}
        </div>
      )}
    </Section>
  )
}

// ------------------------------------------------------------------ les favoris

function SectionFavoris() {
  const { favoris, retirer, reordonner, renommer } = useFavoris()
  const [enEdition, setEnEdition] = useState<number | null>(null)
  const [saisie, setSaisie] = useState('')

  const commencer = (f: Favori) => {
    setEnEdition(f.id)
    setSaisie(f.libellePerso ?? f.libelle ?? '')
  }
  const valider = (f: Favori) => {
    const nom = saisie.trim()
    // Un raccourci garde toujours un nom ; une fiche reprend le sien si on vide le champ.
    if (f.type === 'lien' && !nom) return
    renommer({ id: f.id, libelle: nom || null })
    setEnEdition(null)
  }

  return (
    <Section
      titre="Favoris et raccourcis"
      aide="Renommez-les, rangez-les, ou retirez ceux dont vous n'avez plus besoin."
    >
      {favoris.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Aucun favori pour l'instant : touchez l'étoile d'une fiche, ou ajoutez une page depuis le menu de votre nom.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {favoris.map((f, rang) => {
            const { icone: Icone, libelle: type } = TYPES_FAVORI[f.type]
            const ids = favoris.map((x) => x.id)
            return (
              <li key={f.id} className="flex items-center gap-2 px-2">
                <Icone className="ml-1 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" aria-label={type} />
                {enEdition === f.id ? (
                  <form
                    className="flex min-h-[52px] flex-1 items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      valider(f)
                    }}
                  >
                    <input
                      autoFocus
                      value={saisie}
                      maxLength={120}
                      onChange={(e) => setSaisie(e.target.value)}
                      onKeyDown={(e) => e.key === 'Escape' && setEnEdition(null)}
                      aria-label="Nouveau nom"
                      placeholder={f.type === 'lien' ? 'Nom du raccourci' : 'Vide : reprendre le nom de la fiche'}
                      className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    />
                    <button
                      type="submit"
                      aria-label="Enregistrer le nom"
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  </form>
                ) : (
                  <>
                    <span className={cn('min-h-[52px] min-w-0 flex-1 truncate px-1 py-3', f.disponible ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400')}>
                      {nomFavori(f)}
                    </span>
                    {f.disponible && (
                      <button
                        type="button"
                        onClick={() => commencer(f)}
                        aria-label={`Renommer ${nomFavori(f)}`}
                        title="Renommer"
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                  </>
                )}
                <Fleches
                  nom={nomFavori(f)}
                  premier={rang === 0}
                  dernier={rang === favoris.length - 1}
                  onMonter={() => reordonner(echanger(ids, rang, rang - 1))}
                  onDescendre={() => reordonner(echanger(ids, rang, rang + 1))}
                />
                <button
                  type="button"
                  onClick={() => retirer(f.id)}
                  aria-label={`Retirer ${nomFavori(f)}`}
                  title="Retirer"
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
