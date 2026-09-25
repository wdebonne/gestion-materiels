import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Upload } from 'lucide-react'
import { Button, Input, Modal, ModalBody, ModalFooter, Select, TextArea } from '@/components/ui'
import type { NatureRubrique, ResultatControle } from '@/lib/api'
import ChampRubrique from './ChampRubrique'
import { FORMATS_ACCEPTES, RESULTATS } from './libelles'

export interface RubriqueDepot {
  id: number
  libelle: string
  nature?: NatureRubrique
}

export interface SuiviDepot {
  suiviId: number
  rubriqueId: number
  libelle: string | null
  pieceNom: string | null
}

/**
 * Déposer un document dans un bâtiment.
 *
 * Écrit pour servir deux publics : l'agent dans l'application, et l'entreprise
 * dans son portail. Le formulaire ne sait donc pas **où** il envoie — l'appelant
 * lui donne `envoyer` — ni ce que l'on peut choisir : il reçoit les bâtiments et
 * les objets ouverts, et masque chaque champ qui n'offre qu'un choix.
 *
 * `avance` ajoute ce qui n'appartient qu'au gestionnaire, dont le dépôt vaut
 * validation : la prochaine échéance, si le rapport la donne, et le suivi quand
 * le bâtiment en a plusieurs pour cet objet (deux ascenseurs).
 */
