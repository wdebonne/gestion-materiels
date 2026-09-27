import { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Clock, FileInput, PackageOpen, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { depuis, instantFr, jourFr, type Couleur, type Suivi } from '@/lib/comptabilite'

const TEINTES: Record<Couleur, { bord: string; pastille: string; texte: string; libelle: string }> = {
  vert: {
    bord: 'border-l-green-500',
    pastille: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    texte: 'text-green-700 dark:text-green-300',
    libelle: 'À jour',
  },
  orange: {
    bord: 'border-l-amber-500',
    pastille: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    texte: 'text-amber-800 dark:text-amber-200',
    libelle: 'En attente',
  },
  rouge: {
    bord: 'border-l-red-500',
    pastille: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    texte: 'text-red-700 dark:text-red-300',
    libelle: 'En retard',
  },
}

function Carte({
  couleur,
  icone,
  titre,
  qui,
  chiffre,
  detail,
  onClick,
  compact,
}: {
  couleur: Couleur | 'neutre'
  icone: ReactNode
  titre: string
  qui: string
  chiffre: ReactNode
  detail: ReactNode
  onClick?: () => void
  compact?: boolean
}) {
  const teinte = couleur === 'neutre' ? null : TEINTES[couleur]
  const Balise = onClick ? 'button' : 'div'
  return (
    <Balise
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'w-full rounded-xl border border-l-4 border-gray-100 bg-white text-left shadow-soft dark:border-gray-700 dark:bg-gray-800',
        teinte ? teinte.bord : 'border-l-gray-300 dark:border-l-gray-600',
        onClick && 'transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        compact ? 'p-3' : 'p-4'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
          {icone}
          {titre}
        </div>
        {teinte && (
          <span className={cn('shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', teinte.pastille)}>{teinte.libelle}</span>
        )}
      </div>
      <div className={cn('mt-2 font-bold text-gray-900 dark:text-gray-100', compact ? 'text-xl' : 'text-3xl')}>{chiffre}</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{detail}</div>
      {!compact && <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{qui}</div>}
    </Balise>
  )
}

/**
 * Qui attend qui, en quatre cartes : l'inventaire qui n'a pas rangé, l'envoi
 * qui n'est pas parti, la compta qui n'a pas intégré, et la date du dernier
 * export de Ciril importé ici.
 */
export default function CartesSuivi({
  suivi,
  compact = false,
  onOuvrir,
}: {
  suivi: Suivi
  compact?: boolean
  onOuvrir?: (onglet: 'ranger' | 'sorties' | 'import') => void
}) {
  const { aRanger, aEnvoyer, aIntegrer, dernierImport } = suivi
  const icone = 'h-4 w-4 text-gray-500 dark:text-gray-400'

  return (
    <div className={cn('grid gap-3', compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4')}>
      <Carte
        compact={compact}
        couleur={aRanger.couleur}
        icone={<PackageOpen className={icone} aria-hidden />}
        titre="À ranger"
        qui="À faire par : l’inventaire"
        chiffre={aRanger.nombre}
        detail={
          aRanger.nombre === 0
            ? 'Tout est rangé'
            : `bien${aRanger.nombre > 1 ? 's' : ''} importé${aRanger.nombre > 1 ? 's' : ''} de Ciril — le plus ancien ${depuis(aRanger.jours)}`
        }
        onClick={onOuvrir ? () => onOuvrir('ranger') : undefined}
      />
      <Carte
        compact={compact}
        couleur={aEnvoyer.couleur}
        icone={<Send className={icone} aria-hidden />}
        titre="Sorties à envoyer"
        qui="Part toute seule à l’heure réglée"
        chiffre={aEnvoyer.nombre}
        detail={
          aEnvoyer.echec && aEnvoyer.nombre > 0 ? (
            <span className="flex items-start gap-1 text-red-700 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Échec de l’envoi du {jourFr(aEnvoyer.echec.le)} : {aEnvoyer.echec.erreur}
            </span>
          ) : aEnvoyer.nombre === 0 ? (
            'Rien en attente'
          ) : aEnvoyer.prochainEnvoi ? (
            `Prochain envoi : ${instantFr(aEnvoyer.prochainEnvoi)}`
          ) : (
            'Envoi automatique désactivé : à envoyer à la main'
          )
        }
        onClick={onOuvrir ? () => onOuvrir('sorties') : undefined}
      />
      <Carte
        compact={compact}
        couleur={aIntegrer.couleur}
        icone={<CheckCircle2 className={icone} aria-hidden />}
        titre="À intégrer dans Ciril"
        qui="À faire par : la compta"
        chiffre={aIntegrer.envois === 0 ? 0 : `${aIntegrer.biens}`}
        detail={
          aIntegrer.envois === 0
            ? 'La compta est à jour'
            : `bien${aIntegrer.biens > 1 ? 's' : ''} dans ${aIntegrer.envois} envoi${aIntegrer.envois > 1 ? 's' : ''} — le plus ancien reçu ${depuis(aIntegrer.jours)}`
        }
        onClick={onOuvrir ? () => onOuvrir('sorties') : undefined}
      />
      <Carte
        compact={compact}
        couleur="neutre"
        icone={<FileInput className={icone} aria-hidden />}
        titre="Dernier import Ciril"
        qui="Apporte les nouvelles factures immobilisées"
        chiffre={dernierImport ? jourFr(dernierImport.le) : '—'}
        detail={
          dernierImport ? (
            <>
              {depuis(dernierImport.jours)}
              {dernierImport.par ? ` par ${dernierImport.par}` : ''} — {dernierImport.creees} nouvelle
              {dernierImport.creees > 1 ? 's' : ''}
            </>
          ) : (
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" aria-hidden /> Aucun import pour l’instant
            </span>
          )
        }
        onClick={onOuvrir ? () => onOuvrir('import') : undefined}
      />
    </div>
  )
}
