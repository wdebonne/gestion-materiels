import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardBody, CardHeader, CardTitle, LoadingInline } from '@/components/ui'
import { cn } from '@/lib/utils'

/** Les pièces communes aux blocs de l'accueil. */

export function aujourdHui(decalageJours = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + decalageJours)
  // La date locale : `toISOString` basculerait au lendemain passé minuit en été.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Le lien « Voir tout → » d'un en-tête de bloc. */
export function LienEntete({ vers, children }: { vers: string; children: ReactNode }) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate(vers)}
      className="inline-flex min-h-[44px] items-center px-2 -mx-2 rounded-lg text-sm text-primary-600 hover:bg-primary-50 hover:text-primary-700 font-medium dark:hover:bg-primary-900/30"
    >
      {children}
    </button>
  )
}

export function CarteModule({
  titre,
  icone,
  lien,
  chargement,
  children,
}: {
  titre: string
  icone: ReactNode
  lien: string
  chargement?: boolean
  children: ReactNode
}) {
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <span className="text-gray-500 dark:text-gray-400">{icone}</span>
          {titre}
        </CardTitle>
        <LienEntete vers={lien}>Ouvrir →</LienEntete>
      </CardHeader>
      <CardBody className="space-y-4">{chargement ? <LoadingInline /> : children}</CardBody>
    </Card>
  )
}

export type Ton = 'danger' | 'attention' | 'info'

export const TONS: Record<Ton, string> = {
  danger: 'bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200',
  attention: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
  info: 'bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
}

export interface Compteur {
  libelle: string
  valeur: number
  ton: Ton
  lien: string
}

/** Des compteurs cliquables ; à zéro, grisés, pour que ce qui compte ressorte. */
export function Compteurs({ compteurs }: { compteurs: Compteur[] }) {
  const navigate = useNavigate()
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {compteurs.map((c) => (
        <button
          key={c.libelle}
          onClick={() => navigate(c.lien)}
          className={cn(
            'min-h-[64px] rounded-lg px-3 py-2 text-left transition-opacity hover:opacity-80',
            c.valeur > 0 ? TONS[c.ton] : 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
          )}
        >
          <span className="block text-2xl font-bold leading-tight">{c.valeur}</span>
          <span className="block text-xs">{c.libelle}</span>
        </button>
      ))}
    </div>
  )
}

export interface Ligne {
  cle: string | number
  titre: string
  detail?: string | null
  marque?: { texte: string; ton: Ton } | null
  lien: string
}

export function Lignes({ lignes, vide }: { lignes: Ligne[]; vide: string }) {
  const navigate = useNavigate()
  if (lignes.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{vide}</p>
  }
  return (
    <ul className="-mx-2 divide-y divide-gray-100 dark:divide-gray-700">
      {lignes.map((l) => (
        <li key={l.cle}>
          <button
            onClick={() => navigate(l.lien)}
            className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-gray-900 dark:text-gray-100">{l.titre}</span>
              {l.detail && <span className="block truncate text-sm text-gray-500 dark:text-gray-400">{l.detail}</span>}
            </span>
            {l.marque && (
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', TONS[l.marque.ton])}>
                {l.marque.texte}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