export default function FormulaireDepot({
  ouvert,
  onFermer,
  envoyer,
  rubriques,
  batiments = [],
  pieces = [],
  suivis = [],
  initial = {},
  avance = false,
  rubriqueObligatoire = false,
  titreFenetre = 'Déposer un document',
}: {
  ouvert: boolean
  onFermer: () => void
  envoyer: (donnees: FormData) => Promise<unknown>
  rubriques: RubriqueDepot[]
  /** Plusieurs : on choisit. Un seul ou aucun : le bâtiment est connu de l'appelant. */
  batiments?: { id: number; nom: string }[]
  pieces?: { id: number; nom: string }[]
  suivis?: SuiviDepot[]
  initial?: { rubriqueId?: number | null; suiviId?: number | null; siteId?: number | null }
  avance?: boolean
  rubriqueObligatoire?: boolean
  titreFenetre?: string
}) {
  const [fichier, setFichier] = useState<File | null>(null)
  const [titre, setTitre] = useState('')
  const [siteId, setSiteId] = useState<number | null>(initial.siteId ?? null)
  const [rubriqueId, setRubriqueId] = useState<number | null>(initial.rubriqueId ?? null)
  const [suiviId, setSuiviId] = useState<number | null>(initial.suiviId ?? null)
  const [pieceId, setPieceId] = useState<number | null>(null)
  const [dateDocument, setDateDocument] = useState('')
  const [prochaineEcheance, setProchaineEcheance] = useState('')
  const [resultat, setResultat] = useState<ResultatControle | ''>('')
  const [commentaire, setCommentaire] = useState('')
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const [erreurs, setErreurs] = useState<Record<string, string>>({})

  // Chaque ouverture repart des valeurs données par l'appelant.
  useEffect(() => {
    if (!ouvert) return
    setFichier(null)
    setTitre('')
    setSiteId(initial.siteId ?? null)
    setRubriqueId(initial.rubriqueId ?? null)
    setSuiviId(initial.suiviId ?? null)
    setPieceId(null)
    setDateDocument('')
    setProchaineEcheance('')
    setResultat('')
    setCommentaire('')
    setErreurs({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert])

  const rubrique = rubriques.find((r) => r.id === rubriqueId)
  const estControle = rubrique?.nature === 'controle'
  const suivisDeLaRubrique = useMemo(
    () => suivis.filter((s) => s.rubriqueId === rubriqueId),
    [suivis, rubriqueId]
  )

  const choisirRubrique = useCallback((id: number | null) => {
    setRubriqueId(id)
    setSuiviId(null)
  }, [])
  const choisirSite = useCallback((id: number | null) => setSiteId(id), [])

  const choisirFichier = (f: File | null) => {
    setFichier(f)
    // Le nom du fichier sert de titre tant qu'on n'en a pas écrit un.
    if (f && !titre.trim()) setTitre(f.name.replace(/\.[^.]+$/, ''))
  }

  const valider = (): boolean => {
    const manque: Record<string, string> = {}
    if (!fichier) manque.fichier = 'Choisissez un fichier'
    if (!titre.trim()) manque.titre = 'Le titre est obligatoire'
    if (batiments.length > 1 && !siteId) manque.siteId = 'Choisissez le bâtiment'
    if (rubriqueObligatoire && rubriques.length > 1 && !rubriqueId) manque.rubriqueId = "Choisissez l'objet"
    if (avance && suivisDeLaRubrique.length > 1 && !suiviId) manque.suiviId = 'Précisez lequel'
    setErreurs(manque)
    return Object.keys(manque).length === 0
  }

  const soumettre = async () => {
    if (!valider() || !fichier) return
    const donnees = new FormData()
    donnees.append('fichier', fichier)
    donnees.append('titre', titre.trim())
    if (siteId) donnees.append('siteId', String(siteId))
    if (rubriqueId) donnees.append('rubriqueId', String(rubriqueId))
    if (suiviId) donnees.append('suiviId', String(suiviId))
    if (pieceId) donnees.append('pieceId', String(pieceId))
    if (dateDocument) donnees.append('dateDocument', dateDocument)
    if (avance && prochaineEcheance) donnees.append('prochaineEcheance', prochaineEcheance)
    if (resultat) donnees.append('resultat', resultat)
    if (commentaire.trim()) donnees.append('commentaire', commentaire.trim())

    setEnvoiEnCours(true)
    try {
      await envoyer(donnees)
      onFermer()
    } catch (erreur: any) {
      toast.error(erreur?.response?.data?.message ?? "Le dépôt n'a pas abouti")
    } finally {
      setEnvoiEnCours(false)
    }
  }

  return (
    <Modal isOpen={ouvert} onClose={onFermer} title={titreFenetre} size="lg">
      <ModalBody className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5 dark:text-gray-300">Fichier</label>
          <input
            type="file"
            accept={FORMATS_ACCEPTES}
            onChange={(e) => choisirFichier(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-700 dark:text-gray-200 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-primary-700 hover:file:bg-primary-100"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            PDF, image JPEG ou PNG, Word, Excel ou OpenDocument — 25 Mo au plus.
          </p>
          {erreurs.fichier && <p className="mt-1 text-sm text-red-600">{erreurs.fichier}</p>}
        </div>

        <Input label="Titre" value={titre} onChange={(e) => setTitre(e.target.value)} error={erreurs.titre} />

        <ChampRubrique
          libelle="Bâtiment"
          options={batiments.map((b) => ({ id: b.id, libelle: b.nom }))}
          valeur={siteId}
          onChange={choisirSite}
          erreur={erreurs.siteId}
        />

        <ChampRubrique
          options={rubriques}
          valeur={rubriqueId}
          onChange={choisirRubrique}
          facultatif={!rubriqueObligatoire}
          erreur={erreurs.rubriqueId}
        />

        {avance && suivisDeLaRubrique.length > 1 && (
          <Select
            label="Lequel ?"
            value={suiviId ?? ''}
            onChange={(e) => setSuiviId(e.target.value ? Number(e.target.value) : null)}
            placeholder="Choisir…"
            options={suivisDeLaRubrique.map((s) => ({
              value: s.suiviId,
              label: s.libelle || s.pieceNom || `Suivi n° ${s.suiviId}`,
            }))}
            error={erreurs.suiviId}
          />
        )}

        {pieces.length > 0 && (
          <Select
            label="Pièce (facultatif)"
            value={pieceId ?? ''}
            onChange={(e) => setPieceId(e.target.value ? Number(e.target.value) : null)}
            options={[{ value: '', label: 'Tout le bâtiment' }, ...pieces.map((p) => ({ value: p.id, label: p.nom }))]}
          />
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            type="date"
            label={estControle ? 'Date du contrôle' : 'Date du document'}
            value={dateDocument}
            onChange={(e) => setDateDocument(e.target.value)}
          />
          {estControle && (
            <Select
              label="Résultat"
              value={resultat}
              onChange={(e) => setResultat(e.target.value as ResultatControle | '')}
              options={[
                { value: '', label: 'Non précisé' },
                ...Object.entries(RESULTATS).map(([value, label]) => ({ value, label })),
              ]}
            />
          )}
        </div>

        {avance && (
          <Input
            type="date"
            label="Prochaine échéance (facultatif)"
            hint="Laissée vide, elle se calcule d'après la date et la périodicité."
            value={prochaineEcheance}
            onChange={(e) => setProchaineEcheance(e.target.value)}
          />
        )}

        <TextArea
          label="Commentaire (facultatif)"
          rows={3}
          value={commentaire}
          onChange={(e) => setCommentaire(e.target.value)}
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onFermer} disabled={envoiEnCours}>
          Annuler
        </Button>
        <Button onClick={soumettre} loading={envoiEnCours} icon={<Upload className="w-4 h-4" />}>
          Déposer
        </Button>
      </ModalFooter>
    </Modal>
  )
}
