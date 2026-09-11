import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FileText, Loader2, Map as MapIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { Modal, ModalBody, ModalFooter, Button, Spinner } from '@/components/ui'
import { mobilierUrbainApi, type FiltresMobilier, type MobilierUrbain } from '@/lib/api'
import {
  etat,
  familleExemplaire,
  jour,
  nomComplet,
  statut,
  typeIntervention,
} from '@/lib/mobilierUrbain'

/**
 * Sortir un document d'entretien de la voie publique.
 *
 * Un PDF de mobilier urbain n'a pas une forme, il en a dix, et c'est la
 * question qu'on se pose qui décide laquelle :
 *
 * - « La tournée de jeudi rue de la Gare » → **regroupé par rue**, une page par
 *   rue, avec l'état et la dernière intervention.
 * - « L'inventaire des candélabres pour le marché d'entretien » → **regroupé
 *   par matériel**, avec les numéros et les adresses.
 * - « Ce qui est cassé dans le quartier nord » → **regroupé par zone**, filtré
 *   sur l'état.
 *
 * D'où un document **paramétrable** plutôt qu'un gabarit unique. Trois réglages
 * font tout le travail : ce qu'on emporte (la portée), comment on l'ordonne
 * (le regroupement), et ce qu'on montre de chaque ligne (les colonnes).
 *
 * Le document est fabriqué dans le navigateur, et non sur le serveur, pour une
 * raison précise : il doit pouvoir contenir **la carte telle qu'elle est
 * affichée**, fond compris. Le serveur devrait la réassembler tuile par tuile
 * et ne retomberait jamais exactement sur le même cadrage.
 */

interface Props {
  /** Les filtres en cours : la portée « ce qui est affiché » les reprend. */
  filtres: FiltresMobilier
  /** Le conteneur de la carte, pour la photographier telle quelle. */
  carteRef?: React.RefObject<HTMLDivElement>
  onFermer: () => void
}

type Regroupement = 'aucun' | 'object' | 'category' | 'street' | 'sector' | 'status' | 'condition'

const REGROUPEMENTS: Array<{ valeur: Regroupement; libelle: string; aide: string }> = [
  { valeur: 'aucun', libelle: 'Aucun', aide: 'Une seule liste, par matériel puis par numéro' },
  { valeur: 'object', libelle: 'Par matériel', aide: 'Tous les candélabres, puis tous les bancs' },
  { valeur: 'category', libelle: 'Par catégorie', aide: 'Le classement du parc' },
  { valeur: 'street', libelle: 'Par rue', aide: 'La tournée, rue après rue' },
  { valeur: 'sector', libelle: 'Par zone / secteur', aide: 'Le découpage en quartiers' },
  { valeur: 'status', libelle: 'Par statut', aide: 'En service, hors service, déposé' },
  { valeur: 'condition', libelle: 'Par état', aide: 'Ce qui est à reprendre en premier' },
]

/** Une colonne du tableau : sa largeur relative et ce qu'elle lit d'une ligne. */
interface Colonne {
  clef: string
  titre: string
  poids: number
  lire: (item: MobilierUrbain) => string
  /** Alignée à droite : les nombres et les dates se lisent par leur fin. */
  droite?: boolean
}

