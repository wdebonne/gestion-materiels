import { useEffect } from 'react'
import { Autocomplete } from '@/components/ui'

export interface ChoixRubrique {
  id: number
  libelle: string
}

/**
 * Le champ « Objet » d'un dépôt : rapport incendie, PPMS, vérification
 * électrique…
 *
 * **Seul, il ne s'affiche pas.** Une entreprise à qui l'on n'a ouvert que le
 * dépôt des rapports d'extincteurs n'a rien à choisir : lui montrer une liste
 * d'un seul élément, c'est lui poser une question dont on connaît la réponse.
 * La valeur est alors posée d'office. Au-delà d'un choix, c'est une saisie à
 * complétion — le catalogue d'une commune dépasse vite la vingtaine d'objets.
 *
 * Le même composant sert au bâtiment (champ « Bâtiment ») : la règle est la même.
 */
export default function ChampRubrique({
  options,
  valeur,
  onChange,
  libelle = 'Objet',
  facultatif = false,
  erreur,
}: {
  options: ChoixRubrique[]
  valeur: number | null
  onChange: (id: number | null) => void
  libelle?: string
  /** Laisse « non classé » possible : le gestionnaire classera à la validation. */
  facultatif?: boolean
  erreur?: string
}) {
  const seul = options.length === 1 ? options[0] : null

  useEffect(() => {
    if (seul && valeur !== seul.id) onChange(seul.id)
  }, [seul, valeur, onChange])

  if (options.length <= 1) return null

  return (
    <Autocomplete
      label={facultatif ? `${libelle} (facultatif)` : libelle}
      options={options.map((o) => ({ value: o.id, label: o.libelle }))}
      value={valeur ?? ''}
      onChange={(v) => onChange(v ? Number(v) : null)}
      placeholder={facultatif ? 'Non classé' : `Choisir…`}
      error={erreur}
    />
  )
}
