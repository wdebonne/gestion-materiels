import { describe, expect, it } from 'vitest'
import { BLOCS, fusionnerBlocs } from '@/lib/accueil'

/**
 * La disposition enregistrée rencontre le catalogue : c'est là qu'un bloc
 * ajouté par une mise à jour doit apparaître, et un bloc retiré disparaître,
 * sans que personne ait à tout recomposer.
 */
describe('fusionnerBlocs', () => {
  const tout = () => true

  it("rend le catalogue dans son ordre quand rien n'est enregistré", () => {
    const blocs = fusionnerBlocs(null, tout)
    expect(blocs.map((b) => b.id)).toEqual(BLOCS.map((b) => b.id))
    expect(blocs.every((b) => b.visible && b.disponible)).toBe(true)
  })

  it("garde l'ordre et la visibilité choisis, ignore l'inconnu et les doublons", () => {
    const blocs = fusionnerBlocs(
      [
        { id: 'alertes', visible: false },
        { id: 'disparu', visible: true },
        { id: 'tickets', visible: true },
        { id: 'alertes', visible: true },
      ],
      tout
    )
    expect(blocs[0]).toMatchObject({ id: 'alertes', visible: false })
    expect(blocs[1]).toMatchObject({ id: 'tickets', visible: true })
    expect(blocs.map((b) => b.id)).not.toContain('disparu')
    expect(blocs).toHaveLength(BLOCS.length)
  })

  it('ajoute à la fin, visibles, les blocs apparus depuis', () => {
    const blocs = fusionnerBlocs([{ id: 'parc', visible: true }], tout)
    expect(blocs[0].id).toBe('parc')
    expect(blocs.slice(1).every((b) => b.visible)).toBe(true)
  })

  it('marque indisponible un bloc dont le module est absent, sans le déplacer', () => {
    const blocs = fusionnerBlocs(null, (b) => b.module !== 'batiments')
    const batiments = blocs.find((b) => b.id === 'batiments')!
    expect(batiments.disponible).toBe(false)
    expect(blocs.indexOf(batiments)).toBe(BLOCS.findIndex((b) => b.id === 'batiments'))
  })
})
