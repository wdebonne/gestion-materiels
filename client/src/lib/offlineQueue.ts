/**
 * File d'attente des saisies faites hors réseau.
 *
 * Sur le terrain — au fond d'un parc, dans un sous-sol d'atelier — le réseau
 * disparaît. Jusqu'ici, la saisie était simplement perdue : la requête
 * échouait et rien n'était conservé.
 *
 * Règles de sûreté, parce qu'une file d'attente peut mentir plus gravement
 * qu'une erreur franche :
 *   - seules les créations explicitement autorisées sont mises en file ;
 *   - aucune suppression n'est jamais différée ;
 *   - tant que la file n'est pas vide, un bandeau le rappelle en permanence.
 */

export interface QueuedMutation {
  id: string
  url: string
  method: 'POST' | 'PUT'
  body: unknown
  /** Ce que l'agent reconnaîtra : « Plein — Tracteur Kubota ». */
  label: string
  createdAt: number
  attempts: number
}

const BASE = 'gestion-materiels-hors-ligne'
const MAGASIN = 'saisies'
const MAX_TENTATIVES = 5

/**
 * Écritures différables. Liste volontairement fermée : mettre en file une
 * requête que le serveur refusera de toute façon reviendrait à promettre un
 * enregistrement qui n'aura jamais lieu.
 */
const URLS_AUTORISEES: RegExp[] = [
  /^\/objects\/\d+\/fuel$/,
  /^\/objects\/\d+\/maintenance$/,
  /^\/objects\/\d+\/technical-control$/,
  /^\/green-spaces\/\d+\/maintenances$/,
]

export function estDifferable(url: string, method: string): boolean {
  if (!['post', 'put'].includes(method.toLowerCase())) return false
  const chemin = url.split('?')[0].replace(/\/+$/, '')
  return URLS_AUTORISEES.some((motif) => motif.test(chemin))
}

// ---------------------------------------------------------------- stockage

/**
 * Repli en mémoire : navigation privée, IndexedDB indisponible, ou exécution
 * dans les tests. La file perd alors sa persistance mais reste fonctionnelle
 * pendant la session — mieux que de perdre la saisie immédiatement.
 */
const memoire = new Map<string, QueuedMutation>()

function indexedDBDisponible(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

function ouvrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const requete = indexedDB.open(BASE, 1)
    requete.onupgradeneeded = () => {
      const db = requete.result
      if (!db.objectStoreNames.contains(MAGASIN)) {
        db.createObjectStore(MAGASIN, { keyPath: 'id' })
      }
    }
    requete.onsuccess = () => resolve(requete.result)
    requete.onerror = () => reject(requete.error)
  })
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (magasin: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await ouvrir()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(MAGASIN, mode)
      const requete = operation(tx.objectStore(MAGASIN))
      requete.onsuccess = () => resolve(requete.result)
      requete.onerror = () => reject(requete.error)
    })
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------- API

function identifiant(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const offlineQueue = {
  async enqueue(saisie: Omit<QueuedMutation, 'id' | 'createdAt' | 'attempts'>): Promise<QueuedMutation> {
    const entree: QueuedMutation = {
      ...saisie,
      id: identifiant(),
      createdAt: Date.now(),
      attempts: 0,
    }

    if (indexedDBDisponible()) {
      try {
        await transaction('readwrite', (m) => m.put(entree))
        return entree
      } catch {
        // On bascule en mémoire plutôt que de perdre la saisie.
      }
    }
    memoire.set(entree.id, entree)
    return entree
  },

  async list(): Promise<QueuedMutation[]> {
    let entrees: QueuedMutation[] = []
    if (indexedDBDisponible()) {
      try {
        entrees = await transaction<QueuedMutation[]>('readonly', (m) => m.getAll())
      } catch {
        entrees = []
      }
    }
    const toutes = [...entrees, ...memoire.values()]
    return toutes.sort((a, b) => a.createdAt - b.createdAt)
  },

  async count(): Promise<number> {
    return (await offlineQueue.list()).length
  },

  async remove(id: string): Promise<void> {
    memoire.delete(id)
    if (indexedDBDisponible()) {
      try {
        await transaction('readwrite', (m) => m.delete(id))
      } catch {
        /* déjà retirée de la mémoire */
      }
    }
  },

  async clear(): Promise<void> {
    memoire.clear()
    if (indexedDBDisponible()) {
      try {
        await transaction('readwrite', (m) => m.clear())
      } catch {
        /* rien à faire */
      }
    }
  },

  /**
   * Rejoue les saisies en attente, dans leur ordre d'arrivée.
   *
   * `envoyer` est fourni par l'appelant pour que ce module ne dépende pas du
   * client HTTP — ce qui le rend testable et évite un import circulaire.
   *
   * Une saisie n'est retirée que si l'envoi a réussi, ou si le serveur l'a
   * refusée définitivement (4xx) : la rejouer indéfiniment ne servirait à rien.
   */
  async flush(
    envoyer: (saisie: QueuedMutation) => Promise<{ status: number }>
  ): Promise<{ ok: number; abandonnees: QueuedMutation[]; restantes: number }> {
    const enAttente = await offlineQueue.list()
    let ok = 0
    const abandonnees: QueuedMutation[] = []

    for (const saisie of enAttente) {
      try {
        await envoyer(saisie)
        await offlineQueue.remove(saisie.id)
        ok++
      } catch (erreur) {
        const status = (erreur as { response?: { status?: number } })?.response?.status

        // Refus définitif du serveur : inutile de réessayer.
        if (typeof status === 'number' && status >= 400 && status < 500) {
          await offlineQueue.remove(saisie.id)
          abandonnees.push(saisie)
          continue
        }

        const tentatives = saisie.attempts + 1
        if (tentatives >= MAX_TENTATIVES) {
          await offlineQueue.remove(saisie.id)
          abandonnees.push(saisie)
          continue
        }

        // Réseau toujours absent : on garde et on s'arrête là, l'ordre compte.
        const misAJour = { ...saisie, attempts: tentatives }
        if (indexedDBDisponible()) {
          try {
            await transaction('readwrite', (m) => m.put(misAJour))
          } catch {
            memoire.set(misAJour.id, misAJour)
          }
        } else {
          memoire.set(misAJour.id, misAJour)
        }
        break
      }
    }

    return { ok, abandonnees, restantes: await offlineQueue.count() }
  },
}
