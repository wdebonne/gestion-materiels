import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Input from '../components/ui/Input'
import Select from '../components/ui/Select'
import TextArea from '../components/ui/TextArea'

/**
 * Un champ se nomme par son libellé, même sans `id` ni `name` : c'est ce qu'un
 * lecteur d'écran annonce, et ce qu'un test vise.
 */
describe('Libellés des champs', () => {
  it('relie le libellé au champ sans id ni name', () => {
    render(
      <>
        <Input label="Nom du raccourci" />
        <Select label="Confiée à" options={[{ value: '', label: 'Non affectée' }]} />
        <TextArea label="Commentaire" />
      </>
    )
    expect(screen.getByLabelText('Nom du raccourci').tagName).toBe('INPUT')
    expect(screen.getByLabelText('Confiée à').tagName).toBe('SELECT')
    expect(screen.getByLabelText('Commentaire').tagName).toBe('TEXTAREA')
  })

  it('garde l’id fourni', () => {
    render(<Input id="nom" label="Nom" />)
    expect(screen.getByLabelText('Nom')).toHaveAttribute('id', 'nom')
  })
})
