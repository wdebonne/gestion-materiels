import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import Layout from '@/components/Layout'
import SessionExpiredModal from '@/components/SessionExpiredModal'
import NotFoundPage from '@/pages/NotFoundPage'
import { LoadingScreen } from '@/components/ui'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'


/*
 * Chargement à la demande.
 *
 * Les 37 pages étaient importées en dur : le navigateur téléchargeait
 * leaflet, fullcalendar, recharts et jsPDF avant même d'afficher l'écran
 * de connexion. Seuls la connexion, le tableau de bord et la page 404
 * restent en direct ; le reste arrive quand on y va.
 */
const ScanPage = lazy(() => import('@/pages/ScanPage'))
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'))
const CategoriesPage = lazy(() => import('@/pages/CategoriesPage'))
const CategoryDetailPage = lazy(() => import('@/pages/CategoryDetailPage'))
const SubcategoryDetailPage = lazy(() => import('@/pages/SubcategoryDetailPage'))
const ObjectDetailPage = lazy(() => import('@/pages/ObjectDetailPage'))
const CalendarPage = lazy(() => import('@/pages/CalendarPage'))
const AlertsPage = lazy(() => import('@/pages/AlertsPage'))
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'))
const GeneralSettingsPage = lazy(() => import('@/pages/settings/GeneralSettingsPage'))
const UsersPage = lazy(() => import('@/pages/settings/UsersPage'))
const PermissionsPage = lazy(() => import('@/pages/settings/PermissionsPage'))
const SmtpSettingsPage = lazy(() => import('@/pages/settings/SmtpSettingsPage'))
const EmailTemplatesPage = lazy(() => import('@/pages/settings/EmailTemplatesPage'))
const PluginsPage = lazy(() => import('@/pages/settings/PluginsPage'))
const BackupPage = lazy(() => import('@/pages/settings/BackupPage'))
const DatabasePage = lazy(() => import('@/pages/settings/DatabasePage'))
const LogsPage = lazy(() => import('@/pages/settings/LogsPage'))
const WebhooksPage = lazy(() => import('@/pages/settings/WebhooksPage'))
const ManifestationIntakePage = lazy(() => import('@/pages/settings/ManifestationIntakePage'))
const ServicesPage = lazy(() => import('@/pages/settings/ServicesPage'))
const ApiPage = lazy(() => import('@/pages/settings/ApiPage'))
const ApiTokensPage = lazy(() => import('@/pages/settings/ApiTokensPage'))
const AuthSettingsPage = lazy(() => import('@/pages/settings/AuthSettingsPage'))
const ProfilePage = lazy(() => import('@/pages/ProfilePage'))
const PluginPage = lazy(() => import('@/pages/PluginPage'))
const CustomFieldsPage = lazy(() => import('@/pages/CustomFieldsPage'))
const TrackingPage = lazy(() => import('@/pages/TrackingPage'))
const ReservationsPage = lazy(() => import('@/pages/ReservationsPage'))
const DepreciationPage = lazy(() => import('@/pages/DepreciationPage'))
const ImportExportPage = lazy(() => import('@/pages/ImportExportPage'))
const MapPage = lazy(() => import('@/pages/MapPage'))
const ManifestationsPage = lazy(() => import('@/pages/ManifestationsPage'))
const EspacesVertsPage = lazy(() => import('@/pages/EspacesVertsPage'))

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
      <Suspense fallback={<LoadingScreen message="Chargement…" />}>
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
            <Route path="manifestations-reception" element={<ManifestationIntakePage />} />
            <Route path="services" element={<ServicesPage />} />
            <Route path="api" element={<ApiPage />} />
            <Route path="api-tokens" element={<ApiTokensPage />} />
          </Route>
        </Route>

        {/* 404 — on explique au lieu de rediriger silencieusement vers l'accueil */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
    </>
  )
}

export default App
