import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import Modal from '../components/ui/Modal'
import { useFenetreModale } from '../components/ui/useFenetreModale'

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

  it('une fenêtre dessinée à la main suit les mêmes règles, et la même pile', () => {
    const fermerModal = vi.fn()
    function FenetreMaison({ onFermer }: { onFermer: () => void }) {
      const fenetre = useFenetreModale(true, onFermer)
      return (
        <div ref={fenetre.ref} {...fenetre.proprietes} aria-labelledby={fenetre.idTitre}>
          <h4 id={fenetre.idTitre}>Street View</h4>
          <button onClick={onFermer}>Fermer la vue</button>
        </div>
      )
    }
    function Page() {
      const [vue, setVue] = useState(true)
      return (
        <Modal isOpen onClose={fermerModal} title="Élément">
          <p>Formulaire</p>
          {vue && <FenetreMaison onFermer={() => setVue(false)} />}
        </Modal>
      )
    }
    render(<Page />)

    const vue = screen.getByRole('dialog', { name: 'Street View' })
    expect(vue).toHaveAttribute('aria-modal', 'true')
    expect(vue.contains(document.activeElement)).toBe(true)

    // Échap ferme la vue, ouverte en dernier, et laisse le formulaire.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Street View' })).not.toBeInTheDocument()
    expect(fermerModal).not.toHaveBeenCalled()
  })
})
