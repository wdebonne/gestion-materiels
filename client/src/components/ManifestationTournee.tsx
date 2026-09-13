import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Check, ChevronRight, MapPin, Phone, RotateCcw, Truck,
} from 'lucide-react'
import { Alert, Badge, Button, Card, CardBody, Spinner } from '@/components/ui'
import { manifestationApi, type ArretTournee, type LigneTournee } from '@/lib/api'
import SaisieTerrain, {
  CLES_A_RAFRAICHIR, enregistrerArret, saisiesInitiales, saisiesToutFait,
} from '@/components/SaisieTerrain'
import toast from 'react-hot-toast'

/**
 * La tournée du jour : ce qui part, ce qui rentre.
 *
 * L'onglet des manifestations répond à « où en est ce dossier ». Celui-ci répond
 * à la question de l'agent qui prend son service : *qu'est-ce que je fais ce
 * matin*. C'étaient jusqu'ici deux questions traitées par le même écran, et
 * l'agent devait faire le tri lui-même — ouvrir chaque manifestation, comprendre
 * qu'« validée » veut dire « à charger » et « livrée » veut dire « à aller
 * rechercher », puis pointer le stock et le parc dans deux endroits différents.
 *
 * Le retard est ici le premier citoyen : ce qu'on a oublié de rentrer remonte en
 * tête, chaque matin, jusqu'à ce que quelqu'un dise ce que le matériel est
 * devenu. Un stock ne devient faux que par ce silence-là.
 */

/** Le jour même et le lendemain : les deux seules fenêtres qui aient du sens ici. */
const demain = (): string => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

const enFrancais = (jour: string): string =>
  jour
    ? new Date(`${jour}T12:00:00`).toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long',
      })
    : ''

export default function ManifestationTournee({ modifiable, peutValider, onStatut }: {
  /** Saisir ce qui part et ce qui rentre : agents, superviseurs, administrateurs. */
  modifiable: boolean
  /** Prononcer le changement de statut : le constat de l'agent ne l'emporte pas. */
  peutValider: boolean
  /**
   * Rend une promesse, et c'est ce qui permet d'enchaîner : pointer puis
   * prononcer dans cet ordre. Lancée sans l'attendre, la relecture de la tournée
   * partait avant que le statut ait bougé, et l'arrêt réapparaissait une seconde
   * là où il n'était plus.
   */
  onStatut: (id: number, statut: string) => Promise<unknown>
}) {
  const [avecDemain, setAvecDemain] = useState(false)
  const [saisieOuverte, setSaisieOuverte] = useState<ArretTournee | null>(null)

  const { data: tournee, isLoading } = useQuery({
    queryKey: ['tournee', avecDemain],
    queryFn: async () =>
      (await manifestationApi.getTournee(avecDemain ? { jusqu_au: demain() } : {})).data.data,
  })

  if (isLoading) {
    return <div className="flex justify-center py-12"><Spinner /></div>
  }

  const livraisons = tournee?.livraisons ?? []
  const recuperations = tournee?.recuperations ?? []
  const enRetard = [...livraisons, ...recuperations].filter((a) => a.retard > 0).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-gray-900 dark:text-gray-100 first-letter:uppercase">
            {enFrancais(tournee?.jour ?? '')}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {livraisons.length + recuperations.length === 0
              ? 'Rien à charger ni à rentrer'
              : `${livraisons.length} à livrer · ${recuperations.length} à récupérer`}
          </p>
        </div>

        {/* Préparer la veille est le geste du vendredi soir : on charge le camion
            pour le samedi matin. */}
        <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
          {[
            { valeur: false, label: "Aujourd'hui" },
            { valeur: true, label: 'Et demain' },
          ].map((choix) => (
            <button
              key={String(choix.valeur)}
              type="button"
              onClick={() => setAvecDemain(choix.valeur)}
              className={`min-h-[44px] px-4 text-sm font-medium transition-colors ${
                avecDemain === choix.valeur
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-200'
              }`}
            >
              {choix.label}
            </button>
          ))}
        </div>
      </div>

      {enRetard > 0 && (
        <Alert type="warning">
          <span className="text-sm">
            {enRetard === 1
              ? "Un arrêt est en retard : du matériel est attendu et personne n'a dit ce qu'il devenait."
              : `${enRetard} arrêts sont en retard : du matériel est attendu et personne n'a dit ce qu'il devenait.`}
          </span>
        </Alert>
      )}

      <Section
        titre="À livrer"
        icone={<Truck className="w-4 h-4" />}
        arrets={livraisons}
        vide="Aucun chargement à préparer sur la période."
        modifiable={modifiable}
        peutValider={peutValider}
        onStatut={onStatut}
        onDetailler={setSaisieOuverte}
      />

      <Section
        titre="À récupérer"
        icone={<RotateCcw className="w-4 h-4" />}
        arrets={recuperations}
        vide="Rien à aller rechercher sur la période."
        modifiable={modifiable}
        peutValider={peutValider}
        onStatut={onStatut}
        onDetailler={setSaisieOuverte}
      />

      {saisieOuverte && (
        <SaisieTerrain
          arret={saisieOuverte}
          modifiable={modifiable}
          onClose={() => setSaisieOuverte(null)}
        />
      )}
    </div>
  )
}

