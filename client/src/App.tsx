import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import Layout from '@/components/Layout'
import SessionExpiredModal from '@/components/SessionExpiredModal'
import NotFoundPage from '@/pages/NotFoundPage'
import ScanPage from '@/pages/ScanPage'
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
import ApiPage from '@/pages/settings/ApiPage'
import ApiTokensPage from '@/pages/settings/ApiTokensPage'
import AuthSettingsPage from '@/pages/settings/AuthSettingsPage'
import ProfilePage from '@/pages/ProfilePage'
import PluginPage from '@/pages/PluginPage'
import CustomFieldsPage from '@/pages/CustomFieldsPage'
import TrackingPage from '@/pages/TrackingPage'
import ReservationsPage from '@/pages/ReservationsPage'
import DepreciationPage from '@/pages/DepreciationPage'
import ImportExportPage from '@/pages/ImportExportPage'
import MapPage from '@/pages/MapPage'
import ManifestationsPage from '@/pages/ManifestationsPage'
import EspacesVertsPage from '@/pages/EspacesVertsPage'

/** Page mémorisée par ProtectedRoute avant de renvoyer vers la connexion. */
export function getRedirectTarget(location: { state?: unknown }): string {
  const from = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from
  if (!from?.pathname) return '/'
  return `${from.pathname}${from.search ?? ''}`
}

// Route protégée
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!isAuthenticated) {
    // On mémorise la page demandée : un QR code scanné hors session doit
    // ramener sur la fiche du matériel après connexion, pas sur l'accueil.
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <>{children}</>
}

// Route publique (redirige si connecté)
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (isAuthenticated) {
    // C'est ici que la redirection se joue : dès que la connexion réussit,
    // ce composant se rend à nouveau et prend la main avant toute navigation
    // déclenchée par LoginPage. Il doit donc honorer lui-même la page demandée.
    return <Navigate to={getRedirectTarget(location)} replace />
  }

  return <>{children}</>
}

function App() {
  return (
    <>
      <SessionExpiredModal />
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
          <Route path="scan" element={<ScanPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="tracking" element={<TrackingPage />} />
          <Route path="reservations" element={<ReservationsPage />} />
          <Route path="depreciation" element={<DepreciationPage />} />
          <Route path="import-export" element={<ImportExportPage />} />
          <Route path="map" element={<MapPage />} />
          <Route path="manifestations" element={<ManifestationsPage />} />
          <Route path="espaces-verts" element={<EspacesVertsPage />} />
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
            <Route path="auth" element={<AuthSettingsPage />} />
            <Route path="smtp" element={<SmtpSettingsPage />} />
            <Route path="email-templates" element={<EmailTemplatesPage />} />
            <Route path="plugins" element={<PluginsPage />} />
            <Route path="backup" element={<BackupPage />} />
            <Route path="database" element={<DatabasePage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="webhooks" element={<WebhooksPage />} />
            <Route path="api" element={<ApiPage />} />
            <Route path="api-tokens" element={<ApiTokensPage />} />
          </Route>
        </Route>

        {/* 404 — on explique au lieu de rediriger silencieusement vers l'accueil */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  )
}

export default App
