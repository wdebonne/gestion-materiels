import { useCallback, useState } from 'react'
import { z } from 'zod'

/**
 * Validation des saisies de terrain.
 *
 * Jusqu'ici la validation se réduisait à griser le bouton d'envoi : l'agent
 * voyait « Ajouter » inactif sans savoir quel champ manquait. La prop `error`
 * d'`Input` existait depuis le début et n'était utilisée nulle part.
 *
 * Les schémas sont écrits avec zod (déjà installé), ce qui permettra plus tard
 * de les partager avec la validation serveur.
 */

/** Champ de saisie décimale venant d'un `<input>` : chaîne, virgule tolérée. */
const nombreSaisi = (options: { min?: number; requis?: string }) =>
  z
    .string()
    .transform((v) => v.replace(',', '.').trim())
    .refine((v) => v.length > 0, { message: options.requis ?? 'Ce champ est obligatoire' })
    .refine((v) => !Number.isNaN(Number(v)), { message: 'Indiquez un nombre' })
    .refine((v) => options.min === undefined || Number(v) >= options.min, {
      message: `La valeur doit être supérieure à ${options.min}`,
    })

/** Nombre facultatif : vide accepté, mais s'il est saisi il doit être valide. */
const nombreFacultatif = (min = 0) =>
  z
    .string()
    .transform((v) => v.replace(',', '.').trim())
    .refine((v) => v === '' || !Number.isNaN(Number(v)), { message: 'Indiquez un nombre' })
    .refine((v) => v === '' || Number(v) >= min, {
      message: `La valeur doit être supérieure à ${min}`,
    })

const dateObligatoire = z.string().min(1, 'Indiquez une date')

export const schemaPlein = z.object({
  date: dateObligatoire,
  quantity: nombreSaisi({ min: 0.1, requis: 'Indiquez la quantité en litres' }),
  cost: nombreFacultatif(0),
  mileage: nombreFacultatif(0),
})

export const schemaEntretien = z.object({
  date: dateObligatoire,
  type: z.string().min(1, "Choisissez le type d'entretien"),
  cost: nombreFacultatif(0),
  mileage: nombreFacultatif(0),
})

export const schemaControle = z
  .object({
    date: dateObligatoire,
    expirationDate: dateObligatoire,
    cost: nombreFacultatif(0),
    mileage: nombreFacultatif(0),
  })
  .refine((v) => !v.date || !v.expirationDate || v.expirationDate >= v.date, {
    message: "L'expiration ne peut pas précéder la date du contrôle",
    path: ['expirationDate'],
  })

export type Erreurs<T> = Partial<Record<keyof T, string>>

/**
 * Valide un objet de formulaire et expose une erreur par champ.
 *
 * Volontairement indépendant de `react-hook-form` : les formulaires existants
 * reposent sur des objets `useState`, et les convertir imposerait de réécrire
 * quinze modales imbriquées dans un fichier de 2 800 lignes. On obtient ici le
 * même résultat visible — un message sous le champ fautif — sans ce risque.
 */
export function useValidation<T extends Record<string, unknown>>(
  schema: z.ZodType<unknown, z.ZodTypeDef, unknown>
) {
  const [erreurs, setErreurs] = useState<Erreurs<T>>({})

  const valider = useCallback(
    (valeurs: T): boolean => {
      const resultat = schema.safeParse(valeurs)
      if (resultat.success) {
        setErreurs({})
        return true
      }

      const trouvees: Erreurs<T> = {}
      for (const probleme of resultat.error.issues) {
        const champ = probleme.path[0] as keyof T | undefined
        // On garde la première erreur par champ : la plus utile à corriger.
        if (champ !== undefined && !trouvees[champ]) {
          trouvees[champ] = probleme.message
        }
      }
      setErreurs(trouvees)
      return false
    },
    [schema]
  )

  /** Efface l'erreur d'un champ dès que l'utilisateur le corrige. */
  const effacer = useCallback((champ: keyof T) => {
    setErreurs((precedentes) => {
      if (!precedentes[champ]) return precedentes
      const suivantes = { ...precedentes }
      delete suivantes[champ]
      return suivantes
    })
  }, [])

  const reinitialiser = useCallback(() => setErreurs({}), [])

  return { erreurs, valider, effacer, reinitialiser }
}
