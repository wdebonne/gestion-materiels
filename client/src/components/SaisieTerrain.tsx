import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Minus, Phone, Plus, Truck, RotateCcw, MapPin, AlertTriangle } from 'lucide-react'
import { Alert, Badge, Button, Input, Modal, ModalBody, ModalFooter, Spinner } from '@/components/ui'
import {
  manifestationApi,
  objetManifestationApi,
  type ArretTournee,
  type EtatRetour,
  type LigneTournee,
  type PhaseTournee,
} from '@/lib/api'
import toast from 'react-hot-toast'

/**
 * Ce qu'un agent saisit, debout, sur le hayon du camion.
 *
 * L'ancienne fenêtre demandait quatre nombres par ligne — demandé, livré,
 * récupéré, perdu — quelle que soit l'étape, et ne montrait que le stock : le
 * matériel du parc se pointait ailleurs, dans un autre écran, avec d'autres
 * mots. Il fallait donc savoir laquelle des deux tables portait ses chaises pour
 * savoir où aller les cocher.
 *
 * Ici, une seule question à la fois — *qu'est-ce qui part* ou *qu'est-ce qui
 * rentre* — les deux gisements mêlés, et le cas courant en un geste : tout est
 * parti, tout est rentré. L'écart ne se saisit que quand il existe.
 */

/** Des cibles au pouce, pas à la souris : 44 px est le minimum tenable en gant. */
const CIBLE = 'min-h-[44px] min-w-[44px]'

/** Ce que l'écran retient d'une ligne tant que rien n'est enregistré. */
export interface Saisie {
  /** Quantité constatée sur la phase en cours. */
  fait: number
  /** Ce qui ne reviendra pas : casse, perte, vol. */
  perdu: number
  motif: string
  /** Constat au retour d'un matériel du parc. */
  etat: string
}

const depart = (ligne: LigneTournee, phase: PhaseTournee): Saisie => ({
  fait: phase === 'livraison' ? ligne.livre : ligne.rendu,
  perdu: ligne.perdu,
  motif: '',
  etat: ligne.etat_retour ?? '',
})

/** L'état de départ d'un arrêt : ce que la base sait déjà. */
export const saisiesInitiales = (arret: ArretTournee): Record<string, Saisie> =>
  Object.fromEntries(arret.lignes.map((l) => [l.ref, depart(l, arret.phase)]))

/**
 * Le geste qui couvre neuf cas sur dix : tout ce qui était prévu est parti, tout
 * ce qui était sorti est rentré. Le reste se corrige ligne à ligne.
 *
 * Écrit une fois et appelé des deux côtés — le bouton de la tournée et celui de
 * la fenêtre de saisie — pour qu'un même geste n'ait pas deux effets selon
 * l'endroit d'où on l'a fait.
 */
export const saisiesToutFait = (
  arret: ArretTournee,
  saisies: Record<string, Saisie>
): Record<string, Saisie> =>
  Object.fromEntries(
    arret.lignes.map((l) => [
      l.ref,
      {
        ...saisies[l.ref],
        fait: arret.phase === 'livraison' ? l.demande : l.livre,
        // Rentrer « tout » veut dire qu'il ne manque rien : une perte déjà saisie
        // serait contredite par le geste, et le stock retrouverait une chaise
        // cassée.
        perdu: arret.phase === 'livraison' ? saisies[l.ref].perdu : 0,
        etat:
          arret.phase === 'livraison'
            ? saisies[l.ref].etat
            : l.nature === 'exemplaire'
              ? 'intact'
              : saisies[l.ref].etat,
      },
    ])
  )

/**
 * Porte la saisie aux deux tables du prêt.
 *
 * Le stock part en une écriture, le parc ligne à ligne : c'est la forme des deux
 * routes, et les mêler ici inventerait un lot d'écriture que le serveur ne sait
 * pas défaire en cas d'échec partiel.
 */
