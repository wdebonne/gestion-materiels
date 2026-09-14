import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Fingerprint,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Smartphone,
  Trash2,
  Usb,
} from 'lucide-react'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  IconButton,
  Input,
  Spinner,
  useConfirm,
} from '@/components/ui'
import {
  enregistrerPasskey,
  lireEtatPasskeys,
  listerMesPasskeys,
  messageErreurPasskey,
  passkeysSupportees,
  renommerPasskey,
  supprimerPasskey,
  type PasskeyEnregistree,
} from '@/lib/passkeys'
import toast from 'react-hot-toast'

/**
 * Mes passkeys.
 *
 * Une passkey se retient toute seule : c'est l'empreinte, le visage ou le code
 * de l'appareil qui déverrouille une clé privée qui, elle, ne bouge jamais.
 * Pour l'agent, cela veut dire ne plus rien avoir à mémoriser, donc ne plus
 * rien avoir à écrire sur un post-it dans l'atelier.
 *
 * La liste est nominative parce qu'on n'en a jamais qu'une : le téléphone de
 * service, le poste du bureau, la clé USB rangée au coffre. Quand l'un des
 * trois disparaît, il faut pouvoir désigner celui-là et le retirer sans
 * toucher aux autres — d'où le nom, la date de dernière utilisation, et le
 * bouton de suppression sur chaque ligne.
 */
export default function MesPasskeys() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [renommage, setRenommage] = useState<{ id: number; nom: string } | null>(null)

  const supporte = passkeysSupportees()

  const { data: etat } = useQuery({
    queryKey: ['passkeys-etat'],
    queryFn: lireEtatPasskeys,
  })

  const { data: passkeys = [], isLoading } = useQuery<PasskeyEnregistree[]>({
    queryKey: ['mes-passkeys'],
    queryFn: listerMesPasskeys,
    // Inutile d'interroger la liste tant que le fournisseur est éteint : la
    // route répondrait, mais l'écran n'aurait rien à en faire.
    enabled: etat?.actif === true,
  })

  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ['mes-passkeys'] })

  const ajouter = useMutation({
    mutationFn: () => enregistrerPasskey(),
    onSuccess: (passkey) => {
      rafraichir()
      toast.success(`« ${passkey?.name ?? 'Passkey'} » enregistrée`)
    },
    onError: (err: any) => toast.error(messageErreurPasskey(err)),
  })

  const renommer = useMutation({
    mutationFn: ({ id, nom }: { id: number; nom: string }) => renommerPasskey(id, nom),
    onSuccess: () => {
      setRenommage(null)
      rafraichir()
      toast.success('Passkey renommée')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  const supprimer = useMutation({
    mutationFn: (id: number) => supprimerPasskey(id),
    onSuccess: () => {
      rafraichir()
      toast.success('Passkey supprimée')
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Erreur'),
  })

  const demanderSuppression = async (passkey: PasskeyEnregistree) => {
    const derniere = passkeys.length === 1 && etat?.secondFacteur
    const ok = await confirm({
      title: `Supprimer « ${passkey.name ?? 'cette passkey'} » ?`,
      message: derniere
        ? "C'est votre dernière passkey. Après suppression, votre mot de passe suffira de nouveau à vous connecter."
        : "Cet appareil ne pourra plus servir à vous connecter. Vos autres passkeys restent valables.",
      confirmLabel: 'Supprimer',
      variant: 'danger',
    })
    if (ok) supprimer.mutate(passkey.id)
  }

  if (etat && !etat.actif) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Fingerprint className="w-4 h-4" /> Mes passkeys
          </CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Les passkeys ne sont pas activées sur cette installation. Un administrateur peut les
            ouvrir depuis Paramètres &gt; Authentification.
          </p>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Fingerprint className="w-4 h-4" /> Mes passkeys
          </CardTitle>
          {supporte && (
            <Button
              size="sm"
              icon={ajouter.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              onClick={() => ajouter.mutate()}
              disabled={ajouter.isPending}
            >
              Ajouter
            </Button>
          )}
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Une passkey vous connecte avec l'empreinte, le visage ou le code de votre appareil, sans
          mot de passe à retenir. Rien de secret n'est envoyé au serveur : la clé reste dans
          l'appareil, et ne peut pas être présentée à un site qui imiterait celui-ci.
        </p>

        {!supporte && (
          <Alert type="warning">
            Ce navigateur ne gère pas les passkeys, ou le site n'est pas servi en HTTPS. Depuis un
            autre appareil, l'enregistrement restera possible.
          </Alert>
        )}

        {etat?.secondFacteur && passkeys.length > 0 && (
          <Alert type="info">
            Votre mot de passe ne suffit plus : à chaque connexion, une de ces passkeys vous sera
            demandée ensuite. Si vous perdez le seul appareil enregistré, un administrateur devra
            retirer vos passkeys pour vous rendre l'accès.
          </Alert>
        )}

        {isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : passkeys.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
            Aucune passkey enregistrée. « Ajouter » proposera celles que cet appareil sait créer.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {passkeys.map((passkey) => (
              <li key={passkey.id} className="py-3 flex items-start gap-3">
                <Icone passkey={passkey} />

                <div className="flex-1 min-w-0">
                  {renommage?.id === passkey.id ? (
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault()
                        renommer.mutate({ id: passkey.id, nom: renommage.nom })
                      }}
                    >
                      <Input
                        value={renommage.nom}
                        onChange={(e) => setRenommage({ id: passkey.id, nom: e.target.value })}
                        placeholder="Téléphone de service"
                        autoFocus
                      />
                      <Button type="submit" size="sm" loading={renommer.isPending}>
                        Enregistrer
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setRenommage(null)}>
                        Annuler
                      </Button>
                    </form>
                  ) : (
                    <>
                      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                        {passkey.name || 'Passkey'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {decrireUsage(passkey)}
                      </p>
                    </>
                  )}
                </div>

                {renommage?.id !== passkey.id && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <IconButton
                      icon={<Pencil className="w-4 h-4" />}
                      label="Renommer"
                      onClick={() => setRenommage({ id: passkey.id, nom: passkey.name ?? '' })}
                    />
                    <IconButton
                      icon={<Trash2 className="w-4 h-4" />}
                      label="Supprimer"
                      variant="danger"
                      onClick={() => demanderSuppression(passkey)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

/** Un pictogramme qui dit de quel objet il s'agit, avant même de lire le nom. */
function Icone({ passkey }: { passkey: PasskeyEnregistree }) {
  const classe = 'w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5'
  if (passkey.transports.includes('usb') || passkey.transports.includes('nfc')) {
    return <Usb className={classe} />
  }
  if (passkey.synchronisee) return <RefreshCw className={classe} />
  if (passkey.transports.includes('internal')) return <Smartphone className={classe} />
  return <KeyRound className={classe} />
}

/** « Utilisée le… », sinon « Enregistrée le… » : la date qui aide à trancher. */
function decrireUsage(passkey: PasskeyEnregistree): string {
  const nature = passkey.synchronisee
    ? 'Synchronisée entre vos appareils'
    : 'Liée à un seul appareil'

  const date = passkey.lastUsedAt
    ? `dernière utilisation le ${formater(passkey.lastUsedAt)}`
    : `enregistrée le ${formater(passkey.createdAt)}, jamais utilisée`

  return `${nature} — ${date}`
}

function formater(valeur: string): string {
  const date = new Date(valeur)
  if (Number.isNaN(date.getTime())) return valeur
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
