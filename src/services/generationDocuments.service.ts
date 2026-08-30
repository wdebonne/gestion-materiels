import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { db } from '../database';
import { logService } from './log.service';
import { lireFichier } from './webdav.service';
import {
  appliquerCorrespondance,
  donneesPourModele,
} from './donneesModele.service';
import {
  completerDonneesManquantes,
  estDocxValide,
  remplirModele,
} from './modeleDocx.service';
import { cheminSurDisque, supprimerFichier } from './manifestationDocuments.service';
import { notifierServicesConcernes } from './manifestationNotify.service';

/**
 * Production des documents de service pour une manifestation.
 *
 * À la réception d'une demande, chaque service sollicité reçoit un document
 * pré-rempli **de sa seule part** : le service qui instruit un débit de boissons
 * n'a que faire du raccordement électrique ni du nombre de chaises. Le document
 * est joint à la manifestation et part avec la demande d'approbation.
 *
 * Deux principes tiennent ce module.
 *
 * **Un modèle défaillant ne bloque jamais rien.** Un `.docx` mal formé, un
 * Nextcloud injoignable : l'erreur est notée sur le modèle et la manifestation
 * suit son cours. Refuser une demande de manifestation parce qu'un modèle Word
 * a été mal enregistré serait hors de proportion.
 *
 * **Une regénération remplace, elle n'empile pas.** Les dates changent, les
 * quantités aussi ; sans remplacement, une manifestation finirait avec six
 * versions du même arrêté et personne ne saurait laquelle est bonne. Seules les
 * pièces produites par l'application sont remplacées — celles déposées à la main
 * ne sont jamais touchées.
 */

const TYPE_MIME_DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function lireJson<T>(brut: unknown, defaut: T): T {
  if (!brut) return defaut;
  try {
    return typeof brut === 'string' ? (JSON.parse(brut) as T) : (brut as T);
  } catch {
    return defaut;
  }
}

/** Modèle actif d'un service, `null` s'il n'en a pas. */
export async function modeleDuService(serviceId: number | string): Promise<any | null> {
  return db.queryOne(
    'SELECT * FROM service_templates WHERE service_id = ? AND is_active = 1 ORDER BY id LIMIT 1',
    [serviceId]
  );
}

/** Note l'échec sur le modèle : sans cela, un modèle cassé reste silencieux. */
async function noterErreur(modeleId: number, erreur: string | null): Promise<void> {
  await db.execute(
    'UPDATE service_templates SET last_error = ?, updated_at = ? WHERE id = ?',
    [erreur, new Date().toISOString(), modeleId]
  );
}

/**
 * Contenu du modèle, qu'il soit téléversé ou tenu dans Nextcloud.
 *
 * Le modèle Nextcloud est relu à chaque génération : une correction faite le
 * matin s'applique l'après-midi, sans repasser par l'application.
 */
export async function contenuDuModele(
  modele: any
): Promise<{ contenu?: Buffer; error?: string }> {
  if (modele.source === 'nextcloud') {
    if (!modele.remote_path) return { error: 'Aucun chemin Nextcloud indiqué sur ce modèle' };

    const lecture = await lireFichier(modele.remote_path);
    return lecture.success ? { contenu: lecture.contenu } : { error: lecture.error };
  }

  if (!modele.file_path) return { error: 'Aucun fichier associé à ce modèle' };

  const complet = cheminSurDisque(modele.file_path);
  if (!complet) return { error: 'Le fichier du modèle est introuvable sur le disque' };

  return { contenu: fs.readFileSync(complet) };
}

export interface ResultatGeneration {
  service_id: number;
  service_name: string;
  success: boolean;
  document_id?: number;
  file_path?: string;
  error?: string;
}

/**
 * Produit le document d'un service pour une manifestation, et le joint.
 *
 * Rend un résultat plutôt que de lever : l'appelant en produit plusieurs et un
 * échec ne doit pas emporter les autres.
 */
export async function genererPourService(
  manifestationId: number | string,
  serviceId: number,
  userId?: number
): Promise<ResultatGeneration> {
  const service = await db.queryOne('SELECT id, name FROM services WHERE id = ?', [serviceId]);
  const nom = service?.name ?? `Service ${serviceId}`;
  const echec = (error: string): ResultatGeneration => ({
    service_id: serviceId,
    service_name: nom,
    success: false,
    error,
  });

  if (!service) return echec('Service introuvable');

  const modele = await modeleDuService(serviceId);
  if (!modele) return echec('Aucun modèle de document pour ce service');

  const { contenu, error } = await contenuDuModele(modele);
  if (!contenu) {
    await noterErreur(modele.id, error ?? 'Modèle illisible');
    return echec(error ?? 'Modèle illisible');
  }

  if (!(await estDocxValide(contenu))) {
    const message = "Ce fichier n'est pas un document Word (.docx) exploitable";
    await noterErreur(modele.id, message);
    return echec(message);
  }

  try {
    const champs = lireJson<string[]>(modele.detected_fields, []);
    const correspondance = lireJson<Record<string, string>>(modele.field_mapping, {});

    const donnees = await donneesPourModele(manifestationId, serviceId);
    const pourLeModele = completerDonneesManquantes(
      appliquerCorrespondance(donnees, champs, correspondance),
      champs
    );

    const produit = await remplirModele(contenu, pourLeModele);

    const dossier = path.resolve(process.cwd(), 'uploads');
    fs.mkdirSync(dossier, { recursive: true });
    const nomFichier = `${randomUUID()}.docx`;
    fs.writeFileSync(path.join(dossier, nomFichier), produit);
    const cheminPublic = `/uploads/${nomFichier}`;

    const manifestation = await db.queryOne('SELECT title FROM manifestations WHERE id = ?', [
      manifestationId,
    ]);
    const libelle = `${modele.name} — ${nom}`;

    await remplacerDocumentGenere(manifestationId, serviceId, {
      name: libelle,
      description: `Document pré-rempli pour ${nom} — ${manifestation?.title ?? ''}`,
      file_path: cheminPublic,
      size: produit.length,
      userId,
    });

    await noterErreur(modele.id, null);

    const document = await db.queryOne(
      `SELECT id FROM manifestation_documents
       WHERE manifestation_id = ? AND service_id = ? AND generated_from_template = 1`,
      [manifestationId, serviceId]
    );

    return {
      service_id: serviceId,
      service_name: nom,
      success: true,
      document_id: document?.id,
      file_path: cheminPublic,
    };
  } catch (erreur: any) {
    const message = erreur?.message ?? 'Génération interrompue';
    await noterErreur(modele.id, message);
    return echec(message);
  }
}

