import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import { useSettingsStore } from '@/stores/settings.store'
import { useQuery } from '@tanstack/react-query'
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
  Wrench,
  FileText,
  Package,
  Truck,
  ClipboardList,
  Plug,
  Home,
  FolderOpen
} from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'

export default function Layout() {
  const { user, logout } = useAuthStore()
  const { settings, fetchSettings } = useSettingsStore()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

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
    fuel: Truck
  }

  // Navigation de base
  const baseNavigation = [
    { name: 'Tableau de bord', href: '/', icon: Home },
    { name: 'Catégories', href: '/categories', icon: FolderOpen },
    { name: 'Alertes', href: '/alerts', icon: Bell, badge: alertsCount },
  ]

  // Ajouter les plugins de type menu à la navigation
  const pluginNavigation = menuPlugins.map((plugin: any) => {
    // Le calendrier a une page dédiée, les autres utilisent la page dynamique
    const isBuiltIn = ['calendar'].includes(plugin.slug)
    return {
      name: plugin.name,
      href: isBuiltIn ? `/${plugin.route || plugin.slug}` : `/plugin/${plugin.slug}`,
      icon: iconMap[plugin.icon] || Plug
    }
  })

  const navigation = [...baseNavigation, ...pluginNavigation]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar Mobile */}
      <div className={cn(
        "fixed inset-0 z-40 lg:hidden",
        sidebarOpen ? "block" : "hidden"
      )}>
        <div className="fixed inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
        <div className="fixed inset-y-0 left-0 w-64 bg-white shadow-xl">
          <SidebarContent 
            navigation={navigation} 
            settings={settings} 
            user={user}
            onClose={() => setSidebarOpen(false)}
          />
        </div>
      </div>

      {/* Sidebar Desktop */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col">
        <div className="flex flex-col flex-grow bg-white border-r border-gray-100 shadow-[2px_0_20px_0_rgba(0,0,0,0.02)]">
          <SidebarContent navigation={navigation} settings={settings} user={user} />
        </div>
      </div>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-200/50 shadow-sm">
          <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 text-gray-500 hover:text-gray-700"
            >
              <Menu className="w-6 h-6" />
            </button>

            <div className="flex-1" />

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-medium text-sm">
                  {user?.avatar ? (
                    <img src={user.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    getInitials(user?.firstName, user?.lastName)
                  )}
                </div>
                <span className="hidden sm:block text-sm font-medium text-gray-700">
                  {user?.firstName} {user?.lastName}
                </span>
                <ChevronDown className="w-4 h-4 text-gray-500" />
              </button>

              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                    <NavLink
                      to="/profile"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <User className="w-4 h-4" />
                      Mon profil
                    </NavLink>
                    {user?.role === 'admin' && (
                      <NavLink
                        to="/settings"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        <Settings className="w-4 h-4" />
                        Paramètres
                      </NavLink>
                    )}
                    <hr className="my-1" />
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      <LogOut className="w-4 h-4" />
                      Déconnexion
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

interface SidebarContentProps {
  navigation: Array<{ name: string; href: string; icon: any; badge?: number }>
  settings: any
  user: any
  onClose?: () => void
}

function SidebarContent({ navigation, settings, user, onClose }: SidebarContentProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          {settings.site_logo && (
            <img src={settings.site_logo} alt="" className="w-8 h-8 object-contain" />
          )}
          <span className="font-semibold text-gray-900 truncate">
            {settings.site_name}
          </span>
        </div>
        {onClose && (
          <button onClick={onClose} className="lg:hidden p-2 text-gray-500 hover:text-gray-700">
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
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group relative",
              isActive
                ? "text-primary-900 bg-primary-50 shadow-soft"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            )}
          >
            {({ isActive }) => (
              <>
                <item.icon className={cn(
                  "w-5 h-5 transition-colors", 
                  isActive ? "text-primary-600" : "text-gray-400 group-hover:text-gray-600"
                )} />
                {item.name}
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-sm">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Admin settings link */}
      {user?.role === 'admin' && (
        <div className="px-3 py-4 border-t border-gray-100">
          <NavLink
            to="/settings"
            onClick={onClose}
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group",
              isActive
                ? "text-primary-900 bg-primary-50 shadow-soft"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            )}
          >
            {({ isActive }) => (
              <>
                <Settings className={cn(
                  "w-5 h-5 transition-colors", 
                  isActive ? "text-primary-600" : "text-gray-400 group-hover:text-gray-600"
                )} />
                Paramètres
              </>
            )}
          </NavLink>
        </div>
      )}

      {/* Version */}
      <div className="px-4 py-3 text-xs text-gray-400 border-t border-gray-200">
        Version {settings.site_version}
      </div>
    </div>
  )
}
