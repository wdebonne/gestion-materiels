import { describe, it, expect, beforeEach, vi } from 'vitest'
import { offlineQueue, estDifferable, type QueuedMutation } from '@/lib/offlineQueue'

/**
 * Filet de sécurité de la file hors ligne.
 *
 * Une file d'attente peut mentir plus gravement qu'une erreur franche : elle
 * annonce « enregistré » alors que rien n'est parti. Ces tests figent ce
 * qu'elle accepte de différer et ce qu'elle fait de chaque échec.
 */

const saisie = (label: string, url = '/objects/1/fuel') => ({
  url,
  method: 'POST' as const,
  body: { quantity: 42 },
  label,
})

beforeEach(async () => {
  await offlineQueue.clear()
})

describe('Écritures différables', () => {
  it('accepte les trois relevés de terrain et les entretiens d’espaces verts', () => {
    expect(estDifferable('/objects/12/fuel', 'post')).toBe(true)
    expect(estDifferable('/objects/12/maintenance', 'post')).toBe(true)
    expect(estDifferable('/objects/12/technical-control', 'post')).toBe(true)
    expect(estDifferable('/green-spaces/3/maintenances', 'post')).toBe(true)
  })

  it('ne diffère jamais une suppression', () => {
    expect(estDifferable('/objects/12/fuel', 'delete')).toBe(false)
    expect(estDifferable('/objects/12', 'delete')).toBe(false)
  })

  it('refuse tout ce qui n’est pas explicitement autorisé', () => {
    expect(estDifferable('/objects', 'post')).toBe(false)
    expect(estDifferable('/users', 'post')).toBe(false)
    expect(estDifferable('/objects/fuel-stations', 'post')).toBe(false)
    expect(estDifferable('/green-spaces', 'post')).toBe(false)
    // Une URL qui ressemble sans correspondre exactement
    expect(estDifferable('/objects/12/fuel/3', 'post')).toBe(false)
    expect(estDifferable('/autre/objects/12/fuel', 'post')).toBe(false)
  })

  it('ignore la chaîne de requête et la barre finale', () => {
    expect(estDifferable('/objects/12/fuel?x=1', 'post')).toBe(true)
    expect(estDifferable('/objects/12/fuel/', 'post')).toBe(true)
  })
})

describe('Mise en file', () => {
  it('conserve les saisies dans leur ordre d’arrivée', async () => {
    await offlineQueue.enqueue(saisie('Plein — Tracteur'))
    await offlineQueue.enqueue(saisie('Plein — Tondeuse'))

    const enAttente = await offlineQueue.list()
    expect(enAttente).toHaveLength(2)
    expect(enAttente.map((s) => s.label)).toEqual(['Plein — Tracteur', 'Plein — Tondeuse'])
  })

  it('attribue un identifiant unique et un horodatage', async () => {
    const a = await offlineQueue.enqueue(saisie('A'))
    const b = await offlineQueue.enqueue(saisie('B'))

    expect(a.id).not.toBe(b.id)
    expect(a.createdAt).toBeGreaterThan(0)
    expect(a.attempts).toBe(0)
  })

  it('compte ce qui reste à envoyer', async () => {
    expect(await offlineQueue.count()).toBe(0)
    await offlineQueue.enqueue(saisie('A'))
    expect(await offlineQueue.count()).toBe(1)
  })
})

describe('Rejeu', () => {
  it('vide la file quand tout passe', async () => {
    await offlineQueue.enqueue(saisie('A'))
    await offlineQueue.enqueue(saisie('B'))

    const envoyer = vi.fn().mockResolvedValue({ status: 201 })
    const bilan = await offlineQueue.flush(envoyer)

    expect(envoyer).toHaveBeenCalledTimes(2)
    expect(bilan.ok).toBe(2)
    expect(bilan.restantes).toBe(0)
    expect(bilan.abandonnees).toHaveLength(0)
  })

  it('rejoue dans l’ordre d’arrivée', async () => {
    await offlineQueue.enqueue(saisie('premier'))
    await offlineQueue.enqueue(saisie('second'))

    const vus: string[] = []
    await offlineQueue.flush(async (s) => {
      vus.push(s.label)
      return { status: 201 }
    })

    expect(vus).toEqual(['premier', 'second'])
  })

  it('garde la saisie et s’arrête si le réseau est toujours absent', async () => {
    await offlineQueue.enqueue(saisie('A'))
    await offlineQueue.enqueue(saisie('B'))

    // Erreur sans réponse = réseau coupé
    const envoyer = vi.fn().mockRejectedValue(new Error('Network Error'))
    const bilan = await offlineQueue.flush(envoyer)

    expect(bilan.ok).toBe(0)
    expect(bilan.restantes).toBe(2)
    // On n'insiste pas sur les suivantes : l'ordre doit être préservé
    expect(envoyer).toHaveBeenCalledTimes(1)
  })

  it('abandonne une saisie définitivement refusée par le serveur', async () => {
    await offlineQueue.enqueue(saisie('refusee'))
    await offlineQueue.enqueue(saisie('acceptee'))

    const envoyer = vi
      .fn()
      .mockRejectedValueOnce({ response: { status: 400 } })
      .mockResolvedValueOnce({ status: 201 })

    const bilan = await offlineQueue.flush(envoyer)

    expect(bilan.ok).toBe(1)
    expect(bilan.abandonnees.map((s) => s.label)).toEqual(['refusee'])
    expect(bilan.restantes).toBe(0)
  })

  it('abandonne après cinq tentatives infructueuses', async () => {
    await offlineQueue.enqueue(saisie('obstinee'))

    const envoyer = vi.fn().mockRejectedValue(new Error('Network Error'))
    for (let i = 0; i < 5; i++) {
      await offlineQueue.flush(envoyer)
    }

    expect(await offlineQueue.count()).toBe(0)
  })

  it('ne rejoue pas deux fois la même saisie', async () => {
    await offlineQueue.enqueue(saisie('unique'))

    const vus: string[] = []
    const envoyer = async (s: QueuedMutation) => {
      vus.push(s.id)
      return { status: 201 }
    }

    await offlineQueue.flush(envoyer)
    await offlineQueue.flush(envoyer)

    expect(vus).toHaveLength(1)
  })
})
