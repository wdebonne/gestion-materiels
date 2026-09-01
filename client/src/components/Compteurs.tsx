import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Gauge, Check } from 'lucide-react'
import { Alert, Button, Card, CardBody, CardHeader, CardTitle, Input } from '@/components/ui'
import Can from '@/components/Can'
import api from '@/lib/api'
import toast from 'react-hot-toast'

/**
 * Compteurs d'un matériel : relevés de saisie, et mise à jour depuis la fiche.
 *
 * Avant, un seul compteur existait — le kilométrage — écrit en dur dans les
 * trois modales de saisie et recopié dans une clé `kilometrage` fixe. Une
 * tondeuse se voyait donc demander ses kilomètres, une table aussi, et un champ
 * personnalisé nommé autrement n'était jamais alimenté.
 *
 * Ce que le superviseur déclare dans « Configuration des champs » commande
 * maintenant tout : zéro compteur, zéro champ de relevé.
 */

/** Un compteur déclaré sur la branche du matériel, avec sa valeur du moment. */
export interface Compteur {
  fieldName: string
  fieldLabel: string
  unit: string
  value: number | null
}

/** Relevés d'un formulaire : une chaîne par compteur, telle que saisie. */
export type Releves = Record<string, string>

/** Relevés pré-remplis avec la valeur portée par la fiche. */
export function relevesInitiaux(compteurs: Compteur[]): Releves {
  const releves: Releves = {}
  for (const compteur of compteurs) {
    releves[compteur.fieldName] = compteur.value !== null ? String(compteur.value) : ''
  }
  return releves
}

/** Relevés saisis, convertis en nombres, prêts pour l'API. */
export function relevesPourEnvoi(releves: Releves | undefined): Record<string, number> {
  const valeurs: Record<string, number> = {}
  for (const [nom, brut] of Object.entries(releves ?? {})) {
    const nombre = versNombre(brut)
    if (nombre !== null) valeurs[nom] = nombre
  }
  return valeurs
}

/** Valeur du compteur principal, pour les appels qui attendent encore `mileage`. */
export function compteurPrincipal(
  compteurs: Compteur[],
  releves: Releves | undefined
): number | undefined {
  if (compteurs.length === 0) return undefined
  const valeur = versNombre(releves?.[compteurs[0].fieldName])
  return valeur === null ? undefined : valeur
}

/** Nombre lisible : « 84320 » devient « 84 320 ». */
export function formaterCompteur(valeur: number | null, unite: string): string {
  if (valeur === null || valeur === undefined) return '-'
  const nombre = valeur.toLocaleString('fr-FR')
  return unite ? `${nombre} ${unite}` : nombre
}

/**
 * Champs de relevé d'un formulaire de saisie.
 *
 * N'affiche rien du tout quand la branche ne déclare aucun compteur : c'est le
 * cas d'une tondeuse configurée sans heures moteur, d'une table, d'un lot de
 * chaises. Le formulaire d'entretien s'en trouve raccourci d'autant.
 */
export function ChampsCompteurs({
  compteurs,
  valeurs,
  onChange,
}: {
  compteurs: Compteur[]
  valeurs: Releves
  onChange: (valeurs: Releves) => void
}) {
  if (compteurs.length === 0) return null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {compteurs.map((compteur) => {
        const saisi = versNombre(valeurs[compteur.fieldName])
        // Un relevé plus bas que la fiche reste enregistrable — facture en
        // retard, compteur remplacé — mais on prévient avant l'envoi plutôt que
        // de laisser croire que la fiche va suivre.
        const enBaisse = saisi !== null && compteur.value !== null && saisi < compteur.value

        return (
          <Input
            key={compteur.fieldName}
            label={compteur.unit ? `${compteur.fieldLabel} (${compteur.unit})` : compteur.fieldLabel}
            type="number"
            inputMode="numeric"
            value={valeurs[compteur.fieldName] ?? ''}
            onChange={(e) => onChange({ ...valeurs, [compteur.fieldName]: e.target.value })}
            hint={
              enBaisse
                ? `Inférieur au relevé en fiche (${formaterCompteur(compteur.value, compteur.unit)}) : la saisie est conservée, la fiche ne changera pas.`
                : compteur.value !== null
                  ? `En fiche : ${formaterCompteur(compteur.value, compteur.unit)}`
                  : 'Jamais relevé'
            }
          />
        )
      })}
    </div>
  )
}

