import ReglageDisponibiliteParc, {
  type ReglageParc,
} from '@/components/settings/ReglageDisponibiliteParc'
import { materielPretableApi } from '@/lib/api'

/**
 * Quel matériel du parc peut être prêté pour une manifestation.
 *
 * Le sélecteur proposait tout le parc. Or une catégorie ne se prête pas d'un
 * bloc : un réfrigérateur de la catégorie Électroménager part volontiers pour
 * une brocante, le grill de la même catégorie non.
 *
 * L'écran lui-même vit dans `ReglageDisponibiliteParc` : les espaces verts
 * posent la même question sur une autre colonne, et deux copies auraient fini
 * par se répondre différemment. Ici ne restent que les mots propres au prêt.
 */
const REGLAGE: ReglageParc = {
  colonne: 'available_for_manifestations',
  effectif: 'pretable',
  clef: 'pretable',
  libelleOui: 'Prêtable',
  libelleNon: 'Exclu',
  api: materielPretableApi,
  intro: (
    <>
      Ce que le parc peut prêter pour une manifestation. Ne concerne pas le stock dédié
      (tables, chaises), qui est prêtable par définition.
    </>
  ),
  explication: (
    <>
      Le réglage le plus précis l'emporte : une catégorie donne le ton, une sous-catégorie
      l'affine, un matériel fait exception. Un réfrigérateur peut partir pour une brocante quand
      le grill de la même catégorie reste à la cuisine.
    </>
  ),
  sansCategorie: (
    <>
      Ces matériels ne sont rattachés à aucune catégorie : faute de niveau au-dessus, ils sont
      prêtables tant qu'on ne les exclut pas ici.
    </>
  ),
  aucuneCategorie: (
    <>
      Aucune catégorie. Tant que le parc n'est pas classé, tout son matériel reste prêtable
      par défaut et aucun service ne sera sollicité pour lui.
    </>
  ),
}

export default function MaterielPretablePage() {
  return <ReglageDisponibiliteParc reglage={REGLAGE} />
}