export async function enregistrerArret(
  arret: ArretTournee,
  saisies: Record<string, Saisie>
): Promise<void> {
  const livraison = arret.phase === 'livraison'
  const duStock = arret.lignes.filter((l) => l.source === 'stock')
  const duParc = arret.lignes.filter((l) => l.source === 'parc')

  if (duStock.length > 0) {
    await manifestationApi.updateMaterials(
      arret.manifestation_id,
      duStock.map((l) => {
        const s = saisies[l.ref]
        return {
          id: l.ligne_id,
          quantity_delivered: livraison ? s.fait : l.livre,
          quantity_recovered: livraison ? l.rendu : s.fait,
          quantity_lost: s.perdu,
          loss_reason: s.motif || null,
        }
      })
    )
  }

  for (const l of duParc) {
    const s = saisies[l.ref]
    await objetManifestationApi.suivre(arret.manifestation_id, l.ligne_id, {
      ...(livraison ? { delivered_quantity: s.fait } : { returned_quantity: s.fait }),
      ...(livraison ? {} : { return_state: (s.etat || '') as EtatRetour | '' }),
    })
  }
}

/** Les lectures que toute saisie rend caduques : la tournée, la liste, le stock. */
export const CLES_A_RAFRAICHIR = [
  ['tournee'],
  ['manifestations'],
  ['manifestation-objects'],
  ['manifestation-stock'],
  ['manifestation-catalogue'],
  ['manifestation-sorties'],
]

/** Le mot juste selon ce qu'on manipule : on ne « livre » pas un raccordement. */
const verbe = (ligne: LigneTournee, phase: PhaseTournee): string => {
  if (ligne.nature === 'prestation') return 'Réalisée'
  if (phase === 'livraison') return ligne.nature === 'exemplaire' ? 'Sorti' : 'Livrées'
  return ligne.nature === 'exemplaire' ? 'Rentré' : 'Rentrées'
}

const ETATS_RETOUR = [
  { value: 'intact', label: 'Intact' },
  { value: 'abime', label: 'Abîmé' },
  { value: 'perdu', label: 'Perdu' },
]

/**
 * Saisie d'un arrêt déjà chargé — celui que la tournée tient en main.
 */