/** Ce que le serveur répond après avoir reporté des relevés. */
export interface ReportCompteurs {
  retenus: Array<{ fieldLabel: string; unit: string; value: number }>
  ignores: Array<{ fieldLabel: string; unit: string; value: number; valeurEnFiche: number }>
}

/**
 * Prévient quand un relevé n'a pas été retenu.
 *
 * Sans ce message, l'agent voit « Plein ajouté », rouvre la fiche, y trouve
 * l'ancien kilométrage et croit à une perte de saisie.
 */
export function signalerReport(report: ReportCompteurs | undefined) {
  if (!report?.ignores?.length) return
  const detail = report.ignores
    .map(
      (i) =>
        `${i.fieldLabel} : ${formaterCompteur(i.value, i.unit)} saisi, ${formaterCompteur(i.valeurEnFiche, i.unit)} en fiche`
    )
    .join(' — ')
  toast(`Relevé conservé sur la saisie mais non reporté sur la fiche (${detail})`, {
    icon: '⚠️',
    duration: 6000,
  })
}

/**
 * Carte « Compteurs » de l'onglet Détails, avec mise à jour directe.
 *
 * Le relevé passe par `PATCH /objects/:id/compteurs`, ouvert à l'agent de
 * terrain. Passer par « Modifier la fiche » l'aurait obligé à être superviseur
 * — et lui aurait donné au passage le droit de renommer le véhicule.
 */
export function CarteCompteurs({
  objectId,
  compteurs,
}: {
  objectId: number | string
  compteurs: Compteur[]
}) {
  const queryClient = useQueryClient()
  const [enSaisie, setEnSaisie] = useState(false)
  const [valeurs, setValeurs] = useState<Releves>(() => relevesInitiaux(compteurs))

  // La fiche se recharge après chaque plein ou entretien : les champs suivent,
  // sinon l'agent verrait sa saisie précédente figée dans le formulaire.
  useEffect(() => {
    if (!enSaisie) setValeurs(relevesInitiaux(compteurs))
  }, [compteurs, enSaisie])

  const releverMutation = useMutation({
    mutationFn: async (readings: Record<string, number>) =>
      api.patch(`/objects/${objectId}/compteurs`, { readings }),
    onSuccess: (reponse) => {
      queryClient.invalidateQueries({ queryKey: ['object', String(objectId)] })
      const report: ReportCompteurs | undefined = reponse.data?.compteurs
      if (report?.retenus?.length) {
        toast.success('Compteur mis à jour')
      }
      signalerReport(report)
      setEnSaisie(false)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors du relevé')
    },
  })

  if (compteurs.length === 0) return null

  const aUneBaisse = compteurs.some((c) => {
    const saisi = versNombre(valeurs[c.fieldName])
    return saisi !== null && c.value !== null && saisi < c.value
  })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Gauge className="w-5 h-5 text-blue-600" />
          Compteurs
        </CardTitle>
        {!enSaisie && (
          <Can fieldWrite>
            <Button size="sm" variant="secondary" onClick={() => setEnSaisie(true)}>
              Relever
            </Button>
          </Can>
        )}
      </CardHeader>
      <CardBody>
        {enSaisie ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              releverMutation.mutate(relevesPourEnvoi(valeurs))
            }}
          >
            <ChampsCompteurs compteurs={compteurs} valeurs={valeurs} onChange={setValeurs} />
            {aUneBaisse && (
              <Alert type="warning">
                Un relevé est inférieur à la valeur en fiche. Un compteur ne redescend pas :
                la fiche gardera la valeur la plus élevée.
              </Alert>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setValeurs(relevesInitiaux(compteurs))
                  setEnSaisie(false)
                }}
              >
                Annuler
              </Button>
              <Button type="submit" loading={releverMutation.isPending}>
                <Check className="w-4 h-4 mr-1" />
                Enregistrer
              </Button>
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {compteurs.map((compteur) => (
              <div key={compteur.fieldName}>
                <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                  {compteur.fieldLabel}
                </h4>
                <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                  {formaterCompteur(compteur.value, compteur.unit)}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/** Nombre exploitable, ou `null`. La virgule du pavé numérique est tolérée. */
function versNombre(valeur: unknown): number | null {
  if (valeur === null || valeur === undefined || valeur === '') return null
  const nombre =
    typeof valeur === 'number' ? valeur : Number(String(valeur).replace(',', '.').trim())
  return Number.isFinite(nombre) ? nombre : null
}
