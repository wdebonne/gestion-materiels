import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import FenetreSortie from '../components/comptabilite/FenetreSortie'
import CartesSuivi from '../components/comptabilite/CartesSuivi'
import MobileBottomBar from '../components/MobileBottomBar'
import type { Suivi } from '../lib/comptabilite'

/**
 * La passerelle comptable, côté écran : la fenêtre de sortie, les cartes qui
 * disent qui attend qui, et l'application réduite d'un comptable.
 */

describe('FenetreSortie', () => {
  it('s’annonce, et ne sort rien tant que le motif n’est pas choisi', () => {
    const onValider = vi.fn()
    render(
      <FenetreSortie ouverte nomObjet="Armoire bureau 12" numeroComptable="IMM-001" enCours={false} onFermer={() => {}} onValider={onValider} />
    )
    expect(screen.getByRole('dialog', { name: 'Sortir de l’inventaire' })).toBeInTheDocument()
    expect(screen.getByText(/IMM-001/)).toBeInTheDocument()

    const valider = screen.getByRole('button', { name: 'Sortir de l’inventaire' })
    expect(valider).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Motif/), { target: { value: 'casse' } })
    fireEvent.change(screen.getByLabelText('Commentaire'), { target: { value: 'Porte arrachée' } })
    fireEvent.click(valider)
    expect(onValider).toHaveBeenCalledWith(expect.objectContaining({ motif: 'casse', commentaire: 'Porte arrachée' }))
  })

  it('prévient quand la compta ne sera pas concernée, et demande le prix d’une vente', () => {
    render(<FenetreSortie ouverte nomObjet="Chaise" numeroComptable={null} enCours={false} onFermer={() => {}} onValider={() => {}} />)
    expect(screen.getByText(/la compta ne sera pas prévenue/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Prix de vente/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Motif/), { target: { value: 'vendu' } })
    expect(screen.getByLabelText(/Prix de vente/)).toBeInTheDocument()
  })
})

const SUIVI: Suivi = {
  seuil: 7,
  aRanger: { nombre: 12, plusAncien: '2026-09-18 08:00:00', jours: 9, couleur: 'rouge' },
  aEnvoyer: { nombre: 3, plusAncienne: '2026-09-27 09:00:00', jours: 0, prochainEnvoi: '2026-09-27 18:10:00', echec: null, couleur: 'orange' },
  horsCompta: 0,
  aIntegrer: { envois: 0, biens: 0, plusAncien: null, jours: null, couleur: 'vert' },
  dernierImport: { le: '2026-09-12 10:00:00', par: 'Claire Compta', lignes: 40, creees: 3, misesAJour: 1, jours: 15 },
  mouvements: [],
}

describe('CartesSuivi', () => {
  it('dit qui attend qui, et chaque carte ouvre sa liste', () => {
    const onOuvrir = vi.fn()
    render(<CartesSuivi suivi={SUIVI} onOuvrir={onOuvrir} />)

    expect(screen.getByText('En retard')).toBeInTheDocument()
    expect(screen.getByText(/le plus ancien il y a 9 jours/)).toBeInTheDocument()
    expect(screen.getByText('Prochain envoi : 27/09/2026 à 18:10')).toBeInTheDocument()
    expect(screen.getByText('La compta est à jour')).toBeInTheDocument()
    expect(screen.getByText(/par Claire Compta — 3 nouvelles/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /À ranger/ }))
    expect(onOuvrir).toHaveBeenCalledWith('ranger')
  })

  it('met en avant un envoi en échec', () => {
    render(
      <CartesSuivi
        suivi={{ ...SUIVI, aEnvoyer: { ...SUIVI.aEnvoyer, echec: { le: '2026-09-26 18:10:00', erreur: 'Nextcloud injoignable' }, couleur: 'rouge' } }}
      />
    )
    expect(screen.getByText(/Échec de l’envoi du 26\/09\/2026 : Nextcloud injoignable/)).toBeInTheDocument()
  })
})

describe('MobileBottomBar', () => {
  it('se réduit à la comptabilité et au profil pour un comptable', () => {
    render(
      <MemoryRouter>
        <MobileBottomBar onOuvrirRecherche={() => {}} moduleSeul="comptabilite" />
      </MemoryRouter>
    )
    const liens = screen.getAllByRole('link').map((l) => l.textContent)
    expect(liens).toEqual(['Comptabilité', 'Profil'])
    expect(screen.queryByText('Scanner')).not.toBeInTheDocument()
  })
})
