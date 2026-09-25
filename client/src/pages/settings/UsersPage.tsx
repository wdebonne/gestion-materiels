import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, Trash2, User, Search, ShieldOff, Fingerprint } from 'lucide-react'
import { 
  Card, CardBody, Button, Input, Select,
  Modal, ModalBody, ModalFooter, Badge, LoadingInline,
  Alert, useConfirm, Tabs, Tab
} from '@/components/ui'
import DroitsUtilisateur from '@/components/users/DroitsUtilisateur'
import { useAuthStore } from '@/stores/auth.store'
import api, { User as UserType } from '@/lib/api'
import { compteApi } from '@/lib/api'
import toast from 'react-hot-toast'
import { formatDate } from '@/lib/utils'
import { ROLE_DESCRIPTIONS, ROLE_LABELS, usePermissions } from '@/lib/permissions'

/** Ce que le formulaire manipule, avant d'être envoyé au serveur. */
const FICHE_VIERGE = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  role: 'user',
  isActive: true,
  canLogin: true,
}

type Filtre = 'tous' | 'comptes' | 'fiches'

const FILTRES: Array<{ valeur: Filtre; label: string }> = [
  { valeur: 'tous', label: 'Tout le monde' },
  { valeur: 'comptes', label: 'Comptes' },
  { valeur: 'fiches', label: 'Sans connexion' },
]

/**
 * Un seul annuaire, pour deux sortes de gens.
 *
 * Cet écran ne gérait que des comptes : une adresse et un mot de passe étaient
 * obligatoires, si bien qu'y inscrire le gardien à qui on remet un trousseau
 * — et qui n'ouvrira jamais l'application — obligeait à lui inventer les deux.
 * Faute de quoi il n'existait nulle part, et « Remettre le matériel » le
 * renvoyait vers « un externe », c'est-à-dire vers du texte libre où
 * « A. Marie », « Marie André » et « André MARIE » deviennent trois personnes.
 *
 * La case « Se connecte à l'application » sépare désormais les deux, sans
 * séparer les listes : la même personne est ici qu'elle ait un accès ou non, et
 * lui en accorder un plus tard ne la recopie pas ailleurs — elle garde son
 * identifiant, donc ses clés, ses réservations et son historique.
 *
 * **Le superviseur y entre aussi, et n'y voit que les personnes sans compte.**
 * C'est lui qui remet les clés : le renvoyer vers l'administrateur pour un nom
 * manquant le renverrait en pratique vers « un externe ». Il inscrit et
 * corrige — sans corriger, une faute de frappe produirait un doublon, ce que
 * cet annuaire existe pour éviter. Tout ce qui ouvre une porte — créer un
 * compte, accorder un accès, distribuer un rôle, supprimer, anonymiser — reste
 * à l'administrateur, ici comme sur le serveur.
 */
