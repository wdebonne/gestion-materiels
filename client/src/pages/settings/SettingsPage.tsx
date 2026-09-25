import { Outlet, NavLink } from 'react-router-dom'
import { 
  Settings, 
  Users, 
  Mail, 
  Puzzle, 
  Database,
  HardDrive,
  Lock,
  ScrollText,
  Webhook,
  Code2,
  Key,
  ShieldCheck, CalendarDays, Bell, TreePine, MapPin, CalendarClock, KeyRound, Cloud, Clock,
  LifeBuoy, Network, Building2
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { useGestion } from '@/lib/gestion'

interface EntreeParametres {
  to: string
  icon: typeof Settings
  label: string
  /** Réservé à l'administrateur. */
  adminOnly?: boolean
  /**
   * Ouvert au superviseur en plus de l'administrateur, dans une forme réduite
   * que l'écran lui-même se charge de tenir — et que le serveur impose.
   */
  manageOnly?: boolean
  /**
   * Ouvert à qui gère au moins un bâtiment ou un service, quel que soit son
   * rôle : c'est le seul onglet qu'un agent gestionnaire de l'école y trouve.
   */
  gestionOnly?: boolean
  /**
   * Ouvert à qui gère **tous** les lieux — administrateur, superviseur,
   * gestionnaire de l'organisation : le catalogue des contrôles des bâtiments
   * vaut pour tous, le gestionnaire d'une seule école n'a pas à le changer.
   */
  lieuxOnly?: boolean
}

const settingsNavItems: EntreeParametres[] = [
  {
    to: '/settings/organisation',
    icon: Network,
    // Bâtiments, salles et services servent à tous les modules : ils se
    // tiennent ici, et non plus dans celui qui les a vus naître.
    label: 'Organisation',
    gestionOnly: true
  },
  {
    to: '/settings/batiments',
    icon: Building2,
    // La périodicité et le délai de rappel de chaque contrôle obligatoire.
    label: 'Bâtiments',
    lieuxOnly: true
  },
  {
    to: '/settings/tickets',
    icon: LifeBuoy,
    // Ouvert au superviseur pour le référentiel — statuts, catégories, routage :
    // c'est lui qui connaît l'organisation de son service. Le rattachement des
    // personnes aux bâtiments reste à l'administrateur, parce qu'il décide de
    // qui lit les demandes des autres.
    label: 'Tickets',
    manageOnly: true
  },
  {
    to: '/settings/plannings',
    icon: Clock,
    // Ouvert au superviseur pour qu'il voie qui il encadre et repère les
    // agents rattachés à personne — dont les heures ne remontent nulle part.
    // Le rattachement lui-même reste à l'administrateur : pouvoir s'attribuer
    // des agents reviendrait à élargir seul son propre périmètre.
    label: 'Plannings',
    manageOnly: true
  },
  {
    to: '/settings/general',
    icon: Settings,
    label: 'Général',
    adminOnly: true
  },
  {
    to: '/settings/users',
    icon: Users,
    // Le superviseur n'y voit que les personnes sans compte : c'est lui qui
    // remet les clés, et le renvoyer vers l'administrateur pour inscrire un nom
    // manquant le renverrait en pratique vers « un externe », donc vers du
    // texte libre — ce que cet annuaire existe pour éviter.
    label: 'Utilisateurs',
    manageOnly: true
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
    to: '/settings/email', 
    icon: Mail, 
    label: 'Emails',
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
    to: '/settings/manifestations', 
    icon: CalendarDays, 
    label: 'Manifestations',
    adminOnly: true
  },
  { 
    to: '/settings/espaces-verts', 
    icon: TreePine, 
    label: 'Espaces verts',
    adminOnly: true
  },
  {
    to: '/settings/cartographie',
    icon: MapPin,
    label: 'Cartographie',
    adminOnly: true
  },
  {
    to: '/settings/cles',
    icon: KeyRound,
    label: 'Clés',
    adminOnly: true
  },
  { 
    to: '/settings/agendas', 
    icon: CalendarClock, 
    label: 'Agendas externes',
    adminOnly: true
  },
  { 
    to: '/settings/nextcloud', 
    icon: Cloud, 
    label: 'Nextcloud',
    adminOnly: true
  },
  { 
    to: '/settings/notifications', 
    icon: Bell, 
    label: 'Notifications',
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
  const canManage = isAdmin || user?.role === 'supervisor'
  const { gereQuelqueChose, gereLieux } = useGestion()

  // Filtrer les éléments selon le rôle
  const visibleItems = settingsNavItems.filter(
    (item) =>
      (!item.adminOnly || isAdmin) &&
      (!item.manageOnly || canManage) &&
      (!item.gestionOnly || isAdmin || gereQuelqueChose) &&
      (!item.lieuxOnly || gereLieux) &&
      // Hors encadrement, seules l'organisation et les bâtiments sont ouverts.
      (canManage || item.gestionOnly || item.lieuxOnly)
  )

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
