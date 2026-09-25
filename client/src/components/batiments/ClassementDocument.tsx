import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Check, X } from 'lucide-react'
import { Alert, Button, Input, Select, TextArea } from '@/components/ui'
import {
  batimentsApi,
  type ClassementDocument as Classement,
  type DocumentBatiment,
  type ResultatControle,
  type RubriqueBatiment,
} from '@/lib/api'
import ChampRubrique from './ChampRubrique'
import { invaliderBatiments } from './cache'
import { ajouterMois, jourFr, RESULTATS } from './libelles'

/**
 * Relire un document et dire ce qu'il est : bâtiment, pièce, objet, date,
 * résultat, prochaine échéance.
 *
 * C'est le geste qui donne sa valeur au dépôt : un rapport validé fait foi pour
 * l'échéance du suivi, et c'est lui que les alertes lisent. Le formulaire
 * annonce donc l'échéance **avant** qu'on valide — « prochaine échéance
 * calculée : 10/03/2027 » — pour qu'une date mal saisie se voie tout de suite.
 *
 * `valider` pour la file d'attente (Valider / Refuser), `modifier` pour
 * reclasser un document déjà validé (Enregistrer).
 */
export default function ClassementDocument({
  document,
  mode,
  batiments,
  rubriques,
  onTermine,
}: {
  document: DocumentBatiment
  mode: 'valider' | 'modifier'
  /** Les bâtiments que le compte gère : on ne reclasse que vers eux. */
  batiments: { id: number; nom: string }[]
  rubriques: RubriqueBatiment[]
  onTermine: () => void
}) {
  const queryClient = useQueryClient()
  const [siteId, setSiteId] = useState(document.siteId)
  const [pieceId, setPieceId] = useState<number | null>(document.pieceId)
  const [rubriqueId, setRubriqueId] = useState<number | null>(document.rubriqueId)
  const [suiviId, setSuiviId] = useState<number | null>(document.suiviId)
  const [titre, setTitre] = useState(document.titre)
  const [dateDocument, setDateDocument] = useState(document.dateDocument ?? '')
  const [prochaineEcheance, setProchaineEcheance] = useState(document.prochaineEcheance ?? '')
  const [resultat, setResultat] = useState<ResultatControle | ''>(document.resultat ?? '')
  const [creerSuivi, setCreerSuivi] = useState(true)
  const [refusEnCours, setRefusEnCours] = useState(false)
  const [motif, setMotif] = useState('')

  // Un autre document : on repart de ce qu'il porte.
  useEffect(() => {
    setSiteId(document.siteId)
    setPieceId(document.pieceId)
    setRubriqueId(document.rubriqueId)
    setSuiviId(document.suiviId)
    setTitre(document.titre)
    setDateDocument(document.dateDocument ?? '')
    setProchaineEcheance(document.prochaineEcheance ?? '')
    setResultat(document.resultat ?? '')
    setCreerSuivi(true)
    setRefusEnCours(false)
    setMotif('')
  }, [document])

  const { data: fiche } = useQuery({
    queryKey: ['batiments', 'fiche', siteId],
    queryFn: async () => (await batimentsApi.lire(siteId)).data,
  })
  const { data: suivisDuSite = [] } = useQuery({
    queryKey: ['batiments', 'suivis', siteId],
    queryFn: async () => (await batimentsApi.suivis(siteId)).data.suivis,
  })

  const rubrique = rubriques.find((r) => r.id === rubriqueId)
  const suivisDeLaRubrique = useMemo(
    () => suivisDuSite.filter((s) => s.rubriqueId === rubriqueId),
    [suivisDuSite, rubriqueId]
  )
  const suivi = suivisDeLaRubrique.find((s) => s.suiviId === suiviId) ?? (suivisDeLaRubrique.length === 1 ? suivisDeLaRubrique[0] : undefined)
  const periodicite = suivi?.periodiciteMois ?? rubrique?.periodiciteMois ?? null
  const echeanceCalculee = dateDocument && periodicite ? ajouterMois(dateDocument, periodicite) : null
  const suiviACreer = mode === 'valider' && rubrique?.periodiciteMois && suivisDeLaRubrique.length === 0

  const changerSite = (id: number) => {
    setSiteId(id)
    setPieceId(null)
    setSuiviId(null)
  }

  const classement = (): Classement => ({
    siteId,
    pieceId,
    rubriqueId,
    suiviId: suivisDeLaRubrique.length > 1 ? suiviId : null,
    titre: titre.trim(),
    dateDocument: dateDocument || null,
    // Vide : le serveur calcule d'après la date et la périodicité.
    prochaineEcheance: prochaineEcheance || null,
    resultat: resultat || null,
    creerSuivi,
  })

  const enregistrer = useMutation({
    mutationFn: async () =>
      mode === 'valider'
        ? (await batimentsApi.valider(document.id, classement())).data
        : (await batimentsApi.modifierDocument(document.id, classement())).data,
    onSuccess: (resultat) => {
      toast.success(
        mode === 'valider'
          ? resultat.suiviCree
            ? 'Document validé — le contrôle est désormais suivi dans ce bâtiment'
            : 'Document validé'
          : 'Classement enregistré'
      )
      invaliderBatiments(queryClient)
      onTermine()
    },
    onError: (erreur: any) => toast.error(erreur?.response?.data?.message ?? "L'enregistrement n'a pas abouti"),
  })

  const refuser = useMutation({
    mutationFn: async () => batimentsApi.refuser(document.id, motif.trim()),
    onSuccess: () => {
      toast.success('Document refusé — le déposant en est averti')
      invaliderBatiments(queryClient)
      onTermine()
    },
    onError: (erreur: any) => toast.error(erreur?.response?.data?.message ?? "Le refus n'a pas abouti"),
  })

  const plusieursSuivis = suivisDeLaRubrique.length > 1

  return (
    <div className="space-y-4">
      {document.commentaireDepot && (
        <Alert type="info">
          <span className="text-sm whitespace-pre-wrap">
            <strong>{document.entreprise?.nom ?? document.deposePar?.nom ?? 'Le déposant'} :</strong>{' '}
            {document.commentaireDepot}
          </span>
        </Alert>
      )}

      <Input label="Titre" value={titre} onChange={(e) => setTitre(e.target.value)} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {batiments.length > 1 ? (
          <Select
            label="Bâtiment"
            value={siteId}
            onChange={(e) => changerSite(Number(e.target.value))}
            options={batiments.map((b) => ({ value: b.id, label: b.nom }))}
          />
        ) : (
          <Input label="Bâtiment" value={document.siteNom} disabled />
        )}
        <Select
          label="Pièce"
          value={pieceId ?? ''}
          onChange={(e) => setPieceId(e.target.value ? Number(e.target.value) : null)}
          options={[
            { value: '', label: 'Tout le bâtiment' },
            ...(fiche?.pieces ?? []).map((p) => ({ value: p.id, label: p.nom })),
          ]}
        />
      </div>

      <ChampRubrique
        options={rubriques.filter((r) => r.actif || r.id === document.rubriqueId)}
        valeur={rubriqueId}
        onChange={(id) => {
          setRubriqueId(id)
          setSuiviId(null)
        }}
        facultatif
      />

      {plusieursSuivis && (
        <Select
          label="Lequel ?"
          value={suiviId ?? ''}
          onChange={(e) => setSuiviId(e.target.value ? Number(e.target.value) : null)}
          placeholder="Ce bâtiment en suit plusieurs : précisez"
          options={suivisDeLaRubrique.map((s) => ({
            value: s.suiviId,
            label: s.libelle || s.pieceNom || `Suivi n° ${s.suiviId}`,
          }))}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Input
          type="date"
          label={rubrique?.nature === 'controle' ? 'Date du contrôle' : 'Date du document'}
          value={dateDocument}
          onChange={(e) => setDateDocument(e.target.value)}
        />
        <Select
          label="Résultat"
          value={resultat}
          onChange={(e) => setResultat(e.target.value as ResultatControle | '')}
          options={[
            { value: '', label: 'Non précisé' },
            ...Object.entries(RESULTATS).map(([value, label]) => ({ value, label })),
          ]}
        />
        <Input
          type="date"
          label="Prochaine échéance"
          value={prochaineEcheance}
          onChange={(e) => setProchaineEcheance(e.target.value)}
          hint={
            prochaineEcheance
              ? undefined
              : echeanceCalculee
                ? `Calculée : ${jourFr(echeanceCalculee)}`
                : periodicite
                  ? 'Indiquez la date du document pour la calculer'
                  : 'Sans échéance pour cet objet'
          }
        />
      </div>

      {suiviACreer && (
        <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={creerSuivi}
            onChange={(e) => setCreerSuivi(e.target.checked)}
          />
          <span>
            Suivre désormais « {rubrique?.libelle} » dans ce bâtiment : l'échéance suivante lèvera une alerte.
          </span>
        </label>
      )}

      {refusEnCours ? (
        <div className="space-y-3 rounded-lg border border-red-200 dark:border-red-900 p-3">
          <TextArea
            label="Motif du refus — il sera envoyé au déposant"
            rows={3}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRefusEnCours(false)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              onClick={() => refuser.mutate()}
              loading={refuser.isPending}
              disabled={!motif.trim()}
            >
              Refuser le document
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          {mode === 'valider' && (
            <Button variant="danger" icon={<X className="w-4 h-4" />} onClick={() => setRefusEnCours(true)}>
              Refuser…
            </Button>
          )}
          <Button
            icon={<Check className="w-4 h-4" />}
            onClick={() => enregistrer.mutate()}
            loading={enregistrer.isPending}
            disabled={!titre.trim() || (plusieursSuivis && !suiviId)}
          >
            {mode === 'valider' ? 'Valider' : 'Enregistrer'}
          </Button>
        </div>
      )}
    </div>
  )
}
