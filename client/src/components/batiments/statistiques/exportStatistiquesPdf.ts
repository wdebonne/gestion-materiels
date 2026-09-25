import type { CategorieStat, NatureIntervention, StatistiquesBatiments } from '@/lib/api'
import { bandeau, creer, paragraphe, poserCapture, section, tableau, telecharger } from '@/lib/pdf/document'
import { CATEGORIES_STAT, ENERGIES, NATURES_INTERVENTION, evolution } from '../libelles'

/**
 * Le rapport des coûts des bâtiments, en PDF, avec les sections qu'on choisit.
 *
 * Il sert en commission ou au conseil : on y lit ce qu'ont coûté les
 * bâtiments, où, et comment cela évolue. Les graphiques sont photographiés ;
 * les **chiffres sont écrits en texte**, nets à l'impression et cherchables.
 * Le bandeau dit toujours la période, les bâtiments et la comparaison : une
 * feuille passée de main en main n'a plus les filtres sous les yeux.
 */

export const SECTIONS_PDF = {
  synthese: 'Synthèse par catégorie',
  repartition: 'Répartition (camemberts)',
  evolution: 'Évolution par période',
  batiments: 'Comparaison des bâtiments',
  consommations: 'Consommations d’énergie',
  detail: 'Détail des dépenses',
} as const
export type SectionPdf = keyof typeof SECTIONS_PDF

export interface OptionsStatistiquesPdf {
  stats: StatistiquesBatiments
  sections: SectionPdf[]
  /** « Tous les bâtiments », ou leurs noms. */
  perimetre: string
  periode: string
  /** « comparé à 2025 », ou rien. */
  comparaison: string | null
  /** Le graphique des bâtiments est rapporté au m², comme à l'écran. */
  batimentsAuM2: boolean
  graphiques: Partial<Record<'repartition' | 'evolution' | 'batiments' | 'consommations', HTMLElement | null>>
}

/**
 * Les polices intégrées de jsPDF ne connaissent ni l'espace fine insécable que
 * `Intl` place entre les milliers, ni le signe moins typographique : ils
 * sortiraient en caractères parasites. On les ramène à l'espace et au tiret.
 */
function pdf(texte: string): string {
  return texte.replace(/[  ]/g, ' ').replace(/−/g, '-')
}

const FORMAT_EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
const FORMAT_NOMBRE = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const euros = (n: number | null | undefined) => (n === null || n === undefined ? '-' : pdf(FORMAT_EUROS.format(n)))
const nombre = (n: number) => pdf(FORMAT_NOMBRE.format(n))
const ecart = (actuel: number, precedent: number | null | undefined) => {
  if (precedent === null || precedent === undefined) return '-'
  const pct = evolution(actuel, precedent)
  return pct === null ? 'nouveau' : `${pct > 0 ? '+' : ''}${String(pct).replace('.', ',')} %`
}

/** Le nom d'une sous-catégorie : l'énergie, la nature d'intervention, le contrat. */
export function libelleSous(categorie: CategorieStat, sous: string): string {
  if (categorie === 'energie') return ENERGIES[sous as keyof typeof ENERGIES]?.libelle ?? sous
  if (categorie === 'interventions' || categorie === 'controles') return NATURES_INTERVENTION[sous as NatureIntervention] ?? sous
  if (categorie === 'achats') return 'Matériel posé dans les pièces'
  return sous
}