const COLONNES: Colonne[] = [
  { clef: 'numero', titre: 'N°', poids: 0.5, lire: (i) => String(i.numero ?? ''), droite: true },
  { clef: 'label', titre: 'Désignation', poids: 2.2, lire: (i) => nomComplet(i) },
  { clef: 'object', titre: 'Matériel', poids: 1.8, lire: (i) => i.object_name ?? '' },
  { clef: 'category', titre: 'Catégorie', poids: 1.4, lire: (i) => i.category_name ?? '' },
  { clef: 'code', titre: 'Inventaire', poids: 1, lire: (i) => i.code ?? '' },
  { clef: 'street', titre: 'Rue', poids: 2, lire: (i) => i.street ?? '' },
  { clef: 'address', titre: 'Adresse', poids: 2.6, lire: (i) => i.address ?? '' },
  { clef: 'sector', titre: 'Zone', poids: 1.2, lire: (i) => i.sector ?? '' },
  { clef: 'status', titre: 'Statut', poids: 1.1, lire: (i) => statut(i.status).libelle },
  { clef: 'condition', titre: 'État', poids: 0.9, lire: (i) => etat(i.condition_state).libelle },
  { clef: 'installed_on', titre: 'Posé le', poids: 1, lire: (i) => jour(i.installed_on), droite: true },
  {
    clef: 'last',
    titre: 'Dernier entretien',
    poids: 1.2,
    lire: (i) => jour(i.last_intervention_date),
    droite: true,
  },
  {
    clef: 'next',
    titre: 'À revoir le',
    poids: 1.1,
    lire: (i) => jour(i.next_intervention_date),
    droite: true,
  },
  {
    clef: 'position',
    titre: 'Coordonnées',
    poids: 1.6,
    lire: (i) => `${Number(i.latitude).toFixed(5)}, ${Number(i.longitude).toFixed(5)}`,
  },
  { clef: 'notes', titre: 'Notes', poids: 2.4, lire: (i) => i.notes ?? '' },
]

/** Ce qu'un document d'entretien montre quand on ne lui a rien dit. */
const COLONNES_PAR_DEFAUT = ['numero', 'label', 'street', 'status', 'condition', 'last', 'next']

