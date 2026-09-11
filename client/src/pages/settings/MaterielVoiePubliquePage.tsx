import ReglageDisponibiliteParc, {
  type ReglageParc,
} from '@/components/settings/ReglageDisponibiliteParc'
import { materielVoiePubliqueApi } from '@/lib/api'

/**
 * Quel matériel du parc peut être posé sur la voie publique.
 *
 * Le catalogue de pose proposerait sinon tout le parc. Un agent venu poser un
 * candélabre au coin de la rue y trouverait les barrières Vauban des
 * manifestations, les radars pédagogiques de la police municipale et les
 * chaises de la salle des fêtes. Le relevé de terrain doit tenir en trois
 * gestes sur un téléphone ; une liste de plusieurs centaines de lignes n'y
 * survit pas.
 *
 * Ce réglage **s'ajoute** aux droits du compte et ne les remplace pas : il dit
 * ce que le module propose, la portée par catégorie dit ce que la personne a le
 * droit de voir.
 */
const REGLAGE: ReglageParc = {
  colonne: 'available_for_public_space',
  effectif: 'posable',
  clef: 'posable',
  libelleOui: 'Posable',
  libelleNon: 'Exclu',
  api: materielVoiePubliqueApi,
  intro: (
    <>
      Ce que le parc propose quand on pose un mobilier sur la carte : candélabres, bancs,
      corbeilles, potelets, abris… Les prestations en sont exclues d’office : elles ne se scellent
      pas dans un trottoir.
    </>
  ),
  explication: (
    <>
      Le réglage le plus précis l’emporte : une catégorie donne le ton, une sous-catégorie
      l’affine, un matériel fait exception. La catégorie Mobilier urbain s’ouvre d’un bloc, sa
      sous-catégorie Signalisation temporaire s’en retire, et un modèle peut faire exception.
    </>
  ),
  sansCategorie: (
    <>
      Ces matériels ne sont rattachés à aucune catégorie : faute de niveau au-dessus, ils restent
      proposés à la pose tant qu’on ne les exclut pas ici.
    </>
  ),
  aucuneCategorie: (
    <>
      Aucune catégorie. Tant que le parc n’est pas classé, tout son matériel est proposé à la pose
      — y compris ce qui n’a rien à faire sur la voie publique.
    </>
  ),
}

export default function MaterielVoiePubliquePage() {
  return <ReglageDisponibiliteParc reglage={REGLAGE} />
}
