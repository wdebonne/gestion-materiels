import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  AlertTriangle, Beaker, Check, FileText, Link2, PackageSearch, Users, X,
} from 'lucide-react'
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Select, TextArea,
} from '@/components/ui'
import { essaiIntakeApi, type EssaiIntake, type IntakeSource } from '@/lib/api'
import toast from 'react-hot-toast'

/**
 * Essai d'une réception de webhook, **à blanc**.
 *
 * Régler une source demandait de deviner à l'avance quels chemins un formulaire
 * enverrait, et la seule façon de le vérifier était d'envoyer une vraie demande —
 * qui créait une vraie manifestation, réservait du matériel, et écrivait aux
 * services. On colle donc ici la charge utile du formulaire : rien n'est
 * enregistré, personne n'est prévenu, et le compte rendu dit ce qui *serait*
 * arrivé.
 *
 * L'écran répond aux trois questions qu'on se pose réellement devant un
 * formulaire : la demande passerait-elle, quel matériel serait reconnu, et quels
 * services seraient alertés.
 */

/** Un exemple à modifier, plutôt qu'une zone vide devant laquelle on reste. */
const EXEMPLE = JSON.stringify(
  {
    nom_manifestation: 'Fête de la musique',
    date_debut: '2026-06-21',
    date_fin: '2026-06-21',
    heure_debut: '18:00',
    lieu: 'Place du marché',
    contact: { nom: 'Martin Dubois', telephone: '01 02 03 04 05', email: 'martin@ville.fr' },
    date_livraison: '2026-06-20',
    date_recuperation: '2026-06-22',
    personnes_attendues: 800,
    materiels: [
      { libelle: 'Table brasserie', quantite: 10 },
      { libelle: 'Chaise pliante', quantite: 50 },
      { libelle: 'Raccordement électrique', quantite: 1 },
    ],
    commentaire: 'Prévoir une rallonge',
  },
  null,
  2
)

