import ReglageDisponibiliteParc, {
  type ReglageParc,
} from '@/components/settings/ReglageDisponibiliteParc'
import { materielImplantableApi } from '@/lib/api'

/**
 * Quel matériel du parc peut être implanté dans un espace vert.
 *
 * Le catalogue d'implantation proposait tout le parc. Un jardinier venu poser
 * trente rosiers y trouvait les barrières Vauban des manifestations, les radars
 * pédagogiques de la police municipale et les chaises de la salle des fêtes.
 * Sur un parc de plusieurs centaines de lignes, chercher « gazon » là-dedans est
 * un travail en soi, et le matériel finit posé au hasard ou pas posé du tout.
 *
 * Ce réglage **s'ajoute** aux droits du compte et ne les remplace pas : il dit
 * ce que le module propose, la portée par catégorie dit ce que la personne a le
 * droit de voir.
 */
const REGLAGE: ReglageParc = {
  colonne: 'available_for_green_spaces',
  effectif: 'implantable',
  clef: 'implantable',
  libelleOui: 'Implantable',
  libelleNon: 'Exclu',
  api: materielImplantableApi,
  intro: (
    <>
      Ce que le parc propose quand on garnit un espace vert ou qu'on choisit le matériau d'une
      zone du plan. Les prestations en sont exclues d'office : elles ne se plantent pas.
    </>
  ),
  explication: (
    <>
      Le réglage le plus précis l'emporte : une catégorie donne le ton, une sous-catégorie
      l'affine, un matériel fait exception. La catégorie Espaces verts s'ouvre d'un bloc, sa
      sous-catégorie Outillage s'en retire, et une tondeuse peut faire exception.
    </>
  ),
  sansCategorie: (
    <>
      Ces matériels ne sont rattachés à aucune catégorie : faute de niveau au-dessus, ils restent
      proposés à l'implantation tant qu'on ne les exclut pas ici.
    </>
  ),
  aucuneCategorie: (
    <>
      Aucune catégorie. Tant que le parc n'est pas classé, tout son matériel est proposé à
      l'implantation — y compris ce qui n'a rien à faire dans un massif.
    </>
  ),
}

export default function MaterielImplantablePage() {
  return <ReglageDisponibiliteParc reglage={REGLAGE} />
}
