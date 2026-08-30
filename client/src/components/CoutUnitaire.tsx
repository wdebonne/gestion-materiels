import { Input } from '@/components/ui'

/**
 * Combien coûte une unité de ce matériel.
 *
 * Sert à chiffrer une manifestation, et le sens du nombre suit la nature :
 *
 * - **lot** — le prix d'une unité, 50 € la chaise. Ce qui ne revient pas au
 *   retour se chiffre en multipliant : dix chaises prêtées, neuf rendues, la
 *   dixième coûte 50 €.
 * - **prestation** — le coût d'une unité déployée : la vacation d'un agent, le
 *   forfait d'un raccordement. Trois agents à 120 € font 360 € de prestation.
 * - **exemplaire** — la valeur de remplacement, retenue seulement s'il revient
 *   perdu.
 *
 * Laisser zéro n'est pas une erreur : le matériel n'entre alors dans aucun
 * calcul. Mieux vaut cela qu'un tarif inventé, qui se retrouverait dans un
 * décompte présenté à un organisateur.
 */

const AIDE: Record<'unique' | 'lot' | 'prestation', { label: string; aide: string }> = {
  lot: {
    label: 'Prix d’une unité (€)',
    aide: 'Ce qu’une unité vaut. Ce qui ne revient pas d’une manifestation est chiffré à ce prix.',
  },
  prestation: {
    label: 'Coût d’une unité déployée (€)',
    aide: 'La vacation d’un agent, le forfait d’une intervention. Multiplié par le nombre demandé.',
  },
  unique: {
    label: 'Valeur de remplacement (€)',
    aide: 'Retenue si le matériel revient perdu d’une manifestation.',
  },
}

export default function CoutUnitaire({
  valeur,
  nature,
  onChange,
}: {
  valeur: number
  nature: 'unique' | 'lot' | 'prestation'
  onChange: (valeur: number) => void
}) {
  const { label, aide } = AIDE[nature]

  return (
    <div>
      <Input
        label={label}
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        value={String(valeur ?? 0)}
        onChange={(e) => onChange(Math.max(0, parseFloat(e.target.value) || 0))}
        placeholder="0"
      />
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {aide} Laissez à zéro pour ne pas le compter.
      </p>
    </div>
  )
}
