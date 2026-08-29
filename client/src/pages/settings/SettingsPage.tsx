import { Outlet, NavLink } from 'react-router-dom'
import { 
  Settings, 
  Users, 
  Mail, 
  FileText, 
  Puzzle, 
  Database,
  HardDrive,
  Lock,
  ScrollText,
  Webhook,
  Code2,
  Key,
  ShieldCheck, Inbox
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'

const settingsNavItems = [
  { 
    to: '/settings/general', 
    icon: Settings, 
    label: 'Général',
    adminOnly: true
  },
  { 
    to: '/settings/users', 
    icon: Users, 
    label: 'Utilisateurs',
    adminOnly: true
  },
  { 
    to: '/settings/permissions', 
    icon: Lock, 
    label: 'Droits',
    adminOnly: true
  },
  { 
    to: '/settings/auth', 
    icon: ShieldCheck, 
    label: 'Authentification',
    adminOnly: true
  },
  { 
    to: '/settings/smtp', 
    icon: Mail, 
    label: 'SMTP',
    adminOnly: true
  },
  { 
    to: '/settings/email-templates', 
    icon: FileText, 
    label: 'Templates Email',
    adminOnly: true
  },
  { 
    to: '/settings/plugins', 
    icon: Puzzle, 
    label: 'Plugins',
    adminOnly: true
  },
  { 
    to: '/settings/backup', 
    icon: HardDrive, 
    label: 'Sauvegardes',
    adminOnly: true
  },
  { 
    to: '/settings/database', 
    icon: Database, 
    label: 'Base de données',
    adminOnly: true
  },
  { 
    to: '/settings/logs', 
    icon: ScrollText, 
    label: 'Logs',
    adminOnly: true
  },
  { 
    to: '/settings/webhooks', 
    icon: Webhook, 
    label: 'Webhooks',
    adminOnly: true
  },
  { 
    to: '/settings/manifestations-reception', 
    icon: Inbox, 
    label: 'Réception manifestations',
    adminOnly: true
  },
  { 
    to: '/settings/api', 
    icon: Code2, 
    label: 'API',
    adminOnly: true
  },
  { 
    to: '/settings/api-tokens', 
    icon: Key, 
    label: 'Tokens API',
    adminOnly: true
  },
]

export default function SettingsPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  // Filtrer les éléments selon le rôle
  const visibleItems = settingsNavItems.filter(item => !item.adminOnly || isAdmin)

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Navigation latérale */}
      <nav className="lg:w-64 flex-shrink-0">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Paramètres</h2>
          </div>
          <ul className="p-2">
            {visibleItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-primary-50 text-primary-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`
                  }
                >
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Contenu principal */}
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
