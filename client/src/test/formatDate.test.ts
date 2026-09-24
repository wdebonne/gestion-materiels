import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime } from '@/lib/utils'

/**
 * Une date absente ne doit pas faire tomber un écran.
 *
 * Une alerte « retour en retard » arrivait sans échéance, et le tableau de bord
 * appelait `formatDate(null)` : l'application entière laissait place à l'écran
 * d'erreur dès le premier prêt en retard.
 */
describe('formatDate', () => {
  it.each([null, undefined, '', 'pas une date'])('rend un tiret pour %p', (valeur) => {
    expect(formatDate(valeur as any)).toBe('—')
    expect(formatDateTime(valeur as any)).toBe('—')
  })

  it('formate toujours une vraie date', () => {
    expect(formatDate('2026-03-18')).toMatch(/18 mars 2026/)
  })
})