/**
 * Remplace le document produit précédemment pour ce service, fichier compris.
 *
 * Sans remplacement, une manifestation dont les dates changent trois fois
 * finirait avec trois arrêtés et personne ne saurait lequel fait foi.
 */
async function remplacerDocumentGenere(
  manifestationId: number | string,
  serviceId: number,
  document: {
    name: string;
    description: string;
    file_path: string;
    size: number;
    userId?: number;
  }
): Promise<void> {
  const anciens = await db.query(
    `SELECT id, file_path FROM manifestation_documents
     WHERE manifestation_id = ? AND service_id = ? AND generated_from_template = 1`,
    [manifestationId, serviceId]
  );

  for (const ancien of anciens) {
    await db.execute('DELETE FROM manifestation_documents WHERE id = ?', [ancien.id]);
    // Un fichier oublié vaut mieux qu'une génération qui refuse d'aboutir :
    // `supprimerFichier` ne lève jamais.
    supprimerFichier(ancien.file_path);
  }

  await db.execute(
    `INSERT INTO manifestation_documents
       (manifestation_id, name, doc_type, description, file_path, mime_type, size,
        service_id, generated_from_template, uploaded_by, created_at)
     VALUES (?, ?, 'convention', ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      manifestationId,
      document.name,
      document.description,
      document.file_path,
      TYPE_MIME_DOCX,
      document.size,
      serviceId,
      document.userId ?? null,
      new Date().toISOString(),
    ]
  );
}

/**
 * Produit les documents de tous les services sollicités qui ont un modèle.
 *
 * Un service sans modèle n'est pas une erreur : la plupart n'en auront pas.
 */
export async function genererPourManifestation(
  manifestationId: number | string,
  userId?: number
): Promise<ResultatGeneration[]> {
  const services = await db.query(
    `SELECT DISTINCT s.id, s.name
     FROM manifestation_approvals a
     JOIN services s ON s.id = a.service_id
     WHERE a.manifestation_id = ? AND s.is_active = 1`,
    [manifestationId]
  );

  const resultats: ResultatGeneration[] = [];
  for (const service of services) {
    if (!(await modeleDuService(service.id))) continue;
    resultats.push(await genererPourService(manifestationId, service.id, userId));
  }

  const rates = resultats.filter((r) => !r.success);
  if (rates.length > 0) {
    await logService.warning(
      'api',
      `Documents de service non produits pour la manifestation ${manifestationId}`,
      { services: rates.map((r) => `${r.service_name} : ${r.error}`) }
    );
  }

  return resultats;
}

/**
 * Produit sans faire attendre l'appelant ni risquer de le faire échouer.
 *
 * C'est la forme à utiliser depuis une route : personne n'a à patienter pendant
 * qu'un Nextcloud répond, et un modèle mal enregistré ne doit surtout pas faire
 * échouer la réception d'une demande.
 */
export function genererSansAttendre(manifestationId: number | string, userId?: number): void {
  void genererPourManifestation(manifestationId, userId).catch((erreur) => {
    console.error('Génération des documents interrompue :', erreur?.message ?? erreur);
  });
}

/**
 * Produit les documents, **puis** sollicite les services.
 *
 * L'ordre est ce qui compte : la demande d'approbation emporte en pièce jointe
 * le document du service, et notifier d'abord enverrait un courriel nu. Les deux
 * étapes partent ensemble en arrière-plan — personne n'a à patienter pendant
 * qu'un Nextcloud répond, et un modèle mal enregistré ne doit surtout pas faire
 * échouer la réception d'une demande.
 */
export function produireEtNotifier(
  manifestationId: number | string,
  titre: string,
  approbations: Array<{ id: number; service: any }>,
  userId?: number
): void {
  void (async () => {
    await genererPourManifestation(manifestationId, userId);
    notifierServicesConcernes(manifestationId, titre, approbations);
  })().catch((erreur) => {
    // La sollicitation part quand même : un service qui ignore qu'on l'attend
    // bloque la manifestation sans le savoir, ce qui est bien pire qu'un
    // courriel sans pièce jointe.
    console.error('Documents de service non produits :', erreur?.message ?? erreur);
    notifierServicesConcernes(manifestationId, titre, approbations);
  });
}
