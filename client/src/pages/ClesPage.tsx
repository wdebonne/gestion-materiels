import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  KeyRound,
  Search,
  MapPin,
  Building2,
  User,
  Plus,
  Package,
  DoorOpen,
} from 'lucide-react'
import api from '@/lib/api'
import { Badge, Button, Card, Input, LoadingInline, Tabs, Tab } from '@/components/ui'
import Can from '@/components/Can'
import { BoutonEtiquettesAvery } from '@/components/EtiquettesAvery'
import ReferentielLieux from '@/components/ReferentielLieux'
import ComposerTrousseau from '@/components/ComposerTrousseau'

/**
 * Clés, badges et trousseaux.
 *
 * Trois onglets qui répondent à trois questions distinctes : quelles clés
 * possède-t-on, quels trousseaux circulent, et quels lieux existent. Les deux
 * premiers lisent le même endpoint — ce sont les mêmes `objects`, filtrés sur
 * leur nature — parce qu'une clé et un trousseau sont du matériel du parc et non
 * deux entités séparées.
 *
 * La création d'une clé n'est volontairement pas ici : elle passe par l'écran
 * de sa catégorie, comme tout le reste du parc. Dupliquer le formulaire de
 * matériel donnerait deux chemins pour créer la même chose, qui divergeraient à
 * la première évolution. Seul le trousseau a son propre bouton, parce qu'il naît
 * avec sa composition et son numéro d'inventaire.
 */

interface MaterielCle {
  id: number
  name: string
  reference: string | null
  material_type: string
  quantity_total: number
  category_name: string | null
  subcategory_name: string | null
  detenteur: any | null
}

function nomDetenteur(detenteur: any): string {
  if (!detenteur) return ''
  if (detenteur.holder_type === 'user') {
    return [detenteur.holder_first_name, detenteur.holder_last_name].filter(Boolean).join(' ')
  }
  if (detenteur.holder_type === 'service') return detenteur.holder_service_name || ''
  if (detenteur.holder_type === 'ouvrant') {
    return [detenteur.holder_site_name, detenteur.holder_ouvrant_name].filter(Boolean).join(' — ')
  }
  return detenteur.holder_label || ''
}

function IconeDetenteur({ type }: { type?: string }) {
  if (type === 'service') return <Building2 className="h-3.5 w-3.5" />
  if (type === 'ouvrant') return <MapPin className="h-3.5 w-3.5" />
  return <User className="h-3.5 w-3.5" />
}

function CarteMateriel({ materiel }: { materiel: MaterielCle }) {
  const estTrousseau = materiel.material_type !== 'lot'

  return (
    <Link to={`/cles/${materiel.id}`}>
      <Card className="h-full p-4 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-medium text-gray-900 dark:text-gray-100">
              {materiel.name}
            </div>
            <div className="mt-0.5 truncate text-sm text-gray-600 dark:text-gray-300">
              {materiel.subcategory_name || materiel.category_name || '—'}
            </div>
          </div>
          {materiel.reference && (
            <span className="flex-shrink-0 rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200">
              {materiel.reference}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {estTrousseau ? (
            materiel.detenteur ? (
              <Badge variant="warning" size="sm">
                <span className="flex items-center gap-1">
                  <IconeDetenteur type={materiel.detenteur.holder_type} />
                  {nomDetenteur(materiel.detenteur)}
                </span>
              </Badge>
            ) : (
              <Badge variant="success" size="sm">
                Disponible
              </Badge>
            )
          ) : (
            <Badge variant="info" size="sm">
              <span className="flex items-center gap-1">
                <Package className="h-3.5 w-3.5" />
                {materiel.quantity_total} exemplaire{materiel.quantity_total > 1 ? 's' : ''}
              </span>
            </Badge>
          )}
        </div>
      </Card>
    </Link>
  )
}

export default function ClesPage() {
  const [onglet, setOnglet] = useState<'cles' | 'trousseaux' | 'lieux'>('trousseaux')
  const [recherche, setRecherche] = useState('')
  const [composition, setComposition] = useState(false)

  const nature = onglet === 'cles' ? 'cle' : onglet === 'trousseaux' ? 'trousseau' : null

  const { data, isLoading } = useQuery<{ data: MaterielCle[]; meta?: { sansCategorie?: boolean } }>({
    queryKey: ['cles', nature, recherche],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (nature) params.set('nature', nature)
      if (recherche) params.set('search', recherche)
      const res = await api.get(`/cles?${params}`)
      return res.data
    },
    enabled: nature !== null,
  })

  const materiels = data?.data ?? []
  const sansCategorie = data?.meta?.sansCategorie

  // Les compteurs d'onglets ne valent que pour la liste chargée : les afficher
  // à partir d'une requête séparée doublerait les allers-retours pour un chiffre
  // que l'utilisateur lit du coin de l'œil.
  const total = useMemo(() => materiels.length, [materiels])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
            <KeyRound className="h-6 w-6 text-primary-600" />
            Clés et badges
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Trousseaux, clés, badges : ce qu'ils ouvrent et chez qui ils sont.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onglet !== 'lieux' && materiels.length > 0 && (
            <BoutonEtiquettesAvery
              materiels={materiels.map((m) => ({
                id: m.id,
                name: m.name,
                reference: m.reference,
              }))}
              titre={onglet === 'cles' ? 'Clés et badges' : 'Trousseaux'}
            />
          )}
          {onglet === 'trousseaux' && (
            <Can manage>
              <Button onClick={() => setComposition(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Nouveau trousseau
              </Button>
            </Can>
          )}
        </div>
      </div>

      <Tabs value={onglet} onChange={(v) => setOnglet(v as typeof onglet)}>
        <Tab value="trousseaux" label="Trousseaux" icon={<KeyRound className="h-4 w-4" />} />
        <Tab value="cles" label="Clés et badges" icon={<Package className="h-4 w-4" />} />
        <Tab value="lieux" label="Lieux" icon={<DoorOpen className="h-4 w-4" />} />
      </Tabs>

      {onglet === 'lieux' ? (
        <ReferentielLieux />
      ) : (
        <div className="space-y-4">
          <Input
            placeholder="Rechercher un numéro d'inventaire, un nom, un modèle…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            icon={<Search className="h-4 w-4" />}
          />

          {isLoading ? (
            <LoadingInline />
          ) : sansCategorie ? (
            <Card className="p-6 text-center">
              <p className="text-gray-700 dark:text-gray-200">
                Aucune catégorie n'est encore rattachée au plugin Clés.
              </p>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Un administrateur doit désigner, dans Paramètres → Plugins, les catégories de
                matériel qui contiennent les clés, les badges et les trousseaux.
              </p>
            </Card>
          ) : materiels.length === 0 ? (
            <Card className="p-6 text-center text-gray-600 dark:text-gray-300">
              {recherche
                ? 'Aucun résultat pour cette recherche.'
                : onglet === 'trousseaux'
                  ? 'Aucun trousseau pour le moment.'
                  : 'Aucune clé ni badge pour le moment.'}
            </Card>
          ) : (
            <>
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {total} élément{total > 1 ? 's' : ''}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {materiels.map((materiel) => (
                  <CarteMateriel key={materiel.id} materiel={materiel} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {composition && <ComposerTrousseau onClose={() => setComposition(false)} />}
    </div>
  )
}