function Section({ titre, icone, arrets, vide, modifiable, peutValider, onStatut, onDetailler }: {
  titre: string
  icone: React.ReactNode
  arrets: ArretTournee[]
  vide: string
  modifiable: boolean
  peutValider: boolean
  onStatut: (id: number, statut: string) => Promise<unknown>
  onDetailler: (arret: ArretTournee) => void
}) {
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
        {icone}
        {titre}
        <Badge variant="default">{arrets.length}</Badge>
      </h3>

      {arrets.length === 0 ? (
        <Card><CardBody className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
          {vide}
        </CardBody></Card>
      ) : (
        arrets.map((arret) => (
          <ArretCard
            key={`${arret.phase}-${arret.manifestation_id}`}
            arret={arret}
            modifiable={modifiable}
            peutValider={peutValider}
            onStatut={onStatut}
            onDetailler={() => onDetailler(arret)}
          />
        ))
      )}
    </div>
  )
}

/**
 * Ce qu'on charge, résumé en une ligne lisible de loin.
 *
 * Trois articles nommés puis un décompte : la liste complète tient dans la
 * fenêtre de saisie, et l'annoncer entière ici ferait des cartes d'un mètre de
 * haut sur un téléphone.
 */
function resume(lignes: LigneTournee[]): string {
  const nommees = lignes.slice(0, 3).map((l) => {
    const quantite = l.nature === 'exemplaire' ? '' : `${l.demande} `
    return `${quantite}${l.nom}`
  })
  const reste = lignes.length - nommees.length
  return nommees.join(' · ') + (reste > 0 ? ` · +${reste}` : '')
}

