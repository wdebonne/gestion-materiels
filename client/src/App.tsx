import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import Layout from '@/components/Layout'
import LoginPage from '@/pages/LoginPage'
import ForgotPasswordPage from '@/pages/ForgotPasswordPage'
import ResetPasswordPage from '@/pages/ResetPasswordPage'
import DashboardPage from '@/pages/DashboardPage'
import CategoriesPage from '@/pages/CategoriesPage'
import CategoryDetailPage from '@/pages/CategoryDetailPage'
import SubcategoryDetailPage from '@/pages/SubcategoryDetailPage'
import ObjectDetailPage from '@/pages/ObjectDetailPage'
import CalendarPage from '@/pages/CalendarPage'
import AlertsPage from '@/pages/AlertsPage'
import SettingsPage from '@/pages/settings/SettingsPage'
import GeneralSettingsPage from '@/pages/settings/GeneralSettingsPage'
import UsersPage from '@/pages/settings/UsersPage'
import PermissionsPage from '@/pages/settings/PermissionsPage'
import SmtpSettingsPage from '@/pages/settings/SmtpSettingsPage'
import EmailTemplatesPage from '@/pages/settings/EmailTemplatesPage'
import PluginsPage from '@/pages/settings/PluginsPage'
import BackupPage from '@/pages/settings/BackupPage'
import DatabasePage from '@/pages/settings/DatabasePage'
import LogsPage from '@/pages/settings/LogsPage'
import WebhooksPage from '@/pages/settings/WebhooksPage'
import ProfilePage from '@/pages/ProfilePage'
import PluginPage from '@/pages/PluginPage'
import CustomFieldsPage from '@/pages/CustomFieldsPage'

// Route protégée
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

// Route publique (redirige si connecté)
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

function App() {
  return (
    <Routes>
      {/* Routes publiques */}
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
      <Route path="/reset-password/:token" element={<PublicRoute><ResetPasswordPage /></PublicRoute>} />

      {/* Routes protégées */}
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="categories/:categorySlug" element={<CategoryDetailPage />} />
        <Route path="categories/:categorySlug/fields" element={<CustomFieldsPage />} />
        <Route path="categories/:categorySlug/:subcategorySlug" element={<SubcategoryDetailPage />} />
        <Route path="categories/:categorySlug/:subcategorySlug/fields" element={<CustomFieldsPage />} />
        <Route path="objects/:objectId" element={<ObjectDetailPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        
        {/* Routes dynamiques pour les plugins de type menu */}
        <Route path="plugin/:pluginSlug" element={<PluginPage />} />
        <Route path="plugin/:pluginSlug/:pageName" element={<PluginPage />} />
        
        {/* Routes des paramètres */}
        <Route path="settings" element={<SettingsPage />}>
          <Route index element={<Navigate to="general" replace />} />
          <Route path="general" element={<GeneralSettingsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="permissions" element={<PermissionsPage />} />
          <Route path="smtp" element={<SmtpSettingsPage />} />
          <Route path="email-templates" element={<EmailTemplatesPage />} />
          <Route path="plugins" element={<PluginsPage />} />
          <Route path="backup" element={<BackupPage />} />
          <Route path="database" element={<DatabasePage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="webhooks" element={<WebhooksPage />} />
        </Route>
      </Route>

      {/* 404 */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
