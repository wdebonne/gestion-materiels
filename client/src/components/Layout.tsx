import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import { useSettingsStore } from '@/stores/settings.store'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useEffect, useState } from 'react'
import {
  LayoutGrid,
  Calendar,
  Bell,
  Settings,
  LogOut,
  User,
  Menu,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Wrench,
  FileText,
  Package,
  Truck,
  ClipboardList,
  Plug,
  Home,
  FolderOpen,
  BarChart3,
  CalendarClock,
  TrendingDown,
  FileSpreadsheet,
  MapPin,
  Sun,
  Moon,
  Monitor,
  Contrast,
  QrCode,
  PartyPopper,
  CalendarDays,
  TreePine
} from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'
import { useDarkMode } from '@/lib/useDarkMode'
import { useDisplayPrefs, TEXT_SIZE_LABELS } from '@/lib/useDisplayPrefs'
import { useTranslation } from 'react-i18next'
import { useRealtimeAlerts } from '@/lib/useWebSocket'
import MobileBottomBar from '@/components/MobileBottomBar'
import GlobalSearch from '@/components/GlobalSearch'
import OfflineBanner from '@/components/OfflineBanner'

export default function Layout() {
  const { user, logout } = useAuthStore()
  const { settings, fetchSettings } = useSettingsStore()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed')
    return saved ? JSON.parse(saved) : false
  })
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [rechercheOuverte, setRechercheOuverte] = useState(false)
  const { theme, setTheme } = useDarkMode()
  const { textSize, setTextSize, highContrast, setHighContrast } = useDisplayPrefs()
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  // WebSocket: invalider le compteur d'alertes en temps réel
  useRealtimeAlerts(() => {
    queryClient.invalidateQueries({ queryKey: ['alertsCount'] })
  })

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', JSON.stringify(sidebarCollapsed))
  }, [sidebarCollapsed])

  // Ctrl/Cmd + K : raccourci attendu par les habitués du clavier
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setRechercheOuverte(true)
      }
    }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [])

  // Récupérer le nombre d'alertes non lues
  const { data: alertsCount } = useQuery({
    queryKey: ['alertsCount'],
    queryFn: async () => {
      const response = await api.get('/alerts/count')
      return response.data.count
    },
    refetchInterval: 60000 // Rafraîchir toutes les minutes
  })

  // Récupérer les plugins de type menu
  const { data: menuPlugins = [] } = useQuery({
    queryKey: ['menuPlugins'],
    queryFn: async () => {
      const response = await api.get('/plugins/menu')
      return response.data
    }
  })

  // Récupérer les permissions pour le module Suivi
  const { data: trackingPermissions } = useQuery({
    queryKey: ['tracking-permissions'],
    queryFn: async () => {
      const response = await api.get('/tracking/permissions')
      return response.data
    }
  })

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  // Map des icônes pour les plugins (supporte minuscules et PascalCase)
  const iconMap: Record<string, any> = {
    Calendar,
    calendar: Calendar,
    Wrench,
    wrench: Wrench,
    FileText,
    filetext: FileText,
    Package,
    package: Package,
    Truck,
    truck: Truck,
    ClipboardList,
    clipboardlist: ClipboardList,
    'clipboard-check': ClipboardList,
    Bell,
    bell: Bell,
    LayoutGrid,
    layoutgrid: LayoutGrid,
    Plug,
    plug: Plug,
    fuel: Truck,
    BarChart3,
    barchart3: BarChart3,
    tracking: BarChart3,
    CalendarClock,
    'calendar-clock': CalendarClock,
    TrendingDown,
    'trending-down': TrendingDown,
    MapPin,
    'map-pin': MapPin,
    FileSpreadsheet,
    filespreadsheet: FileSpreadsheet,
    'file-spreadsheet': FileSpreadsheet,
    PartyPopper,
    partypopper: PartyPopper,
    'party-popper': PartyPopper,
    TreePine,
    treepine: TreePine,
    'tree-pine': TreePine
  }

  // Navigation de base
  const baseNavigation = [
    { name: t('nav.dashboard'), href: '/', icon: Home },
    { name: t('nav.categories'), href: '/categories', icon: FolderOpen },
    { name: t('nav.alerts'), href: '/alerts', icon: Bell, badge: alertsCount },
    { name: 'Manifestations', href: '/manifestations', icon: CalendarDays },
  ]

  // Ajouter le menu Suivi si l'utilisateur a les permissions
  if (trackingPermissions?.canView) {
    baseNavigation.push({ name: t('nav.tracking'), href: '/tracking', icon: BarChart3 })
  }

  // Plugins de type menu (inclut calendrier, réservations, amortissement, cartographie, import/export)
  const builtInPluginSlugs = ['calendar', 'reservations', 'depreciation', 'map', 'import-export', 'manifestations', 'espaces-verts']
  // Exclure les plugins déjà présents dans baseNavigation pour éviter les doublons
  const baseNavSlugs = ['manifestations']
  const pluginNavigation = menuPlugins
    .filter((plugin: any) => !baseNavSlugs.includes(plugin.slug))
    .map((plugin: any) => {
      const isBuiltIn = builtInPluginSlugs.includes(plugin.slug)
      return {
        name: plugin.name,
        href: isBuiltIn ? `/${plugin.route || plugin.slug}` : `/plugin/${plugin.slug}`,
        icon: iconMap[plugin.icon] || Plug
      }
    })

  const navigation = [...baseNavigation, ...pluginNavigation]

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar Mobile */}
      <div className={cn(
        "fixed inset-0 z-40 lg:hidden",
        sidebarOpen ? "block" : "hidden"
      )}>
        <div className="fixed inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
        <div className="fixed inset-y-0 left-0 w-64 bg-white shadow-xl dark:bg-gray-800">
          <SidebarContent 
            navigation={navigation} 
            settings={settings} 
            user={user}
            onClose={() => setSidebarOpen(false)}
          />
        </div>
      </div>

      {/* Sidebar Desktop */}
      <div className={cn(
        "hidden lg:fixed lg:inset-y-0 lg:flex lg:flex-col transition-all duration-300",
        sidebarCollapsed ? "lg:w-20" : "lg:w-64"
      )}>
        <div className="flex flex-col flex-grow bg-white border-r border-gray-100 shadow-[2px_0_20px_0_rgba(0,0,0,0.02)] dark:bg-gray-800 dark:border-gray-700">
          <SidebarContent 
            navigation={navigation} 
            settings={settings} 
            user={user} 
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        </div>
      </div>

      {/* Main content */}
      <div className={cn(
        "transition-all duration-300",
        sidebarCollapsed ? "lg:pl-20" : "lg:pl-64"
      )}>
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-200/50 shadow-sm dark:bg-gray-800/80 dark:border-gray-700/50">
          <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Ouvrir le menu"
              className="lg:hidden flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:hover:text-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <Menu className="w-6 h-6" />
            </button>

            <div className="flex-1" />

            {/*
              Scanner : accessible depuis n'importe quel écran.
              C'est le geste le plus direct sur le terrain — viser l'étiquette
              du matériel plutôt que le chercher dans l'arborescence.
            */}
            <NavLink
              to="/scan"
              aria-label="Scanner une étiquette"
              title="Scanner une étiquette"
              className={({ isActive }) => cn(
                'flex h-11 w-11 items-center justify-center rounded-lg transition-colors',
                isActive
                  ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100'
              )}
            >
              <QrCode className="w-6 h-6" />
            </NavLink>

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-100 transition-colors dark:hover:bg-gray-700"
              >
                <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-medium text-sm">
                  {user?.avatar ? (
                    <img src={user.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    getInitials(user?.firstName, user?.lastName)
                  )}
                </div>
                <span className="hidden sm:block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {user?.firstName} {user?.lastName}
                </span>
                <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              </button>

              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 dark:bg-gray-800 dark:border-gray-700">
                    <NavLink
                      to="/profile"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      <User className="w-4 h-4" />
                      {t('nav.profile')}
                    </NavLink>
                    {/* Thème */}
                    <div className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">
                      <span className="text-xs text-gray-600 dark:text-gray-400 uppercase font-medium">{t('theme.title')}</span>
                      <div className="flex items-center gap-1 mt-1.5">
                        {([
                          ['light', Sun, t('theme.light')],
                          ['dark', Moon, t('theme.dark')],
                          ['system', Monitor, t('theme.system')],
                        ] as const).map(([valeur, Icone, libelle]) => (
                          <button
                            key={valeur}
                            onClick={() => setTheme(valeur)}
                            className={cn(
                              'flex h-11 w-11 items-center justify-center rounded-lg transition-colors',
                              theme === valeur
                                ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                                : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                            )}
                            title={libelle}
                            aria-label={libelle}
                            aria-pressed={theme === valeur}
                          >
                            <Icone className="w-5 h-5" />
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Lisibilité — pour le travail en extérieur */}
                    <div className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">
                      <span className="text-xs text-gray-600 dark:text-gray-400 uppercase font-medium">Taille du texte</span>
                      <div className="flex items-center gap-1 mt-1.5">
                        {(['normal', 'large', 'xlarge'] as const).map((taille, index) => (
                          <button
                            key={taille}
                            onClick={() => setTextSize(taille)}
                            className={cn(
                              'flex h-11 min-w-[44px] flex-1 items-center justify-center rounded-lg transition-colors',
                              textSize === taille
                                ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                                : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                            )}
                            title={TEXT_SIZE_LABELS[taille]}
                            aria-label={'Taille du texte : ' + TEXT_SIZE_LABELS[taille]}
                            aria-pressed={textSize === taille}
                          >
                            <span style={{ fontSize: `${0.875 + index * 0.25}rem` }} className="font-semibold">A</span>
                          </button>
                        ))}
                      </div>

                      <button
                        onClick={() => setHighContrast(!highContrast)}
                        className={cn(
                          'mt-2 flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2 transition-colors',
                          highContrast
                            ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                            : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                        )}
                        aria-pressed={highContrast}
                      >
                        <Contrast className="w-5 h-5 flex-shrink-0" />
                        Contraste élevé
                      </button>
                    </div>
                    {user?.role === 'admin' && (
                      <NavLink
                        to="/settings"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      >
                        <Settings className="w-4 h-4" />
                        {t('nav.settings')}
                      </NavLink>
                    )}
                    <hr className="my-1" />
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      <LogOut className="w-4 h-4" />
                      {t('nav.logout')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <OfflineBanner />

        {/* Page content — la marge basse dégage la barre d'onglets mobile */}
        <main className="p-4 pb-24 sm:p-6 lg:p-8 lg:pb-8">
          <Outlet />
        </main>
      </div>

      <MobileBottomBar
        onOuvrirRecherche={() => setRechercheOuverte(true)}
        nombreAlertes={alertsCount}
      />

      <GlobalSearch ouvert={rechercheOuverte} onFermer={() => setRechercheOuverte(false)} />
    </div>
  )
}

interface SidebarContentProps {
  navigation: Array<{ name: string; href: string; icon: any; badge?: number }>
  settings: any
  user: any
  onClose?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

function SidebarContent({ navigation, settings, user, onClose, collapsed = false, onToggleCollapse }: SidebarContentProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200 dark:border-gray-700">
        <div className={cn(
          "flex items-center gap-3 overflow-hidden transition-all duration-300",
          collapsed && !onClose ? "justify-center w-full" : ""
        )}>
          {settings.site_logo && (
            <img src={settings.site_logo} alt="" className="w-8 h-8 object-contain flex-shrink-0" />
          )}
          {(!collapsed || onClose) && (
            <span className="font-semibold text-gray-900 truncate dark:text-gray-100">
              {settings.site_name}
            </span>
          )}
        </div>
        {onClose && (
          <button onClick={onClose} className="lg:hidden p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navigation.map((item) => (
          <NavLink
            key={item.name}
            to={item.href}
            onClick={onClose}
            title={collapsed && !onClose ? item.name : undefined}
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group relative",
              isActive
                ? "text-primary-900 bg-primary-50 shadow-soft dark:text-primary-300 dark:bg-primary-900/30"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200",
              collapsed && !onClose ? "justify-center px-2" : ""
            )}
          >
            {({ isActive }) => (
              <>
                <item.icon className={cn(
                  "w-5 h-5 transition-colors flex-shrink-0", 
                  isActive ? "text-primary-600" : "text-gray-600 group-hover:text-gray-600"
                )} />
                {(!collapsed || onClose) && (
                  <>
                    <span className="truncate">{item.name}</span>
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className="ml-auto bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-sm">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    )}
                  </>
                )}
                {collapsed && !onClose && item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full shadow-sm">
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Admin settings link */}
      {user?.role === 'admin' && (
        <div className="px-3 py-4 border-t border-gray-100 dark:border-gray-700">
          <NavLink
            to="/settings"
            onClick={onClose}
            title={collapsed && !onClose ? t('nav.settings') : undefined}
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group",
              isActive
                ? "text-primary-900 bg-primary-50 shadow-soft dark:text-primary-300 dark:bg-primary-900/30"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200",
              collapsed && !onClose ? "justify-center px-2" : ""
            )}
          >
            {({ isActive }) => (
              <>
                <Settings className={cn(
                  "w-5 h-5 transition-colors flex-shrink-0", 
                  isActive ? "text-primary-600" : "text-gray-600 group-hover:text-gray-600"
                )} />
                {(!collapsed || onClose) && <span>{t('nav.settings')}</span>}
              </>
            )}
          </NavLink>
        </div>
      )}

      {/* Toggle collapse button (desktop only) */}
      {onToggleCollapse && (
        <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700">
          <button aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
            onClick={onToggleCollapse}
            className={cn(
              "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-all duration-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200",
              collapsed ? "justify-center px-2" : ""
            )}
            title={collapsed ? t('nav.expand') : t('nav.collapse')}
          >
            {collapsed ? (
              <ChevronRight className="w-5 h-5 text-gray-400" />
            ) : (
              <>
                <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                <span>{t('nav.collapse')}</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Version */}
      <div className={cn(
        "px-4 py-3 text-xs text-gray-600 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700",
        collapsed && !onClose ? "text-center px-2" : ""
      )}>
        {collapsed && !onClose ? `v${settings.site_version?.split(' ')[0] || ''}` : `Version ${settings.site_version}`}
      </div>
    </div>
  )
}
