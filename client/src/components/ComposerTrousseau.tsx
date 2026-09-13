import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Search, KeyRound, Check, Wand2 } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import {
  Button,
  Input,
  LoadingInline,
  Modal,
  ModalBody,
  ModalFooter,
  Select,
} from '@/components/ui'

/**
 * Création d'un trousseau, avec sa composition.
 *
 * Le trousseau naît en une fois — matériel, numéro d'inventaire et clés — parce
 * qu'il n'a de sens qu'avec ce qu'il contient. Le créer vide puis le composer
 * laisserait, si la seconde étape échoue, un numéro d'inventaire attribué à un
 * trousseau qui n'ouvre rien : une étiquette imprimable qui ne désigne rien.
 *
 * Le numéro est proposé d'après le préfixe choisi et **reste modifiable**. Les
 * communes reprennent presque toujours une numérotation existante, gravée sur
 * des médaillons déjà en place ; imposer la nôtre obligerait à tout regraver.
 */

interface Props {
  onClose: () => void
}

interface MaterielCle {
  id: number
  name: string
  reference: string | null
  material_type: string
  quantity_total: number
}

interface Prefixe {
  code: string
  label: string
}

export default function ComposerTrousseau({ onClose }: Props) {
  const navigate = useNavigate()

  const [nom, setNom] = useState('')
  const [prefixe, setPrefixe] = useState('')
  const [reference, setReference] = useState('')
  const [categorie, setCategorie] = useState('')
  const [recherche, setRecherche] = useState('')
  const [choisies, setChoisies] = useState<Set<number>>(() => new Set())

  /** Préfixes et catégories rattachées, tels que configurés par l'administrateur. */
  const { data: config } = useQuery<{ prefixes: Prefixe[]; categories: any[] }>({
    queryKey: ['cles-config'],
    queryFn: async () => (await api.get('/cles/configuration')).data.data,
  })

  const { data: clesDisponibles = [], isLoading } = useQuery<MaterielCle[]>({
    queryKey: ['cles', 'cle', recherche],
    queryFn: async () => {
      const params = new URLSearchParams({ nature: 'cle' })
      if (recherche) params.set('search', recherche)
      return (await api.get(`/cles?${params}`)).data.data
    },
  })

  // Le numéro proposé suit le préfixe : en changer doit rafraîchir la
  // proposition, sauf si l'utilisateur a déjà saisi le sien.
  const [numeroTouche, setNumeroTouche] = useState(false)

  useEffect(() => {
    if (!prefixe || numeroTouche) return
    let annule = false

    api
      .get(`/cles/prochain-numero?prefixe=${encodeURIComponent(prefixe)}`)
      .then((res) => {
        if (!annule) setReference(res.data.data.numero ?? '')
      })
      .catch(() => {
        /* Une proposition indisponible n'empêche pas la saisie manuelle. */
      })

    return () => {
      annule = true
    }
  }, [prefixe, numeroTouche])

  const creer = useMutation({
    mutationFn: async () => {
      const categorieChoisie = config?.categories?.find(
        (c: any) => String(c.id) === categorie && c.genre === 'category'
      )

      return api.post('/cles/trousseaux', {
        name: nom,
        reference,
        categoryId: categorieChoisie ? Number(categorie) : null,
        subcategoryId: categorieChoisie ? null : Number(categorie) || null,
        composants: [...choisies].map((id) => ({ objectId: id, quantity: 1 })),
      })
    },
    onSuccess: (res) => {
      toast.success(`Trousseau ${reference} créé`)
      onClose()
      navigate(`/cles/${res.data.data.id}`)
    },
    onError: (erreur: any) => {
      toast.error(erreur?.response?.data?.message ?? 'Création impossible')
    },
  })

  const basculer = (id: number) => {
    setChoisies((precedentes) => {
      const suivantes = new Set(precedentes)
      if (suivantes.has(id)) suivantes.delete(id)
      else suivantes.add(id)
      return suivantes
    })
  }

  const optionsCategorie = useMemo(
    () =>
      (config?.categories ?? []).map((c: any) => ({
        value: String(c.id),
        label: c.chemin,
      })),
    [config]
  )

  const pret = nom.trim() !== '' && reference.trim() !== '' && categorie !== ''

  return (
    <Modal isOpen onClose={onClose} title="Nouveau trousseau" size="lg">
      <ModalBody>
        <div className="space-y-4">
          <Input
            label="Nom"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Trousseau astreinte, Trousseau gardien…"
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Préfixe"
              value={prefixe}
              onChange={(e) => {
                setPrefixe(e.target.value)
                setNumeroTouche(false)
              }}
              placeholder="Choisir un préfixe"
              options={(config?.prefixes ?? []).map((p) => ({
                value: p.code,
                label: `${p.code} — ${p.label}`,
              }))}
            />

            <Input
              label="Numéro d'inventaire"
              value={reference}
              onChange={(e) => {
                setReference(e.target.value.toUpperCase())
                setNumeroTouche(true)
              }}
              placeholder="TST001"
              hint={
                numeroTouche ? 'Numéro saisi manuellement' : 'Proposé, modifiable'
              }
              rightIcon={
                !numeroTouche && reference ? <Wand2 className="h-4 w-4 text-primary-500" /> : undefined
              }
            />
          </div>

          <Select
            label="Catégorie"
            value={categorie}
            onChange={(e) => setCategorie(e.target.value)}
            placeholder="Où ranger ce trousseau"
            options={optionsCategorie}
            hint="Les catégories rattachées au plugin Clés, dans Paramètres → Plugins."
          />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Composition
              </span>
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {choisies.size} clé{choisies.size > 1 ? 's' : ''} choisie
                {choisies.size > 1 ? 's' : ''}
              </span>
            </div>

            <Input
              placeholder="Rechercher une clé ou un badge…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              icon={<Search className="h-4 w-4" />}
            />

            <div className="mt-2 max-h-60 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2 dark:border-gray-700">
              {isLoading ? (
                <LoadingInline />
              ) : clesDisponibles.length === 0 ? (
                <p className="px-2 py-3 text-sm text-gray-600 dark:text-gray-300">
                  Aucune clé disponible. Créez-les d'abord depuis leur catégorie de matériel.
                </p>
              ) : (
                clesDisponibles.map((cle) => (
                  <button
                    key={cle.id}
                    type="button"
                    onClick={() => basculer(cle.id)}
                    className={`touch-target flex w-full items-center gap-3 rounded px-2 py-1.5 text-left transition-colors ${
                      choisies.has(cle.id)
                        ? 'bg-primary-50 dark:bg-primary-900/30'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                        choisies.has(cle.id)
                          ? 'border-primary-600 bg-primary-600 text-white'
                          : 'border-gray-300 dark:border-gray-600'
                      }`}
                    >
                      {choisies.has(cle.id) && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <KeyRound className="h-4 w-4 flex-shrink-0 text-gray-500" />
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-gray-100">
                      {cle.name}
                    </span>
                    {cle.reference && (
                      <span className="flex-shrink-0 font-mono text-xs text-gray-500">
                        {cle.reference}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>
          Annuler
        </Button>
        <Button onClick={() => creer.mutate()} disabled={!pret || creer.isPending}>
          Créer le trousseau
        </Button>
      </ModalFooter>
    </Modal>
  )
}