export async function exporterStatistiquesPdf(options: OptionsStatistiquesPdf) {
  const { stats } = options
  const doc = creer('p')
  const avecComparaison = stats.totaux.comparaison !== null
  const categories = stats.filtre.categories

  bandeau(
    doc,
    'Coûts des bâtiments',
    options.periode,
    `${options.perimetre}${options.comparaison ? ` — ${options.comparaison}` : ''}`
  )

  // --------------------------------------------------------------- synthèse
  if (options.sections.includes('synthese')) {
    section(doc, 'Synthèse')
    const surface = stats.parBatiment.reduce((s, b) => s + (b.surfaceM2 ?? 0), 0)
    const colonnes = [
      { titre: 'Catégorie', poids: 3 },
      { titre: 'Montant TTC', poids: 1.6, aDroite: true },
      ...(avecComparaison
        ? [
            { titre: 'Période comparée', poids: 1.6, aDroite: true },
            { titre: 'Évolution', poids: 1.2, aDroite: true },
          ]
        : []),
    ]
    tableau(doc, colonnes, [
      ...categories.map((c) => ({
        couleur: CATEGORIES_STAT[c].couleur,
        cellules: [
          CATEGORIES_STAT[c].libelle,
          euros(stats.totaux.parCategorie[c]),
          ...(avecComparaison
            ? [euros(stats.totaux.parCategorieComparaison?.[c]), ecart(stats.totaux.parCategorie[c], stats.totaux.parCategorieComparaison?.[c])]
            : []),
        ],
      })),
      {
        grasse: true,
        cellules: [
          'Total',
          euros(stats.totaux.montant),
          ...(avecComparaison ? [euros(stats.totaux.comparaison), ecart(stats.totaux.montant, stats.totaux.comparaison)] : []),
        ],
      },
    ])
    // Le ratio n'a de sens que rapporté aux seuls bâtiments dont on connaît la surface.
    const avecSurface = stats.parBatiment.filter((b) => b.surfaceM2)
    if (avecSurface.length > 0) {
      const montant = avecSurface.reduce((s, b) => s + b.total, 0)
      paragraphe(
        doc,
        `${euros(montant / surface)} par m² sur ${nombre(surface)} m² (${avecSurface.length} bâtiment${avecSurface.length > 1 ? 's' : ''} dont la surface est connue).`,
        true
      )
    }
    const incomplets = stats.parBatiment.flatMap((b) =>
      Object.entries(b.couverture)
        .filter(([, part]) => (part ?? 1) < 0.95)
        .map(([e, part]) => `${b.nom} (${ENERGIES[e as keyof typeof ENERGIES].libelle.toLowerCase()} : ${Math.round((part ?? 0) * 100)} %)`)
    )
    if (incomplets.length > 0) {
      paragraphe(doc, `Factures d'énergie incomplètes sur la période — jours couverts : ${incomplets.join(', ')}.`, true)
    }
    if (stats.achatsSansPrix > 0) {
      paragraphe(doc, `${stats.achatsSansPrix} matériel(s) posé(s) sans prix ou date d'achat ne sont pas chiffrés.`, true)
    }
  }

  // ------------------------------------------------------------ répartition
  if (options.sections.includes('repartition')) {
    section(doc, 'Répartition')
    await poserCapture(doc, options.graphiques.repartition ?? null)
  }

  // -------------------------------------------------------------- évolution
  if (options.sections.includes('evolution') && stats.series.length > 0) {
    section(doc, 'Évolution par période')
    await poserCapture(doc, options.graphiques.evolution ?? null)
    tableau(
      doc,
      [
        { titre: 'Période', poids: 2.2 },
        // Huit colonnes sur un portrait : « Interventions » n'y tient pas en entier.
        ...categories.map((c) => ({ titre: c === 'interventions' ? 'Interv.' : CATEGORIES_STAT[c].libelle, poids: 1.4, aDroite: true })),
        { titre: 'Total', poids: 1.5, aDroite: true },
        ...(avecComparaison ? [{ titre: 'Comparée', poids: 1.5, aDroite: true }] : []),
      ],
      stats.series.map((p, i) => ({
        cellules: [
          p.libelleLong,
          ...categories.map((c) => euros(p.parCategorie[c])),
          euros(p.total),
          ...(avecComparaison ? [euros(stats.seriesComparaison?.[i]?.total)] : []),
        ],
      }))
    )
  }

  // -------------------------------------------------------------- bâtiments
  if (options.sections.includes('batiments') && stats.parBatiment.length > 0) {
    section(doc, 'Par bâtiment')
    if (stats.parBatiment.length > 1) {
      if (options.batimentsAuM2) {
        paragraphe(doc, 'Graphique rapporté au m², pour les seuls bâtiments dont la surface est connue ; le tableau donne les montants.', true)
      }
      await poserCapture(doc, options.graphiques.batiments ?? null)
    }
    tableau(
      doc,
      [
        { titre: 'Bâtiment', poids: 3 },
        { titre: 'Surface', poids: 1.2, aDroite: true },
        { titre: 'Total TTC', poids: 1.6, aDroite: true },
        { titre: '€ / m²', poids: 1.2, aDroite: true },
        ...(avecComparaison ? [{ titre: 'Évolution', poids: 1.2, aDroite: true }] : []),
      ],
      [...stats.parBatiment]
        .sort((a, b) => b.total - a.total)
        .map((b) => ({
          cellules: [
            b.nom,
            b.surfaceM2 ? `${nombre(b.surfaceM2)} m²` : '-',
            euros(b.total),
            b.surfaceM2 ? euros(b.total / b.surfaceM2) : '-',
            ...(avecComparaison ? [ecart(b.total, b.comparaison)] : []),
          ],
        }))
    )
  }

  // ---------------------------------------------------------- consommations
  if (options.sections.includes('consommations') && stats.parEnergie.length > 0) {
    section(doc, 'Énergie')
    await poserCapture(doc, options.graphiques.consommations ?? null)
    tableau(
      doc,
      [
        { titre: 'Énergie', poids: 2.4 },
        { titre: 'Consommation', poids: 1.8, aDroite: true },
        { titre: 'Montant TTC', poids: 1.6, aDroite: true },
        ...(avecComparaison
          ? [
              { titre: 'Conso. comparée', poids: 1.8, aDroite: true },
              { titre: 'Évolution', poids: 1.2, aDroite: true },
            ]
          : []),
      ],
      stats.parEnergie.map((e) => {
        const unite = e.unite === 'm3' ? 'm3' : e.unite ?? ''
        return {
          couleur: ENERGIES[e.energie].couleur,
          cellules: [
            ENERGIES[e.energie].libelle,
            `${nombre(e.consommation)} ${unite}`.trim(),
            euros(e.montant),
            ...(avecComparaison
              ? [`${nombre(e.consommationComparaison ?? 0)} ${unite}`.trim(), ecart(e.consommation, e.consommationComparaison)]
              : []),
          ],
        }
      })
    )
  }

  // ----------------------------------------------------------------- détail
  if (options.sections.includes('detail') && stats.details.length > 0) {
    section(doc, 'Détail des dépenses')
    tableau(
      doc,
      [
        { titre: 'Catégorie', poids: 1.6 },
        { titre: 'Poste', poids: 3 },
        { titre: 'Montant TTC', poids: 1.6, aDroite: true },
        ...(avecComparaison ? [{ titre: 'Comparée', poids: 1.6, aDroite: true }] : []),
      ],
      stats.details.map((d) => ({
        couleur: CATEGORIES_STAT[d.categorie].couleur,
        cellules: [
          CATEGORIES_STAT[d.categorie].libelle,
          libelleSous(d.categorie, d.sous),
          euros(d.montant),
          ...(avecComparaison ? [euros(d.comparaison)] : []),
        ],
      }))
    )
  }

  telecharger(doc, `couts_batiments_${stats.fenetre.debut}_${stats.fenetre.fin}.pdf`)
}