function ArretCard({ arret, modifiable, peutValider, onStatut, onDetailler }: {
  arret: ArretTournee
  modifiable: boolean
  peutValider: boolean
  onStatut: (id: number, statut: string) => Promise<unknown>
  onDetailler: () => void
}) {
  const queryClient = useQueryClient()
  const livraison = arret.phase === 'livraison'
  const fait = arret.etat === 'fait'
  const suivant = livraison ? 'delivered' : 'recovered'

  /**
   * Le compte qui constate est aussi celui qui prononce.
   *
   * Séparer le constat de l'acte administratif n'a de sens qu'entre deux
   * personnes : l'agent pointe, le superviseur valide. Quand c'est le même qui
   * charge le camion et qui tient le dossier — le cas d'une petite commune — lui
   * demander deux gestes pour un seul déplacement n'ajoute aucune garantie, et
   * laisse derrière lui des manifestations livrées que le statut dit encore à
   * livrer.
   *
   * Pointer sans prononcer reste possible : c'est ce que fait « Détailler ».
   */
  const cumule = modifiable && peutValider

  /**
   * Le geste d'un doigt, sans ouvrir la fenêtre : c'est le cas courant, et lui
   * demander trois écrans le ferait remettre à plus tard — puis oublier.
   */
  const tout = useMutation({
    mutationFn: async () => {
      await enregistrerArret(arret, saisiesToutFait(arret, saisiesInitiales(arret)))
      if (!cumule) return false

      // Le constat est écrit quoi qu'il arrive. Si la transition bute — un
      // service qui n'a pas encore répondu la refuse en 409 — son propre message
      // le dit déjà, et annoncer la saisie comme perdue ferait tout resaisir.
      try {
        await onStatut(arret.manifestation_id, suivant)
        return true
      } catch {
        return false
      }
    },
    onSuccess: (prononce) => {
      for (const cle of CLES_A_RAFRAICHIR) queryClient.invalidateQueries({ queryKey: cle })
      if (prononce) toast.success(livraison ? 'Manifestation livrée' : 'Manifestation récupérée')
      else toast.success(livraison ? 'Chargement pointé' : 'Retour pointé')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  /**
   * La transition prononcée seule, une fois qu'un agent a tout pointé.
   *
   * Le rejet est absorbé : un refus — un service qui n'a pas encore répondu —
   * porte déjà son propre message, et une promesse rejetée sans preneur ferait
   * du bruit dans la console sans rien apprendre à personne.
   */
  const prononcer = () => {
    void onStatut(arret.manifestation_id, suivant)
      .then(() => toast.success(livraison ? 'Manifestation livrée' : 'Manifestation récupérée'))
      .catch(() => undefined)
  }

  return (
    <Card className={arret.retard > 0 ? 'border-l-4 border-l-red-500' : undefined}>
      <CardBody className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-gray-900 dark:text-gray-100">{arret.titre}</span>
              {arret.retard > 0 && (
                <Badge variant="danger">
                  <AlertTriangle className="w-3 h-3 inline mr-1" />
                  {arret.retard} jour{arret.retard > 1 ? 's' : ''} de retard
                </Badge>
              )}
              {fait && (
                <Badge variant="success">
                  <Check className="w-3 h-3 inline mr-1" />
                  Pointé
                </Badge>
              )}
              {arret.etat === 'commence' && <Badge variant="warning">Commencé</Badge>}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-gray-500 dark:text-gray-400">
              {arret.lieu && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />{arret.lieu}
                </span>
              )}
              {arret.heure_debut && <span>{arret.heure_debut}</span>}
              {arret.contact_nom && <span>{arret.contact_nom}</span>}
              {arret.contact_tel && (
                <a href={`tel:${arret.contact_tel.replace(/\s/g, '')}`}
                  className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 min-h-[44px]">
                  <Phone className="w-3.5 h-3.5" />{arret.contact_tel}
                </a>
              )}
            </div>

            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{resume(arret.lignes)}</p>
            {!fait && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Reste {arret.reste} à {livraison ? 'charger' : 'rentrer'}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {modifiable && !fait && (
            <Button className="flex-1 min-w-[10rem]" loading={tout.isPending}
              icon={livraison ? <Truck className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
              onClick={() => tout.mutate()}>
              {cumule
                ? livraison
                  ? 'Tout est parti — marquer livrée'
                  : 'Tout est rentré — marquer récupérée'
                : livraison
                  ? 'Tout est parti'
                  : 'Tout est rentré'}
            </Button>
          )}

          <Button variant="outline" className={modifiable && !fait ? '' : 'flex-1 min-w-[10rem]'}
            icon={<ChevronRight className="w-4 h-4" />} onClick={onDetailler}>
            {modifiable ? 'Détailler' : 'Voir le détail'}
          </Button>

          {/* Le constat de l'agent ne prononce pas le changement de statut : c'est
              l'acte administratif, et il revient au superviseur. Le bouton ne
              paraît qu'une fois tout pointé, pour qu'il ne serve jamais à clore
              un dossier dont personne n'a vérifié le contenu — c'est là tout le
              sens de la séparation, quand deux personnes se la partagent. */}
          {fait && peutValider && (
            <Button variant="outline" icon={<Check className="w-4 h-4" />} onClick={prononcer}>
              {livraison ? 'Marquer livrée' : 'Marquer récupérée'}
            </Button>
          )}
        </div>

        {fait && !peutValider && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Tout est pointé. Un superviseur prononcera la livraison.
          </p>
        )}
      </CardBody>
    </Card>
  )
}
