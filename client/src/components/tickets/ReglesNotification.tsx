import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Bell, Plus, Trash2, Info, FlaskConical, Mail } from 'lucide-react'
import api, {
  notificationCatalogueApi,
  siteApi,
  ticketRegleApi,
  ticketReferentielApi,
  type CategorieDemande,
  type RegleNotification,
} from '@/lib/api'
import {
  Badge,
  Button,
  Card,
  CardBody,
  Input,
  LoadingInline,
  Modal,
  ModalBody,
  ModalFooter,
  Select,
} from '@/components/ui'

/**
 * Qui prévenir, et à quelle condition.
 *
 * Le socle prévient déjà les évidents — demandeur, technicien, service, copies.
 * Cet écran sert à l'exception qui était demandée : *« une fuite à la mairie
 * doit prévenir le responsable de la maintenance et l'élu chargé des travaux »*.
 * Ce n'est ni un rôle — l'élu n'en a pas — ni le service destinataire, et cela
 * ne vaut que pour ce bâtiment.
 *
 * **Une règle s'affiche comme une phrase**, pas comme huit champs alignés.
 * C'est ce que veut dire « paramétrable visuellement » : un administrateur doit
 * pouvoir relire ses règles sans les déchiffrer.
 *
 * **Le bouton Tester compte pour autant que le reste.** Sans lui, on découvre
 * l'effet d'une règle sur une vraie demande, un mois plus tard, quand quelqu'un
 * se plaint de recevoir trop de courriels. Il rend la liste des destinataires
 * *avec la raison de chacun*, sans rien envoyer.
 */

const TOUS_LES_EVENEMENTS = '__tous__'

