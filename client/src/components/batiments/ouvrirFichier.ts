import toast from 'react-hot-toast'

/**
 * Ouvre ou télécharge un fichier reçu en blob.
 *
 * Les documents de bâtiment ne sont jamais servis par une URL qu'on pourrait
 * coller ailleurs : ils passent par une requête authentifiée, puis par une URL
 * `blob:` locale, révoquée après usage. Un PDF ou une image s'ouvrent dans un
 * onglet ; le reste se télécharge sous son nom d'origine.
 *
 * `charger` est passé par l'appelant : le portail des entreprises lit ses
 * fichiers avec sa propre session, par une autre instance HTTP.
 */
export async function ouvrirFichier(
  charger: () => Promise<{ data: Blob }>,
  nom: string,
  mode: 'ouvrir' | 'telecharger' = 'ouvrir'
): Promise<void> {
  // L'onglet est ouvert **avant** l'attente : ouvert après, le navigateur le
  // prendrait pour une fenêtre surgissante et le bloquerait.
  const onglet = mode === 'ouvrir' ? window.open('', '_blank') : null

  try {
    const { data } = await charger()
    const url = URL.createObjectURL(data)
    const lisible = /^(application\/pdf|image\/(png|jpe?g|webp))/.test(data.type)

    if (onglet && lisible) {
      onglet.location.href = url
    } else {
      onglet?.close()
      const lien = document.createElement('a')
      lien.href = url
      lien.download = nom
      document.body.appendChild(lien)
      lien.click()
      lien.remove()
    }
    // Assez longtemps pour que l'onglet ait chargé le fichier.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (erreur: any) {
    onglet?.close()
    toast.error(await messageDErreur(erreur))
  }
}

/** Le message d'une erreur dont le corps est arrivé en blob. */
async function messageDErreur(erreur: any): Promise<string> {
  const corps = erreur?.response?.data
  if (corps instanceof Blob) {
    try {
      return JSON.parse(await corps.text()).message ?? 'Fichier inaccessible'
    } catch {
      /* corps illisible : message générique */
    }
  }
  return erreur?.response?.data?.message ?? 'Fichier inaccessible'
}
