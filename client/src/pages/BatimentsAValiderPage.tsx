import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, FileClock } from 'lucide-react'
import { batimentsApi, type DocumentBatiment } from '@/lib/api'
import { Alert, Card, CardBody, LoadingInline } from '@/components/ui'
import ApercuDocument from '@/components/batiments/ApercuDocument'
import ClassementDocument from '@/components/batiments/ClassementDocument'
import FormulaireFacture from '@/components/batiments/exploitation/FormulaireFacture'
import { jourFr } from '@/components/batiments/libelles'
import { cn } from '@/lib/utils'

/**
 * La file des documents déposés qui attendent d'être relus.
 *
 * On relit le document à côté du formulaire, pas l'un après l'autre : c'est en
 * voyant le rapport qu'on lit sa date, son résultat, ses réserves. Chaque
 * validation passe au suivant, pour qu'un lundi matin de rentrée se traite d'un
 * trait.
 *
 * Seuls les bâtiments que l'on **gère** y figurent — le serveur ne rend rien
 * d'autre — et l'on ne reclasse que vers eux.
 */
export default function BatimentsAValiderPage() {
  const [choisi, setChoisi] = useState<number | null>(null)
  const [facture, setFacture] = useState<{ documentId: number; siteId: number; date: string | null; entrepriseId: number | null } | null>(null)

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['batiments', 'a-valider'],
    queryFn: async () => (await batimentsApi.aValider()).data.documents,
  })
  const { data: liste } = useQuery({
    queryKey: ['batiments', 'liste'],
    queryFn: async () => (await batimentsApi.liste()).data,
  })
  const { data: rubriques = [] } = useQuery({
    queryKey: ['batiments', 'rubriques'],
    queryFn: async () => (await batimentsApi.rubriques()).data.rubriques,
  })

  const geres = useMemo(
    () => (liste?.batiments ?? []).filter((b) => b.gere).map((b) => ({ id: b.id, nom: b.nom })),
    [liste]
  )

  // Le document suivant, quand celui qu'on relisait vient de quitter la file.
  useEffect(() => {
    if (documents.length === 0) setChoisi(null)
    else if (!documents.some((d) => d.id === choisi)) setChoisi(documents[0].id)
  }, [documents, choisi])

  const document = documents.find((d) => d.id === choisi) ?? null

  return (
    <div className="space-y-6">
      <div>
        <Link to="/batiments" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
          <ArrowLeft className="w-4 h-4" /> Tous les bâtiments
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <FileClock className="w-7 h-7 text-primary-600" />
          Documents à valider
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Un document validé fait foi : sa date fixe l'échéance suivante du contrôle.
        </p>
      </div>

      {isLoading ? (
        <LoadingInline />
      ) : documents.length === 0 ? (
        <Alert type="success">
          <span className="text-sm inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Rien n'attend : tous les dépôts ont été relus.
          </span>
        </Alert>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-6">
          <Card>
            <ul className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[75vh] overflow-y-auto">
              {documents.map((d) => (
                <ElementFile key={d.id} document={d} actif={d.id === choisi} onChoisir={() => setChoisi(d.id)} />
              ))}
            </ul>
          </Card>

          {document && (
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
              <ApercuDocument
                cle={document.id}
                charger={() => batimentsApi.fichier(document.id)}
                nom={document.nomOrigine}
                mime={document.mime}
              />
              <Card>
                <CardBody>
                  <ClassementDocument
                    document={document}
                    mode="valider"
                    batiments={geres.length > 0 ? geres : [{ id: document.siteId, nom: document.siteNom }]}
                    rubriques={rubriques}
                    onTermine={() => undefined}
                    onFactureValidee={setFacture}
                  />
                </CardBody>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Une facture validée se saisit dans la foulée : sinon elle ne compte pas dans l'énergie. */}
      {facture && (
        <FormulaireFacture
          siteId={facture.siteId}
          initial={{ documentId: facture.documentId, dateFacture: facture.date, fournisseurId: facture.entrepriseId }}
          onFermer={() => setFacture(null)}
        />
      )}
    </div>
  )
}

function ElementFile({
  document: d,
  actif,
  onChoisir,
}: {
  document: DocumentBatiment
  actif: boolean
  onChoisir: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onChoisir}
        className={cn(
          'w-full text-left px-4 py-3 transition-colors',
          actif ? 'bg-primary-50 dark:bg-primary-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
        )}
      >
        <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{d.titre}</div>
        {/* Qui a déposé, en premier : c'est ce qu'on cherche en relisant la file. */}
        <div className="text-xs text-gray-700 dark:text-gray-300 truncate">
          {[d.entreprise?.nom ?? d.deposePar?.nom, d.siteNom].filter(Boolean).join(' · ')}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
          {[d.rubriqueLibelle ?? 'Non classé', d.creeLe && `le ${jourFr(d.creeLe)}`].filter(Boolean).join(' · ')}
        </div>
      </button>
    </li>
  )
}