export default function EssaiWebhook({ sources }: { sources: IntakeSource[] }) {
  const [charge, setCharge] = useState(EXEMPLE)
  const [sourceId, setSourceId] = useState('')
  const [resultat, setResultat] = useState<EssaiIntake | null>(null)

  const { data: champs = [] } = useQuery({
    queryKey: ['intake-champs'],
    queryFn: async () => (await essaiIntakeApi.getChamps()).data.data,
  })

  const essai = useMutation({
    mutationFn: (payload: unknown) =>
      essaiIntakeApi.essayer(payload, sourceId ? Number(sourceId) : undefined),
    onSuccess: (res) => setResultat(res.data.data),
    onError: (err: any) => toast.error(err.response?.data?.message || "L'essai n'a pas abouti"),
  })

  const lancer = () => {
    let payload: unknown
    try {
      payload = JSON.parse(charge)
    } catch {
      toast.error("Ce n'est pas du JSON valide — vérifiez les virgules et les accolades")
      return
    }
    essai.mutate(payload)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Beaker className="w-4 h-4" /> Essayer une demande
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Collez ici ce que votre formulaire envoie. <strong>Rien n'est créé</strong> : ni
          manifestation, ni réservation, ni courriel. Le compte rendu dit seulement ce qui serait
          arrivé.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[14rem]">
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
              Source (facultatif — sinon les champs sont devinés)
            </label>
            <Select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              options={[
                { value: '', label: '— Détecter automatiquement —' },
                ...sources.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>
          <Button loading={essai.isPending} onClick={lancer} icon={<Beaker className="w-4 h-4" />}>
            Essayer
          </Button>
        </div>

        <TextArea
          value={charge}
          onChange={(e) => setCharge(e.target.value)}
          rows={10}
          className="font-mono text-xs"
          aria-label="Charge utile JSON"
        />

        {champs.length > 0 && (
          <details className="text-xs text-gray-500 dark:text-gray-400">
            <summary className="cursor-pointer select-none">
              Champs qu'une demande peut porter ({champs.length})
            </summary>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
              {champs.map((c: any) => (
                <div key={c.cle} className="flex items-center gap-1">
                  <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">{c.cle}</code>
                  <span className="truncate">{c.libelle}</span>
                  {c.obligatoire && <Badge variant="warning" size="sm">requis</Badge>}
                </div>
              ))}
            </div>
          </details>
        )}

        {resultat && <CompteRendu resultat={resultat} />}
      </CardBody>
    </Card>
  )
}

/** Ce qui serait arrivé : recevabilité, matériel reconnu, services alertés. */
function CompteRendu({ resultat }: { resultat: EssaiIntake }) {
  const { materiels, services } = resultat

  return (
    <div className="space-y-3 pt-2 border-t border-gray-200 dark:border-gray-700">
      {resultat.recevable ? (
        <Alert type="success">
          <span className="text-sm">
            <Check className="w-4 h-4 inline mr-1" />
            Cette demande serait <strong>acceptée</strong> et mise « à confirmer ».
          </span>
        </Alert>
      ) : (
        <Alert type="error">
          <span className="text-sm">
            <X className="w-4 h-4 inline mr-1" />
            Cette demande serait <strong>refusée</strong> — champs obligatoires absents :{' '}
            {resultat.manquants.map((m) => m.libelle).join(', ')}.
          </span>
        </Alert>
      )}

      <Section titre="Champs reconnus" icone={<Link2 className="w-4 h-4" />}>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          {resultat.origine_correspondance === 'imposee'
            ? 'Correspondance réglée sur la source.'
            : 'Correspondance devinée à partir des noms reçus — réglez-la sur la source pour la figer.'}
        </p>
        <div className="space-y-1">
          {Object.entries(resultat.extrait)
            .filter(([, valeur]) => valeur !== null && valeur !== undefined && valeur !== '')
            .map(([cle, valeur]) => (
              <div key={cle} className="flex flex-wrap items-baseline gap-2 text-sm">
                <code className="text-xs px-1 rounded bg-gray-100 dark:bg-gray-800 shrink-0">{cle}</code>
                <span className="text-gray-900 dark:text-gray-100 break-all">{String(valeur)}</span>
                {resultat.correspondance[cle] && (
                  <span className="text-xs text-gray-400">← {resultat.correspondance[cle]}</span>
                )}
              </div>
            ))}
        </div>
      </Section>

      <Section titre="Matériel demandé" icone={<PackageSearch className="w-4 h-4" />}>
        {materiels.apparies.length === 0 && materiels.non_apparies.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Aucune ligne de matériel reconnue.</p>
        ) : (
          <div className="space-y-1">
            {materiels.apparies.map((ligne, i) => (
              <div key={`ok-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-green-600 shrink-0" />
                <span className="text-gray-900 dark:text-gray-100">
                  {ligne.quantite} × {ligne.stock_name}
                </span>
                {ligne.is_prestation && <Badge variant="info" size="sm">Prestation</Badge>}
                {ligne.libelle !== ligne.stock_name && (
                  <span className="text-xs text-gray-400">reçu « {ligne.libelle} »</span>
                )}
              </div>
            ))}
            {materiels.non_apparies.map((ligne, i) => (
              <div key={`ko-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                <AlertTriangle className="w-4 h-4 text-yellow-600 shrink-0" />
                <span className="text-gray-900 dark:text-gray-100">
                  {ligne.quantite} × {ligne.libelle}
                </span>
                <span className="text-xs text-yellow-700 dark:text-yellow-500">
                  à rattacher à la main — ajoutez un alias sur l'article
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section titre="Services qui seraient alertés" icone={<Users className="w-4 h-4" />}>
        {services.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Aucun service : le matériel reconnu ne relève d'aucun périmètre, et aucun coordinateur
            n'est désigné.
          </p>
        ) : (
          <div className="space-y-1">
            {services.map((service) => (
              <div key={service.id}
                className="flex flex-wrap items-center gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800 text-sm">
                <span className="text-gray-900 dark:text-gray-100">{service.name}</span>
                {service.is_coordinator && <Badge variant="success" size="sm">Coordinateur</Badge>}
                {service.email && <span className="text-xs text-gray-500">{service.email}</span>}
                <span className="flex-1" />
                {service.modele ? (
                  <Badge variant={service.modele.last_error ? 'danger' : 'info'} size="sm"
                    title={service.modele.last_error ?? undefined}>
                    <FileText className="w-3 h-3 inline mr-1" />
                    {service.modele.name} · {service.modele.champs} champ(s)
                  </Badge>
                ) : (
                  <span className="text-xs text-gray-400">aucun document pré-rempli</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <details className="text-xs text-gray-500 dark:text-gray-400">
        <summary className="cursor-pointer select-none">
          Chemins trouvés dans la charge utile ({resultat.chemins.length})
        </summary>
        <div className="mt-2 flex flex-wrap gap-1">
          {resultat.chemins.map((chemin) => (
            <code key={chemin} className="px-1 rounded bg-gray-100 dark:bg-gray-800">{chemin}</code>
          ))}
        </div>
      </details>
    </div>
  )
}

function Section({
  titre,
  icone,
  children,
}: {
  titre: string
  icone: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-1.5">
        {icone} {titre}
      </h4>
      {children}
    </div>
  )
}