export default function UsersPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { user: currentUser } = useAuthStore()
  const { canAdmin } = usePermissions()
  const [search, setSearch] = useState('')
  const [filtre, setFiltre] = useState<Filtre>('tous')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserType | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<UserType | null>(null)
  const [onglet, setOnglet] = useState<'infos' | 'droits'>('infos')

  const [formData, setFormData] = useState({ ...FICHE_VIERGE })

  // Récupérer les utilisateurs
  const { data, isLoading } = useQuery({
    queryKey: ['users', search, filtre],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.append('search', search)
      if (filtre !== 'tous') params.append('canLogin', filtre === 'comptes' ? '1' : '0')
      const response = await api.get(`/users?${params}`)
      return response.data
    }
  })

  // Mutation pour créer/modifier
  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingUser) {
        const { password, ...updateData } = data
        if (password) updateData.password = password
        return api.put(`/users/${editingUser.id}`, updateData)
      }
      return api.post('/users', data)
    },
    onSuccess: (_res, variables: any) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      // L'annuaire des autres écrans — remise de clé, emprunteur d'une
      // réservation — vient de changer lui aussi.
      queryClient.invalidateQueries({ queryKey: ['annuaire'] })
      toast.success(
        editingUser
          ? 'Fiche modifiée'
          : variables?.canLogin === false
            ? 'Personne ajoutée à l’annuaire'
            : 'Utilisateur créé'
      )
      closeModal()
    },
    onError: (err: any) => {
      toast.error(
        err.response?.data?.message || err.response?.data?.error || 'Une erreur est survenue'
      )
    }
  })

  /**
   * Supprimer, ou désactiver quand le compte a laissé des traces.
   *
   * Le serveur tranche : un compte qui a validé, livré ou échangé est désactivé,
   * jamais effacé — l'effacer retirerait de l'historique le nom de qui a fait
   * quoi, précisément ce qu'un litige exige de retrouver.
   */
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.delete<{ success: boolean; desactive?: boolean; message?: string }>(`/users/${id}`)
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      if (res.data.desactive) {
        toast(res.data.message || 'Compte désactivé', { icon: 'i', duration: 9000 })
      } else {
        toast.success('Utilisateur supprimé')
      }
      setDeleteConfirm(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || err.response?.data?.error || 'Impossible de supprimer')
    }
  })

  /** Ce que le compte laisserait derrière lui, lu à l'ouverture de la fenêtre. */
  const { data: traces } = useQuery({
    queryKey: ['user-traces', deleteConfirm?.id],
    queryFn: async () => (await compteApi.getTraces(deleteConfirm!.id)).data.data,
    enabled: !!deleteConfirm,
  })

  const anonymizeMutation = useMutation({
    mutationFn: (id: number) => compteApi.anonymiser(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(res.data.message, { duration: 9000 })
      setDeleteConfirm(null)
    },
    onError: (err: any) => toast.error(err.response?.data?.message || "Impossible d'anonymiser")
  })

  /**
   * Retirer les passkeys d'un agent.
   *
   * Quand le second facteur est exigé, perdre son téléphone revient à perdre
   * l'accès : le mot de passe ne suffit plus, et l'écran où l'on supprimerait
   * la clé devenue inutilisable se trouve derrière la connexion. Désactiver le
   * compte n'y change rien — cela enferme davantage. Ce bouton est la sortie.
   */
  const retirerPasskeys = useMutation({
    mutationFn: (id: number) => api.delete(`/auth/passkey/user/${id}`),
    onSuccess: (res: any) => toast.success(res.data.message, { duration: 8000 }),
    onError: (err: any) =>
      toast.error(err.response?.data?.message || 'Impossible de retirer les passkeys'),
  })

  const demanderRetraitPasskeys = async (user: UserType) => {
    const ok = await confirm({
      title: `Retirer les passkeys de ${user.firstName} ${user.lastName} ?`,
      message:
        'Tous ses appareils enregistrés perdront leur accès. Le compte se reconnectera avec son seul mot de passe, et pourra réenregistrer une passkey ensuite.',
      confirmLabel: 'Retirer',
      variant: 'danger',
    })
    if (ok) retirerPasskeys.mutate(user.id)
  }

  const openModal = (user?: UserType) => {
    if (user) {
      setEditingUser(user)
      setFormData({
        firstName: user.firstName ?? '',
        lastName: user.lastName ?? '',
        email: user.email ?? '',
        password: '',
        role: user.role,
        isActive: user.isActive,
        canLogin: user.canLogin
      })
    } else {
      setEditingUser(null)
      // Le superviseur n'ouvre pas d'accès : la case part décochée et ne
      // s'affiche pas, plutôt que de proposer un geste que le serveur refusera.
      setFormData({ ...FICHE_VIERGE, canLogin: canAdmin })
    }
    setOnglet('infos')
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingUser(null)
    setFormData({ ...FICHE_VIERGE, canLogin: canAdmin })
  }

  /**
   * Ce que le formulaire refuse avant même d'appeler le serveur.
   *
   * Les mêmes règles y sont tenues, mot pour mot : une personne sans connexion
   * n'est désignable que par son nom, et un compte ne se connecte qu'avec une
   * adresse et un mot de passe. Les dire ici évite un aller-retour pour une
   * faute que l'écran voyait déjà.
   */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.canLogin) {
      if (!`${formData.firstName}${formData.lastName}`.trim()) {
        toast.error('Un nom est nécessaire pour retrouver cette personne dans les listes')
        return
      }
    } else {
      if (!formData.email.trim()) {
        toast.error("Un compte se connecte avec son adresse : elle est obligatoire")
        return
      }
      const aDejaUnMotDePasse = editingUser?.canLogin === true
      if (!formData.password && !aDejaUnMotDePasse) {
        toast.error(
          editingUser
            ? "Donnez un mot de passe à cette personne pour lui ouvrir la connexion"
            : 'Le mot de passe est requis pour un nouvel utilisateur'
        )
        return
      }
    }

    saveMutation.mutate(formData)
  }

  const getRoleBadge = (user: UserType) => {
    if (!user.canLogin) {
      return <Badge variant="default">Sans connexion</Badge>
    }
    switch (user.role) {
      case 'admin':
        return <Badge variant="danger">Administrateur</Badge>
      case 'supervisor':
        return <Badge variant="warning">Superviseur</Badge>
      case 'agent':
        return <Badge variant="info">{ROLE_LABELS.agent}</Badge>
      case 'service':
        return <Badge variant="default">{ROLE_LABELS.service}</Badge>
      default:
        return <Badge variant="default">Utilisateur</Badge>
    }
  }

  const users = data?.users || []

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {canAdmin ? 'Utilisateurs' : 'Annuaire des personnes'}
          </h1>
          <p className="text-gray-500 mt-1">
            {canAdmin ? (
              <>
                L'annuaire de la collectivité : les comptes qui se connectent, et les personnes
                qu'on désigne sans qu'elles se connectent — détentrices d'une clé, emprunteuses
                de matériel.
              </>
            ) : (
              <>
                Les personnes qu'on désigne sans qu'elles se connectent : détentrices d'une clé,
                emprunteuses de matériel. Les inscrire ici leur donne un nom unique, au lieu de
                trois orthographes dans « un externe ». Les comptes de l'application relèvent de
                l'administrateur.
              </>
            )}
          </p>
        </div>
        <Button icon={<Plus className="w-4 h-4" />} onClick={() => openModal()}>
          {canAdmin ? "Ajouter quelqu'un" : 'Ajouter une personne'}
        </Button>
      </div>

      {/* Recherche et filtre */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="w-full max-w-md">
          <Input
            placeholder="Rechercher un nom, une adresse..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search className="w-5 h-5" />}
          />
        </div>
        {/* Sans les comptes, il n'y a rien à trier : le serveur ne rend au
            superviseur que les personnes sans connexion. */}
        {canAdmin && (
          <div className="flex flex-wrap gap-2">
            {FILTRES.map(({ valeur, label }) => (
              <button
                key={valeur}
                type="button"
                onClick={() => setFiltre(valeur)}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  filtre === valeur
                    ? 'border-primary-600 bg-primary-50 text-primary-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Liste des utilisateurs */}
      <Card>
        <CardBody className="p-0">
          {isLoading ? (
            <div className="p-6"><LoadingInline /></div>
          ) : users.length === 0 ? (
            <div className="text-center py-12">
              <User className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">
                {filtre === 'fiches' || !canAdmin
                  ? "Personne sans connexion pour l'instant. C'est ici qu'on inscrit le gardien ou l'élu à qui on remet une clé."
                  : 'Aucun utilisateur trouvé'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Personne</th>
                    {/* Pour le superviseur, ces deux colonnes répéteraient
                        « Sans connexion » et « — » sur chaque ligne. */}
                    {canAdmin && (
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Accès</th>
                    )}
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Statut</th>
                    {canAdmin && (
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dernière connexion</th>
                    )}
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {users.map((user: UserType) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                            <span className="text-sm font-medium text-primary-700">
                              {user.firstName?.charAt(0)}{user.lastName?.charAt(0)}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">
                              {user.firstName} {user.lastName}
                            </p>
                            <p className="text-sm text-gray-500">
                              {user.email || <span className="italic">Pas d'adresse</span>}
                            </p>
                          </div>
                        </div>
                      </td>
                      {canAdmin && (
                        <td className="px-6 py-4">
                          {getRoleBadge(user)}
                        </td>
                      )}
                      <td className="px-6 py-4">
                        <Badge variant={user.isActive ? 'success' : 'default'}>
                          {user.isActive ? 'Actif' : 'Inactif'}
                        </Badge>
                      </td>
                      {canAdmin && (
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {!user.canLogin ? '—' : user.lastLogin ? formatDate(user.lastLogin) : 'Jamais'}
                        </td>
                      )}
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openModal(user)}
                            className="p-2 text-gray-600 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {/* Rien à retirer à qui ne se connecte pas — et
                              retirer une passkey relève de l'administrateur. */}
                          {user.canLogin && canAdmin && (
                            <button
                              onClick={() => demanderRetraitPasskeys(user)}
                              title="Retirer ses passkeys"
                              aria-label={`Retirer les passkeys de ${user.firstName} ${user.lastName}`}
                              className="p-2 text-gray-600 hover:text-amber-600 hover:bg-amber-50 rounded-lg"
                            >
                              <Fingerprint className="w-4 h-4" />
                            </button>
                          )}
                          {/* Retirer quelqu'un touche à l'historique : le
                              superviseur décoche « Figure dans les listes ». */}
                          {user.id !== currentUser?.id && canAdmin && (
                            <button
                              onClick={() => setDeleteConfirm(user)}
                              className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/*
        Modal création/édition.

        Pour un compte existant, l'administrateur y trouve deux onglets : ses
        informations, et tous ses droits — les modules qu'il voit, ce qu'il
        fait de chaque catégorie de demandes, ses bâtiments, son formulaire.
        Un seul endroit, au lieu de quatre écrans à recouper.
      */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        size={editingUser && canAdmin ? 'xl' : 'md'}
        title={
          editingUser
            ? `${editingUser.firstName ?? ''} ${editingUser.lastName ?? ''}`.trim() || 'Modifier la fiche'
            : canAdmin ? "Ajouter quelqu'un" : 'Ajouter une personne'
        }
      >
        {editingUser && canAdmin && (
          <div className="px-6 pt-2">
            <Tabs value={onglet} onChange={(v: string) => setOnglet(v as 'infos' | 'droits')}>
              <Tab value="infos" label="Informations" />
              <Tab value="droits" label="Droits" />
            </Tabs>
          </div>
        )}

        {onglet === 'droits' && editingUser && canAdmin ? (
          <DroitsUtilisateur userId={editingUser.id} onFerme={closeModal} />
        ) : (
        <form onSubmit={handleSubmit}>
          <ModalBody className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Prénom"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                required
              />
              <Input
                label="Nom"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                required
              />
            </div>

            {/*
              La case qui décide de tout le reste du formulaire. Décochée, il ne
              reste qu'un nom — ce qui suffit à désigner quelqu'un dans une
              remise de clé ou une réservation, et n'ouvre aucun accès.

              Elle ne s'affiche pas au superviseur : elle est le geste même
              qu'il n'a pas le droit de faire, et un bouton qui ment est pire
              que pas de bouton du tout.
            */}
            {canAdmin && (
              <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  id="canLogin"
                  checked={formData.canLogin}
                  onChange={(e) => setFormData({ ...formData, canLogin: e.target.checked })}
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm">
                  <span className="font-medium text-gray-900">Se connecte à l'application</span>
                  <span className="block text-gray-500 mt-0.5">
                    {formData.canLogin
                      ? 'Adresse et mot de passe obligatoires : ce sont ses identifiants.'
                      : "Ni adresse ni mot de passe. Cette personne figure à l'annuaire pour qu'on puisse lui remettre une clé ou lui prêter du matériel — elle n'ouvre jamais l'application. La case se recoche le jour où elle a besoin d'un accès."}
                  </span>
                </span>
              </label>
            )}

            <Input
              label={formData.canLogin ? 'Email' : 'Email (facultatif)'}
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required={formData.canLogin}
              hint={
                formData.canLogin
                  ? undefined
                  : canAdmin
                    ? "Notée si on la connaît. Elle ne donne aucun accès tant que la case est décochée."
                    : "Notée si on la connaît. Elle ne donne aucun accès : ouvrir un compte relève de l'administrateur."
              }
            />

            {formData.canLogin && (
              <>
                <Input
                  label={
                    editingUser?.canLogin
                      ? 'Nouveau mot de passe (laisser vide pour ne pas changer)'
                      : 'Mot de passe'
                  }
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required={!editingUser?.canLogin}
                  hint={
                    editingUser && !editingUser.canLogin
                      ? "Cette personne n'en avait pas : il lui en faut un pour se connecter."
                      : 'Minimum 8 caractères'
                  }
                />

                <Select
                  label="Rôle"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  hint={ROLE_DESCRIPTIONS[formData.role as keyof typeof ROLE_DESCRIPTIONS]}
                  options={[
                    { value: 'user', label: ROLE_LABELS.user },
                    { value: 'agent', label: ROLE_LABELS.agent },
                    { value: 'supervisor', label: ROLE_LABELS.supervisor },
                    { value: 'service', label: ROLE_LABELS.service },
                    { value: 'admin', label: ROLE_LABELS.admin }
                  ]}
                />
              </>
            )}

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="isActive" className="text-sm text-gray-700">
                {formData.canLogin
                  ? 'Compte actif'
                  : "Figure dans les listes (décocher retire cette personne des choix, sans l'effacer)"}
              </label>
            </div>
          </ModalBody>

          <ModalFooter>
            <Button type="button" variant="secondary" onClick={closeModal}>
              Annuler
            </Button>
            <Button type="submit" loading={saveMutation.isPending}>
              {editingUser ? 'Modifier' : formData.canLogin ? 'Créer le compte' : 'Ajouter'}
            </Button>
          </ModalFooter>
        </form>
        )}
      </Modal>

      {/* Modal confirmation suppression */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Retirer ce compte"
        size="sm"
      >
        <ModalBody>
          <p className="text-gray-600 dark:text-gray-300">
            <strong>{deleteConfirm?.firstName} {deleteConfirm?.lastName}</strong>
          </p>

          {traces && traces.traces.total > 0 ? (
            <div className="mt-3 space-y-3">
              <Alert type="warning">
                <div className="text-sm">
                  Cette personne a laissé des traces dans l'application. Elle sera{' '}
                  <strong>désactivée</strong>, pas supprimée : l'effacer retirerait de
                  l'historique le nom de qui a validé, livré, échangé ou détenu une clé — ce
                  qu'un litige exige de retrouver, des mois plus tard.
                  <ul className="mt-2 list-disc list-inside text-xs">
                    {traces.traces.manifestations_creees > 0 && (
                      <li>{traces.traces.manifestations_creees} manifestation(s) créée(s)</li>
                    )}
                    {traces.traces.decisions > 0 && <li>{traces.traces.decisions} décision(s)</li>}
                    {traces.traces.historique > 0 && (
                      <li>{traces.traces.historique} ligne(s) d'historique</li>
                    )}
                    {traces.traces.messages > 0 && <li>{traces.traces.messages} message(s)</li>}
                    {traces.traces.services > 0 && <li>membre de {traces.traces.services} service(s)</li>}
                    {traces.traces.cles > 0 && (
                      <li className="font-medium">
                        {traces.traces.cles} clé(s) ou trousseau(x) remis à son nom
                      </li>
                    )}
                    {traces.traces.reservations > 0 && (
                      <li>{traces.traces.reservations} réservation(s)</li>
                    )}
                  </ul>
                </div>
              </Alert>

              {!traces.anonymized_at && (
                <Alert type="info">
                  <span className="text-sm">
                    Si le RGPD l'exige, <strong>anonymiser</strong> retire le nom, l'adresse et
                    l'avatar en conservant tous les liens : « qui a validé ? » garde une réponse,
                    sans nommer personne. Irréversible.
                  </span>
                </Alert>
              )}
            </div>
          ) : (
            <p className="text-sm text-red-600 mt-2">
              Ce compte n'a laissé aucune trace : il sera réellement supprimé. Cette action est
              irréversible.
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
            Annuler
          </Button>
          {traces && traces.traces.total > 0 && !traces.anonymized_at && (
            <Button
              variant="outline"
              icon={<ShieldOff className="w-4 h-4" />}
              loading={anonymizeMutation.isPending}
              onClick={() => deleteConfirm && anonymizeMutation.mutate(deleteConfirm.id)}
            >
              Anonymiser (RGPD)
            </Button>
          )}
          <Button
            variant="danger"
            loading={deleteMutation.isPending}
            onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}
          >
            {traces && traces.traces.total > 0 ? 'Désactiver' : 'Supprimer'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