export default function ReglesNotification() {
  const queryClient = useQueryClient()
  const [creation, setCreation] = useState(false)
  const [simulation, setSimulation] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', 'regles'],
    queryFn: async () => (await ticketRegleApi.liste()).data,
  })

  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ['tickets', 'regles'] })

  const activer = useMutation({
    mutationFn: ({ id, actif }: { id: number; actif: boolean }) => ticketRegleApi.activer(id, actif),
    onSuccess: rafraichir,
  })

  const supprimer = useMutation({
    mutationFn: (id: number) => ticketRegleApi.supprimer(id),
    onSuccess: rafraichir,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Suppression impossible'),
  })

  if (isLoading) return <LoadingInline />

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <p className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-primary-600" />
            <span>
              Le demandeur, le technicien et le service destinataire sont prévenus d'office. Ces
              règles ajoutent <strong>en plus</strong> — elles ne remplacent jamais : ajouter le
              responsable de la maintenance ne retire pas le technicien attitré. Chaque condition
              laissée sur « peu importe » <strong>élargit</strong> la règle.
            </span>
          </p>
          <div className="flex gap-2">
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => setCreation(true)}>
              Ajouter une règle
            </Button>
            <Button
              variant="outline"
              icon={<FlaskConical className="w-4 h-4" />}
              onClick={() => setSimulation(true)}
            >
              Tester
            </Button>
          </div>
        </CardBody>
      </Card>

      {(data?.regles ?? []).length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center text-gray-500">
            <Bell className="w-8 h-8 mx-auto text-gray-300 mb-2" />
            Aucune règle : seuls les concernés d'office sont prévenus.
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-2">
          {(data?.regles ?? []).map((regle) => (
            <Card key={regle.id} className={regle.actif ? '' : 'opacity-60'}>
              <CardBody className="py-3 flex items-start justify-between gap-3">
                <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
                  <PhraseRegle regle={regle} />
                </p>
                <div className="flex items-center gap-3 shrink-0">
                  <label className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={regle.actif}
                      onChange={(e) => activer.mutate({ id: regle.id, actif: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    active
                  </label>
                  <button
                    onClick={() => supprimer.mutate(regle.id)}
                    className="text-gray-400 hover:text-red-600"
                    title="Supprimer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {creation && <FormulaireRegle onFerme={() => setCreation(false)} onEnregistre={rafraichir} />}
      {simulation && <Simulation onFerme={() => setSimulation(false)} />}
    </div>
  )
}

/** « Quand une demande est ouverte, pour Bâtiment, sur Mairie → prévenir Max ». */
function PhraseRegle({ regle }: { regle: RegleNotification }) {
  const { data: catalogue } = useQuery({
    queryKey: ['notifications', 'events', 'ticket'],
    queryFn: async () => (await notificationCatalogueApi.evenements('ticket')).data,
  })

  const libelleEvenement =
    catalogue?.data.events.find((e) => e.evenement === regle.evenement)?.libelle ?? regle.evenement

  const conditions: Array<[string, string | null]> = [
    ['catégorie', regle.portee.categorieNom],
    ['sous-catégorie', regle.portee.sousCategorieNom],
    ['bâtiment', regle.portee.siteNom],
    ['service', regle.portee.serviceNom],
  ]
  const posees = conditions.filter(([, valeur]) => valeur)

  const destinataire =
    regle.destinataire.userNom ??
    regle.destinataire.serviceNom ??
    (regle.destinataire.role ? `tout compte « ${regle.destinataire.role} »` : '—')

  return (
    <>
      Quand{' '}
      <strong>
        {regle.evenement ? libelleEvenement : "n'importe quel événement se produit"}
      </strong>
      {posees.length > 0 ? (
        <>
          , pour une demande{' '}
          {posees.map(([nom, valeur], i) => (
            <span key={nom}>
              {i > 0 && ' '}
              {nom === 'bâtiment' ? 'sur ' : nom === 'service' ? 'traitée par ' : 'de '}
              <Badge variant="default">{valeur}</Badge>
            </span>
          ))}
        </>
      ) : (
        <span className="text-gray-400"> , quelle que soit la demande</span>
      )}
      {' → prévenir '}
      <strong>{destinataire}</strong>
      {regle.libelle && <span className="text-gray-400"> ({regle.libelle})</span>}
    </>
  )
}

function FormulaireRegle({ onFerme, onEnregistre }: { onFerme: () => void; onEnregistre: () => void }) {
  const [evenement, setEvenement] = useState(TOUS_LES_EVENEMENTS)
  const [categorieId, setCategorieId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [type, setType] = useState<'user' | 'service' | 'role'>('user')
  const [cible, setCible] = useState('')
  const [libelle, setLibelle] = useState('')

  const { data: catalogue } = useQuery({
    queryKey: ['notifications', 'events', 'ticket'],
    queryFn: async () => (await notificationCatalogueApi.evenements('ticket')).data,
  })
  const { data: categories } = useQuery({
    queryKey: ['tickets', 'categories'],
    queryFn: async () => (await ticketReferentielApi.categories()).data,
  })
  const { data: sites } = useQuery({
    queryKey: ['sites'],
    queryFn: async () => (await siteApi.liste()).data,
  })
  const { data: services } = useQuery({
    queryKey: ['services'],
    queryFn: async () => (await api.get('/services')).data,
  })
  const { data: annuaire } = useQuery({
    queryKey: ['users', 'annuaire'],
    queryFn: async () => (await api.get('/users/annuaire')).data,
  })

  const listeServices = services?.data ?? services?.services ?? []
  const listePersonnes = annuaire?.data ?? annuaire?.users ?? []

  const creer = useMutation({
    mutationFn: () =>
      ticketRegleApi.creer({
        evenement: evenement === TOUS_LES_EVENEMENTS ? null : evenement,
        categorieId: categorieId || null,
        siteId: siteId || null,
        destinataireUserId: type === 'user' ? cible : null,
        destinataireServiceId: type === 'service' ? cible : null,
        destinataireRole: type === 'role' ? cible : null,
        libelle: libelle || null,
      }),
    onSuccess: () => {
      toast.success('Règle ajoutée')
      onEnregistre()
      onFerme()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Création impossible'),
  })

  return (
    <Modal isOpen onClose={onFerme} title="Ajouter une règle" size="lg">
      <ModalBody className="space-y-4">
        <Select
          label="Quand"
          value={evenement}
          onChange={(e: any) => setEvenement(e.target.value)}
          options={[
            // Le premier choix est le plus utile : un élu qui suit un bâtiment
            // n'a pas à cocher six cases pour être tenu au courant.
            { value: TOUS_LES_EVENEMENTS, label: "N'importe quel événement" },
            ...(catalogue?.data.events ?? []).map((e) => ({ value: e.evenement, label: e.libelle })),
          ]}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Pour la catégorie"
            value={categorieId}
            onChange={(e: any) => setCategorieId(e.target.value)}
            options={[
              { value: '', label: 'Peu importe' },
              ...(categories?.categories ?? []).map((c: CategorieDemande) => ({
                value: String(c.id),
                label: c.parentId ? `— ${c.nom}` : c.nom,
              })),
            ]}
          />
          <Select
            label="Sur le bâtiment"
            value={siteId}
            onChange={(e: any) => setSiteId(e.target.value)}
            options={[
              { value: '', label: 'Peu importe' },
              ...(sites?.sites ?? []).map((s) => ({ value: String(s.id), label: s.nom })),
            ]}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Prévenir"
            value={type}
            onChange={(e: any) => {
              setType(e.target.value)
              setCible('')
            }}
            options={[
              { value: 'user', label: 'Une personne' },
              { value: 'service', label: 'Un service' },
              { value: 'role', label: 'Tous les comptes d’un rôle' },
            ]}
          />

          {type === 'user' && (
            <Select
              label="Qui"
              value={cible}
              onChange={(e: any) => setCible(e.target.value)}
              options={[
                { value: '', label: 'Choisir…' },
                ...listePersonnes.map((p: any) => ({
                  value: String(p.id),
                  label: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.email,
                })),
              ]}
            />
          )}
          {type === 'service' && (
            <Select
              label="Quel service"
              value={cible}
              onChange={(e: any) => setCible(e.target.value)}
              options={[
                { value: '', label: 'Choisir…' },
                ...listeServices.map((s: any) => ({ value: String(s.id), label: s.name })),
              ]}
            />
          )}
          {type === 'role' && (
            <Select
              label="Quel rôle"
              value={cible}
              onChange={(e: any) => setCible(e.target.value)}
              options={[
                { value: '', label: 'Choisir…' },
                { value: 'admin', label: 'Administrateur' },
                { value: 'supervisor', label: 'Superviseur' },
                { value: 'agent', label: 'Agent de terrain' },
              ]}
            />
          )}
        </div>

        {type === 'user' && (
          <p className="text-xs text-gray-500">
            Une personne sans compte convient : l'élu chargé des travaux figure à l'annuaire et
            recevra le courriel, même s'il ne se connecte jamais.
          </p>
        )}

        <Input
          label="Intitulé (facultatif)"
          value={libelle}
          onChange={(e: any) => setLibelle(e.target.value)}
          placeholder="Responsable maintenance, Élu aux travaux…"
          hint="Sert de raison affichée dans le test, et rend la liste des règles lisible"
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onFerme}>
          Annuler
        </Button>
        <Button disabled={!cible || creer.isPending} onClick={() => creer.mutate()}>
          Ajouter
        </Button>
      </ModalFooter>
    </Modal>
  )
}

/** Qui recevrait, et pourquoi — sans rien envoyer. */
function Simulation({ onFerme }: { onFerme: () => void }) {
  const [evenement, setEvenement] = useState('ticket_nouveau')
  const [categorieId, setCategorieId] = useState('')
  const [siteId, setSiteId] = useState('')

  const { data: catalogue } = useQuery({
    queryKey: ['notifications', 'events', 'ticket'],
    queryFn: async () => (await notificationCatalogueApi.evenements('ticket')).data,
  })
  const { data: categories } = useQuery({
    queryKey: ['tickets', 'categories'],
    queryFn: async () => (await ticketReferentielApi.categories()).data,
  })
  const { data: sites } = useQuery({
    queryKey: ['sites'],
    queryFn: async () => (await siteApi.liste()).data,
  })

  const essai = useMutation({
    mutationFn: async () =>
      (
        await ticketRegleApi.simuler({
          evenement,
          categorieId: categorieId || null,
          siteId: siteId || null,
        })
      ).data,
  })

  return (
    <Modal isOpen onClose={onFerme} title="Qui recevrait ?" size="lg">
      <ModalBody className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Composez une situation — « une fuite à la mairie » — et lisez qui serait prévenu, et à
          quel titre. Rien n'est envoyé.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Select
            label="Événement"
            value={evenement}
            onChange={(e: any) => setEvenement(e.target.value)}
            options={(catalogue?.data.events ?? []).map((e) => ({
              value: e.evenement,
              label: e.libelle,
            }))}
          />
          <Select
            label="Catégorie"
            value={categorieId}
            onChange={(e: any) => setCategorieId(e.target.value)}
            options={[
              { value: '', label: 'Aucune' },
              ...(categories?.categories ?? []).map((c: CategorieDemande) => ({
                value: String(c.id),
                label: c.parentId ? `— ${c.nom}` : c.nom,
              })),
            ]}
          />
          <Select
            label="Bâtiment"
            value={siteId}
            onChange={(e: any) => setSiteId(e.target.value)}
            options={[
              { value: '', label: 'Aucun' },
              ...(sites?.sites ?? []).map((s) => ({ value: String(s.id), label: s.nom })),
            ]}
          />
        </div>

        <Button
          icon={<FlaskConical className="w-4 h-4" />}
          onClick={() => essai.mutate()}
          disabled={essai.isPending}
        >
          {essai.isPending ? 'Calcul…' : 'Tester'}
        </Button>

        {essai.data && (
          <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
            {essai.data.destinataires.length === 0 ? (
              <p className="text-sm text-gray-500">
                Personne ne serait prévenu. Une demande réelle aurait au moins son demandeur et son
                technicien : ils ne figurent pas ici, puisque cette situation n'en a pas.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {essai.data.destinataires.map((d) => (
                  <li key={d.email} className="flex items-center gap-2 text-sm">
                    <Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <span className="text-gray-800 dark:text-gray-200">{d.email}</span>
                    <Badge variant="default">{d.raison}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onFerme}>
          Fermer
        </Button>
      </ModalFooter>
    </Modal>
  )
}