export default function SaisieTerrain({ arret, modifiable, onClose }: {
  arret: ArretTournee
  /** Un simple lecteur voit l'état des lieux sans pouvoir le corriger. */
  modifiable: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const livraison = arret.phase === 'livraison'

  const [saisies, setSaisies] = useState<Record<string, Saisie>>(() => saisiesInitiales(arret))

  const modifier = (ref: string, champs: Partial<Saisie>) =>
    setSaisies((etat) => ({ ...etat, [ref]: { ...etat[ref], ...champs } }))

  const toutFaire = () => setSaisies((etat) => saisiesToutFait(arret, etat))

  /**
   * Ce qui n'est ni revenu ni expliqué.
   *
   * La même règle que `resteDeLaLigne` côté serveur, et pour la même raison :
   * une prestation ne revient pas, et un exemplaire déclaré perdu est réglé — le
   * laisser en attente ferait chercher chaque matin une remorque qu'on sait
   * volée.
   */
  const ecart = (l: LigneTournee) => {
    if (livraison) return Math.max(0, l.demande - saisies[l.ref].fait)
    if (l.nature === 'prestation') return 0
    const s = saisies[l.ref]
    if (l.nature === 'exemplaire' && s.etat === 'perdu') return 0
    return Math.max(0, l.livre - s.fait - s.perdu)
  }

  const manquants = livraison ? [] : arret.lignes.filter((l) => ecart(l) > 0)

  const restant = arret.lignes.reduce((total, l) => total + ecart(l), 0)

  const enregistrement = useMutation({
    mutationFn: () => enregistrerArret(arret, saisies),
    onSuccess: () => {
      for (const cle of CLES_A_RAFRAICHIR) queryClient.invalidateQueries({ queryKey: cle })
      toast.success(livraison ? 'Chargement enregistré' : 'Retour enregistré')
      onClose()
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  return (
    <Modal isOpen onClose={onClose}
      title={`${livraison ? 'Je livre' : 'Je récupère'} — ${arret.titre}`} size="lg">
      <ModalBody>
        <EnTeteArret arret={arret} />

        {modifiable && (
          <Button className="w-full mt-4" size="lg"
            icon={livraison ? <Truck className="w-5 h-5" /> : <RotateCcw className="w-5 h-5" />}
            onClick={toutFaire}>
            {livraison ? 'Tout est parti' : 'Tout est rentré'}
          </Button>
        )}

        <div className="mt-4 space-y-3">
          {arret.lignes.map((ligne) => (
            <LigneSaisie
              key={ligne.ref}
              ligne={ligne}
              phase={arret.phase}
              saisie={saisies[ligne.ref]}
              modifiable={modifiable}
              ecart={ecart(ligne)}
              onChange={(champs) => modifier(ligne.ref, champs)}
            />
          ))}
        </div>

        {manquants.length > 0 && (
          <Alert type="warning" className="mt-4">
            <span className="text-sm">
              {manquants.length === 1
                ? "Une ligne n'est ni revenue ni déclarée perdue. Tant qu'elle ne l'est pas, " +
                  'le stock la tient pour encore dehors — et personne ne part la chercher.'
                : `${manquants.length} lignes ne sont ni revenues ni déclarées perdues. ` +
                  "Tant qu'elles ne le sont pas, le stock les tient pour encore dehors — " +
                  'et personne ne part les chercher.'}
            </span>
          </Alert>
        )}
      </ModalBody>

      <ModalFooter>
        <div className="flex-1 text-sm text-gray-500 dark:text-gray-400">
          {restant > 0
            ? `Reste ${restant} à ${livraison ? 'charger' : 'rentrer'}`
            : 'Rien ne reste en attente'}
        </div>
        <Button variant="outline" onClick={onClose}>Fermer</Button>
        {modifiable && (
          <Button loading={enregistrement.isPending} onClick={() => enregistrement.mutate()}>
            Enregistrer
          </Button>
        )}
      </ModalFooter>
    </Modal>
  )
}

/** Où l'on va, quand, et qui demander en arrivant. */
function EnTeteArret({ arret }: { arret: ArretTournee }) {
  const heures = [arret.heure_debut, arret.heure_fin].filter(Boolean).join(' → ')

  return (
    <div className="space-y-2">
      {arret.retard > 0 && (
        <Badge variant="danger">
          <AlertTriangle className="w-3 h-3 inline mr-1" />
          En retard de {arret.retard} jour{arret.retard > 1 ? 's' : ''}
        </Badge>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
        {arret.lieu && (
          <span className="flex items-center gap-1">
            <MapPin className="w-4 h-4 shrink-0" />
            {arret.lieu}
          </span>
        )}
        {heures && <span>{heures}</span>}
        {arret.contact_nom && <span>{arret.contact_nom}</span>}
        {/* Un numéro qui s'appelle d'un doigt : sur place, c'est ce qu'on cherche
            en premier quand une porte est fermée. */}
        {arret.contact_tel && (
          <a href={`tel:${arret.contact_tel.replace(/\s/g, '')}`}
            className={`inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 ${CIBLE}`}>
            <Phone className="w-4 h-4" />
            {arret.contact_tel}
          </a>
        )}
      </div>

      {arret.consignes && (
        <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap p-2 rounded bg-gray-50 dark:bg-gray-800">
          {arret.consignes}
        </p>
      )}
    </div>
  )
}

/**
 * Une ligne, saisie selon sa nature.
 *
 * Un lot se compte au pas de un, parce qu'on ajuste rarement de quarante ; un
 * exemplaire se coche, parce qu'un camion est parti ou ne l'est pas ; une
 * prestation se dit réalisée. Proposer un champ de nombre pour les trois
 * obligerait à taper « 1 » sur un camion.
 */
function LigneSaisie({ ligne, phase, saisie, modifiable, ecart, onChange }: {
  ligne: LigneTournee
  phase: PhaseTournee
  saisie: Saisie
  modifiable: boolean
  ecart: number
  onChange: (champs: Partial<Saisie>) => void
}) {
  const livraison = phase === 'livraison'
  const attendu = livraison ? ligne.demande : ligne.livre
  const complet = saisie.fait >= attendu
  const parCase = ligne.nature === 'exemplaire' || ligne.nature === 'prestation'

  // Une prestation n'a rien à rendre : au retour, elle n'a pas à figurer.
  if (!livraison && ligne.nature === 'prestation') return null

  return (
    <div className={`p-3 rounded-lg border ${
      complet
        ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-900/20'
        : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{ligne.nom}</span>
          {ligne.repere && (
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">{ligne.repere}</span>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {livraison
              ? `${ligne.demande} demandé${ligne.demande > 1 ? 's' : ''}`
              : `${ligne.livre} sorti${ligne.livre > 1 ? 's' : ''}`}
            {ligne.unite ? ` ${ligne.unite}` : ''}
            {ligne.source === 'parc' ? ' · parc' : ''}
          </p>
        </div>
        {complet && <Check className="w-5 h-5 text-green-600 shrink-0" />}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {parCase ? (
          <button
            type="button"
            disabled={!modifiable}
            onClick={() => onChange({ fait: complet ? 0 : attendu })}
            className={`${CIBLE} px-4 rounded-lg text-sm font-medium border transition-colors ${
              complet
                ? 'bg-green-600 text-white border-green-600'
                : 'bg-white text-gray-700 border-gray-300 dark:bg-gray-900 dark:text-gray-200 dark:border-gray-600'
            } disabled:opacity-60`}
          >
            {verbe(ligne, phase)}
          </button>
        ) : (
          <Compteur
            valeur={saisie.fait}
            maximum={attendu}
            libelle={verbe(ligne, phase)}
            modifiable={modifiable}
            onChange={(fait) => onChange({ fait })}
          />
        )}
      </div>

      {/* L'écart ne se saisit que quand il existe : un champ « perdu » toujours
          affiché se remplit par habitude, et une chaise saine finit cassée. */}
      {!livraison && ecart > 0 && ligne.nature !== 'exemplaire' && modifiable && (
        <div className="mt-3 pt-3 border-t border-yellow-200 dark:border-yellow-900">
          <p className="text-xs text-yellow-700 dark:text-yellow-500">
            {ecart} {ligne.unite || 'unité(s)'} ne {ecart > 1 ? 'sont' : 'est'} pas rentré
            {ecart > 1 ? 's' : ''}.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline"
              onClick={() => onChange({ perdu: saisie.perdu + ecart })}>
              Déclarer perdu{ecart > 1 ? 's' : ''} ou cassé{ecart > 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      )}

      {saisie.perdu > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Compteur
            valeur={saisie.perdu}
            maximum={ligne.livre}
            libelle="Perdu ou cassé"
            modifiable={modifiable}
            onChange={(perdu) => onChange({ perdu })}
          />
          <div className="flex-1 min-w-[12rem]">
            <Input label="Motif" size="sm" value={saisie.motif} disabled={!modifiable}
              placeholder="Cassée au transport, volée…"
              onChange={(e) => onChange({ motif: e.target.value })} />
          </div>
        </div>
      )}

      {/* Un exemplaire ne se compte pas : ce qui lui arrive se constate. */}
      {!livraison && ligne.source === 'parc' && ligne.nature === 'exemplaire' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 w-full">État au retour</span>
          {ETATS_RETOUR.map((etat) => (
            <button
              key={etat.value}
              type="button"
              disabled={!modifiable}
              onClick={() => onChange({ etat: saisie.etat === etat.value ? '' : etat.value })}
              className={`${CIBLE} px-3 rounded-lg text-sm border transition-colors ${
                saisie.etat === etat.value
                  ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900'
                  : 'bg-white text-gray-700 border-gray-300 dark:bg-gray-900 dark:text-gray-200 dark:border-gray-600'
              } disabled:opacity-60`}
            >
              {etat.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Un nombre qui se règle au pouce.
 *
 * Le champ reste saisissable au clavier — corriger 40 en 12 au pas de un serait
 * absurde — mais les deux boutons couvrent l'ajustement courant, celui d'une ou
 * deux unités qu'on découvre en déchargeant.
 */
function Compteur({ valeur, maximum, libelle, modifiable, onChange }: {
  valeur: number
  maximum: number
  libelle: string
  modifiable: boolean
  onChange: (valeur: number) => void
}) {
  const borner = (n: number) => Math.max(0, Math.min(maximum, n))

  return (
    <div>
      <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{libelle}</span>
      <div className="flex items-center gap-1">
        <button type="button" aria-label={`${libelle} : un de moins`} disabled={!modifiable}
          onClick={() => onChange(borner(valeur - 1))}
          className={`${CIBLE} rounded-lg border border-gray-300 dark:border-gray-600 flex items-center justify-center disabled:opacity-60`}>
          <Minus className="w-4 h-4" />
        </button>
        <input
          type="number" inputMode="numeric" min={0} max={maximum} value={valeur}
          disabled={!modifiable}
          aria-label={libelle}
          onChange={(e) => onChange(borner(parseInt(e.target.value) || 0))}
          className="w-16 h-11 text-center rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 text-base"
        />
        <button type="button" aria-label={`${libelle} : un de plus`} disabled={!modifiable}
          onClick={() => onChange(borner(valeur + 1))}
          className={`${CIBLE} rounded-lg border border-gray-300 dark:border-gray-600 flex items-center justify-center disabled:opacity-60`}>
          <Plus className="w-4 h-4" />
        </button>
        <span className="text-sm text-gray-500 dark:text-gray-400 ml-1">/ {maximum}</span>
      </div>
    </div>
  )
}

/**
 * La même saisie, ouverte depuis la liste des manifestations.
 *
 * La liste ne connaît pas les arrêts : elle demande celui de la manifestation
 * visée, sans condition de date. Passer par la même lecture que la tournée évite
 * de recalculer côté écran ce qu'il reste à faire — c'est la règle du serveur
 * qui tranche, et elle ne se dédouble pas.
 */
export function SaisieTerrainDeLaManifestation({ manifestationId, modifiable, onClose }: {
  manifestationId: number
  modifiable: boolean
  onClose: () => void
}) {
  const { data: tournee, isLoading } = useQuery({
    queryKey: ['tournee', 'manifestation', manifestationId],
    queryFn: async () =>
      (await manifestationApi.getTournee({ manifestation: manifestationId })).data.data,
  })

  const arret = useMemo(
    () => tournee?.recuperations[0] ?? tournee?.livraisons[0] ?? null,
    [tournee]
  )

  if (isLoading) {
    return (
      <Modal isOpen onClose={onClose} title="Matériel">
        <ModalBody><div className="flex justify-center py-10"><Spinner /></div></ModalBody>
      </Modal>
    )
  }

  if (!arret) {
    return (
      <Modal isOpen onClose={onClose} title="Matériel">
        <ModalBody>
          <Alert type="info">
            <span className="text-sm">
              Rien à pointer sur cette manifestation : elle ne demande ni matériel ni
              prestation, ou elle n'est pas encore validée.
            </span>
          </Alert>
        </ModalBody>
        <ModalFooter><Button onClick={onClose}>Fermer</Button></ModalFooter>
      </Modal>
    )
  }

  return <SaisieTerrain arret={arret} modifiable={modifiable} onClose={onClose} />
}