export default function ExportMobilierPDF({ filtres, carteRef, onFermer }: Props) {
  const [titre, setTitre] = useState('Mobilier de voie publique')
  const [sousTitre, setSousTitre] = useState('')
  const [toutLeParc, setToutLeParc] = useState(false)
  const [regroupement, setRegroupement] = useState<Regroupement>('street')
  const [colonnes, setColonnes] = useState<string[]>(COLONNES_PAR_DEFAUT)
  const [avecCarte, setAvecCarte] = useState(true)
  const [avecSynthese, setAvecSynthese] = useState(true)
  const [avecInterventions, setAvecInterventions] = useState(false)
  const [paysage, setPaysage] = useState(true)
  const [enCours, setEnCours] = useState(false)

  /**
   * Les lignes du document.
   *
   * Rechargées depuis le serveur plutôt que reprises de la carte : celle-ci
   * plafonne à ce qu'elle sait afficher, et un inventaire tronqué sans le dire
   * est pire qu'un inventaire absent.
   */
  const { data: lignes = [], isLoading } = useQuery({
    queryKey: ['mobilier-export', filtres, toutLeParc, avecInterventions],
    queryFn: async () =>
      (
        await mobilierUrbainApi.exporter({
          ...(toutLeParc ? {} : filtres),
          avec_interventions: avecInterventions ? '1' : '',
          limit: '5000',
        })
      ).data.data,
  })

  const groupes = useMemo(() => regrouper(lignes, regroupement), [lignes, regroupement])
  const colonnesRetenues = COLONNES.filter((c) => colonnes.includes(c.clef))

  const basculerColonne = (clef: string) =>
    setColonnes((actuelles) =>
      actuelles.includes(clef) ? actuelles.filter((c) => c !== clef) : [...actuelles, clef]
    )

  const generer = async () => {
    if (lignes.length === 0) {
      toast.error('Rien à exporter avec ces réglages')
      return
    }
    if (colonnesRetenues.length === 0) {
      toast.error('Choisissez au moins une colonne')
      return
    }

    setEnCours(true)
    try {
      const pdf = new jsPDF(paysage ? 'l' : 'p', 'mm', 'a4')
      const largeurPage = pdf.internal.pageSize.getWidth()
      const hauteurPage = pdf.internal.pageSize.getHeight()
      const marge = 10
      const largeurUtile = largeurPage - 2 * marge

      // ---- En-tête ----
      pdf.setFillColor(37, 99, 235)
      pdf.rect(0, 0, largeurPage, 26, 'F')
      pdf.setTextColor(255, 255, 255)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(17)
      pdf.text(titre || 'Mobilier de voie publique', marge, 11)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      const resume = [
        `${lignes.length} mobilier${lignes.length > 1 ? 's' : ''}`,
        toutLeParc ? 'Inventaire complet' : 'Sélection filtrée',
        REGROUPEMENTS.find((r) => r.valeur === regroupement)?.libelle,
      ]
        .filter(Boolean)
        .join(' · ')
      pdf.text(resume, marge, 17.5)
      pdf.text(
        `Édité le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`,
        marge,
        22.5
      )
      if (sousTitre) {
        pdf.text(sousTitre, largeurPage - marge, 17.5, { align: 'right' })
      }

      let y = 32
      pdf.setTextColor(30, 41, 59)

      // ---- La carte, telle qu'elle est affichée ----
      if (avecCarte && carteRef?.current) {
        try {
          const canvas = await html2canvas(carteRef.current, {
            useCORS: true,
            allowTaint: true,
            scale: 2,
            backgroundColor: '#ffffff',
            // Les boutons de zoom et de fond n'ont aucun sens sur du papier :
            // capturés tels quels, ils se retrouvent imprimés sur la vue.
            ignoreElements: (element) =>
              element.classList?.contains('leaflet-control-container') ?? false,
          })

          /*
            JPEG et non PNG.

            Une photo aérienne est une photographie : le PNG la conserve sans
            perte et pèse plusieurs mégaoctets pour trois bancs — un document
            qu'on ne peut plus envoyer par courriel. À 0,85, la différence ne se
            voit pas à l'impression et le fichier est divisé par dix.
          */
          const image = canvas.toDataURL('image/jpeg', 0.85)

          // La carte prend toute la largeur utile, et ne se rétrécit que si sa
          // hauteur mangerait la page. Garder le rapport des deux côtés : une
          // vue aérienne étirée ne désigne plus le bon endroit.
          const rapport = canvas.height / canvas.width
          let largeurImage = largeurUtile
          let hauteurImage = largeurUtile * rapport
          const hauteurMax = hauteurPage * 0.5
          if (hauteurImage > hauteurMax) {
            hauteurImage = hauteurMax
            largeurImage = hauteurMax / rapport
          }

          pdf.addImage(
            image,
            'JPEG',
            marge + (largeurUtile - largeurImage) / 2,
            y,
            largeurImage,
            hauteurImage
          )
          y += hauteurImage + 5
        } catch {
          // Une carte non capturée ne doit pas faire échouer l'inventaire : le
          // tableau est ce qui part sur le terrain, l'image est un confort.
          pdf.setFontSize(9)
          pdf.setTextColor(150, 150, 150)
          pdf.text('(La carte n’a pas pu être capturée)', marge, y + 5)
          pdf.setTextColor(30, 41, 59)
          y += 12
        }
      }

      // ---- Synthèse ----
      if (avecSynthese && groupes.length > 0) {
        y = sautSiNecessaire(pdf, y, 8 + groupes.length * 5, hauteurPage, marge)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(11)
        pdf.text('Synthèse', marge, y)
        y += 5
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(9)
        for (const groupe of groupes) {
          const aRevoir = groupe.lignes.filter(
            (l) => l.condition_state === 'mauvais' || l.status === 'hors_service'
          ).length
          pdf.text(
            `${groupe.titre} : ${groupe.lignes.length} mobilier${groupe.lignes.length > 1 ? 's' : ''}` +
              (aRevoir > 0 ? `  —  ${aRevoir} à reprendre` : ''),
            marge + 2,
            y
          )
          y += 4.5
          y = sautSiNecessaire(pdf, y, 6, hauteurPage, marge)
        }
        y += 3
      }

      // ---- Tableaux ----
      const largeurs = repartir(colonnesRetenues, largeurUtile)

      for (const groupe of groupes) {
        y = sautSiNecessaire(pdf, y, 20, hauteurPage, marge)

        if (regroupement !== 'aucun') {
          pdf.setFont('helvetica', 'bold')
          pdf.setFontSize(11)
          pdf.setTextColor(37, 99, 235)
          pdf.text(`${groupe.titre}  (${groupe.lignes.length})`, marge, y)
          pdf.setTextColor(30, 41, 59)
          y += 5
        }

        y = enTeteTableau(pdf, colonnesRetenues, largeurs, marge, y)

        for (const ligne of groupe.lignes) {
          const cellules = colonnesRetenues.map((colonne, index) =>
            pdf.splitTextToSize(colonne.lire(ligne) || '', largeurs[index] - 2)
          )
          const hauteurLigne = Math.max(...cellules.map((c) => c.length)) * 3.6 + 2

          if (y + hauteurLigne > hauteurPage - marge) {
            pdf.addPage()
            y = marge
            y = enTeteTableau(pdf, colonnesRetenues, largeurs, marge, y)
          }

          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(8)
          let x = marge
          cellules.forEach((texte, index) => {
            const colonne = colonnesRetenues[index]
            pdf.text(texte, colonne.droite ? x + largeurs[index] - 1 : x + 1, y + 3.5, {
              align: colonne.droite ? 'right' : 'left',
            })
            x += largeurs[index]
          })

          // Un filet fin plutôt que des bordures pleines : sur un tableau de
          // cent lignes, la grille complète se lit moins bien que le texte.
          pdf.setDrawColor(226, 232, 240)
          pdf.line(marge, y + hauteurLigne - 0.8, largeurPage - marge, y + hauteurLigne - 0.8)
          y += hauteurLigne

          // ---- Historique, sous la ligne qu'il concerne ----
          if (avecInterventions && (ligne.interventions?.length ?? 0) > 0) {
            pdf.setFontSize(7.5)
            pdf.setTextColor(100, 116, 139)
            for (const intervention of ligne.interventions!.slice(0, 6)) {
              const texte =
                `• ${jour(intervention.performed_on)} — ${typeIntervention(intervention.intervention_type).libelle}` +
                (intervention.description ? ` : ${intervention.description}` : '') +
                (intervention.performed_by ? ` (${intervention.performed_by})` : '')
              const lignesTexte = pdf.splitTextToSize(texte, largeurUtile - 8)
              const hauteur = lignesTexte.length * 3.2 + 1
              if (y + hauteur > hauteurPage - marge) {
                pdf.addPage()
                y = marge
              }
              pdf.text(lignesTexte, marge + 6, y + 2.5)
              y += hauteur
            }
            pdf.setTextColor(30, 41, 59)
            y += 1.5
          }
        }

        y += 4
      }

      // ---- Pied de page ----
      const pages = pdf.getNumberOfPages()
      for (let page = 1; page <= pages; page += 1) {
        pdf.setPage(page)
        pdf.setFontSize(8)
        pdf.setTextColor(148, 163, 184)
        pdf.text(`Page ${page} / ${pages}`, largeurPage - marge, hauteurPage - 5, { align: 'right' })
        pdf.text('Fonds cartographiques : IGN — Géoplateforme, OpenStreetMap', marge, hauteurPage - 5)
      }

      const nom = `mobilier-urbain-${new Date().toISOString().slice(0, 10)}.pdf`
      pdf.save(nom)
      toast.success('Document généré')
      onFermer()
    } catch (erreur: any) {
      toast.error(erreur?.message ?? 'La génération a échoué')
    } finally {
      setEnCours(false)
    }
  }

  return (
    <Modal isOpen onClose={onFermer} title="Exporter en PDF" size="lg">
      <ModalBody>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Ce qu'on emporte */}
            <Section titre="Ce que le document contient">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Choix
                  actif={!toutLeParc}
                  onClick={() => setToutLeParc(false)}
                  titre="Ce qui est affiché"
                  aide="La sélection filtrée à l’écran"
                />
                <Choix
                  actif={toutLeParc}
                  onClick={() => setToutLeParc(true)}
                  titre="Tout l’inventaire"
                  aide="Sans tenir compte des filtres"
                />
              </div>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                <FileText className="mr-1 inline h-4 w-4" />
                {lignes.length} mobilier{lignes.length > 1 ? 's' : ''} sera
                {lignes.length > 1 ? 'ont' : ''} listé{lignes.length > 1 ? 's' : ''}.
              </p>
            </Section>

            {/* Comment on l'ordonne */}
            <Section titre="Regroupement">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {REGROUPEMENTS.map((r) => (
                  <Choix
                    key={r.valeur}
                    actif={regroupement === r.valeur}
                    onClick={() => setRegroupement(r.valeur)}
                    titre={r.libelle}
                    aide={r.aide}
                  />
                ))}
              </div>
            </Section>

            {/* Ce qu'on montre de chaque ligne */}
            <Section titre="Colonnes">
              <div className="flex flex-wrap gap-2">
                {COLONNES.map((c) => (
                  <button
                    key={c.clef}
                    type="button"
                    onClick={() => basculerColonne(c.clef)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      colonnes.includes(c.clef)
                        ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700'
                    }`}
                  >
                    {c.titre}
                  </button>
                ))}
              </div>
              {colonnesRetenues.length > 8 && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  Au-delà de huit colonnes, le tableau devient étroit : le format paysage est
                  conseillé.
                </p>
              )}
            </Section>

            {/* Le reste */}
            <Section titre="Mise en forme">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Titre
                  </label>
                  <input
                    type="text"
                    value={titre}
                    onChange={(e) => setTitre(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Mention (service, commune…)
                  </label>
                  <input
                    type="text"
                    value={sousTitre}
                    onChange={(e) => setSousTitre(e.target.value)}
                    placeholder="Services techniques"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-4">
                <Case coche={paysage} onChange={setPaysage} libelle="Format paysage" />
                <Case
                  coche={avecCarte}
                  onChange={setAvecCarte}
                  libelle="Inclure la carte affichée"
                  icone={<MapIcon className="h-4 w-4" />}
                />
                <Case coche={avecSynthese} onChange={setAvecSynthese} libelle="Inclure la synthèse" />
                <Case
                  coche={avecInterventions}
                  onChange={setAvecInterventions}
                  libelle="Inclure l’historique des interventions"
                />
              </div>
            </Section>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={onFermer} disabled={enCours}>
          Annuler
        </Button>
        <Button onClick={generer} disabled={enCours || isLoading || lignes.length === 0}>
          {enCours ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              Génération…
            </>
          ) : (
            <>
              <Download className="mr-1.5 h-4 w-4" />
              Générer le PDF
            </>
          )}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// ------------------------------------------------------------------ découpage

interface Groupe {
  titre: string
  lignes: MobilierUrbain[]
}

/**
 * Découpe les lignes selon le regroupement demandé.
 *
 * Le tri des groupes n'est pas alphabétique dans tous les cas : « Par état »
 * doit remonter le mauvais en premier, sans quoi le document commence par ce
 * qui va bien et enterre ce qui compte en dernière page.
 */
function regrouper(lignes: MobilierUrbain[], regroupement: Regroupement): Groupe[] {
  if (regroupement === 'aucun') {
    return lignes.length > 0 ? [{ titre: 'Inventaire', lignes }] : []
  }

  const clefDe = (item: MobilierUrbain): string => {
    switch (regroupement) {
      case 'object':
        return item.object_name ?? 'Sans matériel'
      case 'category':
        return item.category_name ?? 'Sans catégorie'
      case 'street':
        return item.street || 'Rue non renseignée'
      case 'sector':
        return item.sector || 'Zone non renseignée'
      case 'status':
        return statut(item.status).libelle
      case 'condition':
        return etat(item.condition_state).libelle
      default:
        return ''
    }
  }

  const paquets = new Map<string, MobilierUrbain[]>()
  for (const ligne of lignes) {
    const clef = clefDe(ligne)
    if (!paquets.has(clef)) paquets.set(clef, [])
    paquets.get(clef)!.push(ligne)
  }

  const ordreEtat = ['Mauvais', 'Moyen', 'Bon état', 'Neuf']
  const ordreStatut = ['Hors service', 'En intervention', 'En service', 'Déposé']

  return [...paquets.entries()]
    .map(([titre, lignesDuGroupe]) => ({
      titre,
      lignes: lignesDuGroupe.sort(
        (a, b) =>
          String(a.object_name ?? '').localeCompare(String(b.object_name ?? ''), 'fr') ||
          Number(a.numero) - Number(b.numero)
      ),
    }))
    .sort((a, b) => {
      if (regroupement === 'condition') {
        return ordreEtat.indexOf(a.titre) - ordreEtat.indexOf(b.titre)
      }
      if (regroupement === 'status') {
        return ordreStatut.indexOf(a.titre) - ordreStatut.indexOf(b.titre)
      }
      return a.titre.localeCompare(b.titre, 'fr')
    })
}

/** Les largeurs en millimètres, au prorata des poids déclarés. */
function repartir(colonnes: Colonne[], largeurUtile: number): number[] {
  const total = colonnes.reduce((somme, c) => somme + c.poids, 0)
  return colonnes.map((c) => (c.poids / total) * largeurUtile)
}

/** Ajoute une page si le bloc annoncé ne tient plus, et rend la nouvelle ordonnée. */
function sautSiNecessaire(
  pdf: jsPDF,
  y: number,
  hauteurBloc: number,
  hauteurPage: number,
  marge: number
): number {
  if (y + hauteurBloc > hauteurPage - marge) {
    pdf.addPage()
    return marge
  }
  return y
}

/** La ligne de titres, répétée à chaque page — un tableau sans en-tête est illisible. */
function enTeteTableau(
  pdf: jsPDF,
  colonnes: Colonne[],
  largeurs: number[],
  marge: number,
  y: number
): number {
  const largeurTotale = largeurs.reduce((somme, l) => somme + l, 0)
  pdf.setFillColor(241, 245, 249)
  pdf.rect(marge, y, largeurTotale, 6, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.setTextColor(51, 65, 85)

  let x = marge
  colonnes.forEach((colonne, index) => {
    pdf.text(colonne.titre, colonne.droite ? x + largeurs[index] - 1 : x + 1, y + 4, {
      align: colonne.droite ? 'right' : 'left',
    })
    x += largeurs[index]
  })

  pdf.setTextColor(30, 41, 59)
  return y + 7
}

// ------------------------------------------------------------------ habillage

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{titre}</h4>
      {children}
    </div>
  )
}

function Choix({
  actif,
  onClick,
  titre,
  aide,
}: {
  actif: boolean
  onClick: () => void
  titre: string
  aide: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-2.5 text-left transition-colors ${
        actif
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
          : 'border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700'
      }`}
    >
      <span
        className={`block text-sm font-medium ${
          actif ? 'text-primary-700 dark:text-primary-300' : 'text-gray-900 dark:text-gray-100'
        }`}
      >
        {titre}
      </span>
      <span className="block text-xs text-gray-500 dark:text-gray-400">{aide}</span>
    </button>
  )
}

function Case({
  coche,
  onChange,
  libelle,
  icone,
}: {
  coche: boolean
  onChange: (valeur: boolean) => void
  libelle: string
  icone?: React.ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
      <input
        type="checkbox"
        checked={coche}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-primary-600"
      />
      {icone}
      {libelle}
    </label>
  )
}

/** Gardé pour que la famille d'un mobilier reste lisible si le tableau l'ajoute. */
export const familleLisible = (item: MobilierUrbain): string => familleExemplaire(item).libelle
