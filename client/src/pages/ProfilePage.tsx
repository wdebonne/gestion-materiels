import { useState, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { User, Mail, Lock, Eye, EyeOff, Save, Camera, Trash2, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { Card, CardBody, CardHeader, CardTitle, Input, Button, Alert } from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'

export default function ProfilePage() {
  const { user, setAuth } = useAuthStore()
  const [activeTab, setActiveTab] = useState<'info' | 'password'>('info')
  
  // État du formulaire profil
  const [profileData, setProfileData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || ''
  })

  // État du formulaire mot de passe
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false
  })
  const [passwordError, setPasswordError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Mutation pour uploader l'avatar
  const uploadAvatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('avatar', file)
      return api.post('/auth/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
    },
    onSuccess: (response) => {
      const updatedUser = response.data.user
      setAuth(updatedUser, useAuthStore.getState().accessToken!, useAuthStore.getState().refreshToken!)
      toast.success('Avatar mis à jour')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'upload')
    }
  })

  // Mutation pour supprimer l'avatar
  const deleteAvatarMutation = useMutation({
    mutationFn: async () => {
      return api.delete('/auth/avatar')
    },
    onSuccess: () => {
      const currentUser = useAuthStore.getState().user
      if (currentUser) {
        setAuth(
          { ...currentUser, avatar: undefined },
          useAuthStore.getState().accessToken!,
          useAuthStore.getState().refreshToken!
        )
      }
      toast.success('Avatar supprimé')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la suppression')
    }
  })

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Vérifier le type
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (!allowed.includes(file.type)) {
      toast.error('Format non supporté. Utilisez : JPG, PNG, GIF ou WebP')
      return
    }

    // Vérifier la taille (5 MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Le fichier est trop volumineux (max 5 Mo)')
      return
    }

    uploadAvatarMutation.mutate(file)
    // Reset input pour pouvoir re-sélectionner le même fichier
    e.target.value = ''
  }

  // Mutation pour mettre à jour le profil
  const updateProfileMutation = useMutation({
    mutationFn: async (data: any) => {
      return api.put('/users/me', data)
    },
    onSuccess: (response) => {
      const updatedUser = response.data
      setAuth(updatedUser, useAuthStore.getState().accessToken!, useAuthStore.getState().refreshToken!)
      toast.success('Profil mis à jour')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la mise à jour')
    }
  })

  // Mutation pour changer le mot de passe
  const changePasswordMutation = useMutation({
    mutationFn: async (data: any) => {
      return api.put('/users/me/password', data)
    },
    onSuccess: () => {
      toast.success('Mot de passe modifié')
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setPasswordError('')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors du changement de mot de passe')
    }
  })

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateProfileMutation.mutate(profileData)
  }

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError('')

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError('Les mots de passe ne correspondent pas')
      return
    }

    if (passwordData.newPassword.length < 8) {
      setPasswordError('Le mot de passe doit contenir au moins 8 caractères')
      return
    }

    changePasswordMutation.mutate({
      currentPassword: passwordData.currentPassword,
      newPassword: passwordData.newPassword
    })
  }

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin':
        return 'Administrateur'
      case 'supervisor':
        return 'Superviseur'
      default:
        return 'Utilisateur'
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Mon profil</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Gérez vos informations personnelles</p>
      </div>

      {/* Avatar et infos de base */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-6">
            {/* Avatar avec upload */}
            <div className="relative group flex-shrink-0">
              <div className="w-20 h-20 rounded-full overflow-hidden bg-primary-100 flex items-center justify-center">
                {user?.avatar ? (
                  <img
                    src={user.avatar}
                    alt="Avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-2xl font-bold text-primary-600">
                    {user?.firstName?.charAt(0)}{user?.lastName?.charAt(0)}
                  </span>
                )}

                {/* Overlay au hover */}
                {(uploadAvatarMutation.isPending || deleteAvatarMutation.isPending) ? (
                  <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                  </div>
                ) : (
                  <div
                    className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center hover-reveal cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Camera className="w-6 h-6 text-white" />
                  </div>
                )}
              </div>

              {/* Bouton supprimer avatar */}
              {user?.avatar && !uploadAvatarMutation.isPending && !deleteAvatarMutation.isPending && (
                <button
                  onClick={() => deleteAvatarMutation.mutate()}
                  className="absolute -bottom-1 -right-1 w-7 h-7 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-md transition-colors"
                  title="Supprimer l'avatar" aria-label="Supprimer l'avatar"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Input fichier caché */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                onChange={handleAvatarChange}
                className="hidden"
              />
            </div>

            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {user?.firstName} {user?.lastName}
              </h2>
              <p className="text-gray-500 dark:text-gray-400">{user?.email}</p>
              <span className="inline-block mt-2 px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm rounded-full">
                {getRoleLabel(user?.role || 'user')}
              </span>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Onglets */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-6 -mb-px">
          <button
            onClick={() => setActiveTab('info')}
            className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === 'info'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <User className="w-4 h-4 inline-block mr-2" />
            Informations
          </button>
          <button
            onClick={() => setActiveTab('password')}
            className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === 'password'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Lock className="w-4 h-4 inline-block mr-2" />
            Mot de passe
          </button>
        </nav>
      </div>

      {/* Formulaire informations */}
      {activeTab === 'info' && (
        <Card>
          <CardHeader>
            <CardTitle>Informations personnelles</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleProfileSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Prénom"
                  value={profileData.firstName}
                  onChange={(e) => setProfileData({ ...profileData, firstName: e.target.value })}
                  icon={<User className="w-5 h-5" />}
                  required
                />
                <Input
                  label="Nom"
                  value={profileData.lastName}
                  onChange={(e) => setProfileData({ ...profileData, lastName: e.target.value })}
                  icon={<User className="w-5 h-5" />}
                  required
                />
              </div>

              <Input
                label="Adresse email"
                type="email"
                value={profileData.email}
                onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                icon={<Mail className="w-5 h-5" />}
                required
              />

              <div className="flex justify-end pt-4">
                <Button 
                  type="submit" 
                  icon={<Save className="w-4 h-4" />}
                  loading={updateProfileMutation.isPending}
                >
                  Enregistrer
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {/* Formulaire mot de passe */}
      {activeTab === 'password' && (
        <Card>
          <CardHeader>
            <CardTitle>Changer le mot de passe</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              {passwordError && (
                <Alert type="error">{passwordError}</Alert>
              )}

              <Input
                label="Mot de passe actuel"
                type={showPasswords.current ? 'text' : 'password'}
                value={passwordData.currentPassword}
                onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                icon={<Lock className="w-5 h-5" />}
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowPasswords({ ...showPasswords, current: !showPasswords.current })}
                    className="hover:text-gray-600"
                  >
                    {showPasswords.current ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                }
                required
              />

              <Input
                label="Nouveau mot de passe"
                type={showPasswords.new ? 'text' : 'password'}
                value={passwordData.newPassword}
                onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                icon={<Lock className="w-5 h-5" />}
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })}
                    className="hover:text-gray-600"
                  >
                    {showPasswords.new ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                }
                hint="Minimum 8 caractères"
                required
              />

              <Input
                label="Confirmer le mot de passe"
                type={showPasswords.confirm ? 'text' : 'password'}
                value={passwordData.confirmPassword}
                onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                icon={<Lock className="w-5 h-5" />}
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowPasswords({ ...showPasswords, confirm: !showPasswords.confirm })}
                    className="hover:text-gray-600"
                  >
                    {showPasswords.confirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                }
                required
              />

              <div className="flex justify-end pt-4">
                <Button 
                  type="submit" 
                  icon={<Save className="w-4 h-4" />}
                  loading={changePasswordMutation.isPending}
                >
                  Changer le mot de passe
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
