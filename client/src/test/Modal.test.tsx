import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import Modal from '../components/ui/Modal'

/**
 * La fenêtre modale partagée : ce qu'un lecteur d'écran et un clavier en
 * attendent. Toutes les fenêtres de l'application en héritent.
 */
describe('Modal', () => {
  it('s’annonce comme une fenêtre, nommée par son titre', () => {
    render(
      <Modal isOpen onClose={() => {}} title="Nouvelle réservation">
        <p>Contenu</p>
      </Modal>
    )
    const fenetre = screen.getByRole('dialog', { name: 'Nouvelle réservation' })
    expect(fenetre).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument()
  })

  it('prend un nom explicite sans titre visible, et le rôle demandé', () => {
    render(
      <Modal isOpen onClose={() => {}} ariaLabel="Supprimer ce matériel ?" role="alertdialog" showCloseButton={false}>
        <button>Supprimer</button>
      </Modal>
    )
    expect(screen.getByRole('alertdialog', { name: 'Supprimer ce matériel ?' })).toBeInTheDocument()
  })

  it('place le focus dedans, et le rend au bouton qui l’a ouverte', () => {
    function Page() {
      const [ouvert, setOuvert] = useState(false)
      return (
        <>
          <button onClick={() => setOuvert(true)}>Ouvrir</button>
          <Modal isOpen={ouvert} onClose={() => setOuvert(false)} title="Fenêtre">
            <input aria-label="Nom" />
          </Modal>
        </>
      )
    }
    render(<Page />)
    const declencheur = screen.getByRole('button', { name: 'Ouvrir' })
    declencheur.focus()
    fireEvent.click(declencheur)

    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(declencheur)
  })

  it('garde Tab dans la fenêtre', () => {
    render(
      <Modal isOpen onClose={() => {}} title="Fenêtre">
        <button>Premier</button>
        <button>Dernier</button>
      </Modal>
    )
    const fermer = screen.getByRole('button', { name: 'Fermer' })
    const dernier = screen.getByRole('button', { name: 'Dernier' })

    dernier.focus()
    fireEvent.keyDown(dernier, { key: 'Tab' })
    expect(document.activeElement).toBe(fermer)

    fireEvent.keyDown(fermer, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(dernier)
  })

  it('Échap ne ferme que la fenêtre du dessus, et la page reste bloquée tant qu’il en reste une', () => {
    const fermerDessous = vi.fn()
    function Pile() {
      const [dessus, setDessus] = useState(true)
      return (
        <>
          <Modal isOpen onClose={fermerDessous} title="Formulaire">
            <p>Formulaire</p>
          </Modal>
          <Modal isOpen={dessus} onClose={() => setDessus(false)} title="Confirmation">
            <p>Sûr ?</p>
          </Modal>
        </>
      )
    }
    render(<Pile />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Confirmation' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Formulaire' })).toBeInTheDocument()
    expect(fermerDessous).not.toHaveBeenCalled()
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(fermerDessous).toHaveBeenCalledTimes(1)
  })
})
