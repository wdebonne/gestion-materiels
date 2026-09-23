import { db } from '../index';
import { Contexte, adresse, description, inserer, jour, materielsDe, plusJours, telephone, volume } from './outils';

/** Noms des référentiels créés, repris par la purge : ils n'ont pas d'autre marque. */
export const STATIONS = ['Station CHG Total Pavilly', 'Station CHG Leclerc Barentin', 'Station CHG Intermarché', 'Borne CHG Mairie', 'Station CHG Esso A150'];
export const PRESTATAIRES = ['Garage CHG Renault Pavilly', 'CHG Norauto Barentin', 'CHG Motoculture Normande', 'CHG Pneus Services', 'CHG Carrosserie du Val'];
export const CENTRES = ['CHG Autosur Barentin', 'CHG Dekra Pavilly', 'CHG Sécuritest Maromme'];

export async function genererVehicules(ctx: Contexte): Promise<void> {
  const { alea } = ctx;

  await inserer('fuel_stations', STATIONS.map((name) => ({ name, address: adresse(alea), kind: name.startsWith('Borne') ? 'electric' : 'fuel' })));
  await inserer('maintenance_providers', PRESTATAIRES.map((name) => ({ name, address: adresse(alea), phone: telephone(alea) })));
  await inserer('control_centers', CENTRES.map((name) => ({ name, address: adresse(alea), phone: telephone(alea) })));

  const typesEntretien = (await db.query<{ name: string }>('SELECT name FROM maintenance_types')).map((t) => t.name);
  if (typesEntretien.length === 0) typesEntretien.push('Vidange', 'Pneumatiques', 'Freinage', 'Révision');

  const vehicules = materielsDe(ctx, 'vehicule');
  const engins = materielsDe(ctx, 'engin');
  const roulants = [...vehicules, ...engins];
  if (roulants.length === 0) return;

  // --- Pleins : ~15 000, répartis sur trois ans, compteur croissant par véhicule
  const nPleins = volume(ctx, 15_000);
  const parVehicule = Math.max(1, Math.round(nPleins / roulants.length));
  const pleins: Array<Record<string, unknown>> = [];
  for (const v of roulants) {
    const estVehicule = v.nature === 'vehicule';
    const compteur = estVehicule ? 'kilometrage' : 'heuresMoteur';
    let valeur = alea.entier(1_000, 80_000);
    if (!estVehicule) valeur = alea.entier(10, 1_500);
    const n = alea.entier(Math.ceil(parVehicule / 2), parVehicule * 2);
    let date = plusJours(ctx.maintenant, -3 * 365);
    const pas = (3 * 365) / n;
    for (let i = 0; i < n; i++) {
      date = plusJours(date, Math.max(1, Math.round(pas * alea.reel(0.5, 1.5))));
      if (date > ctx.maintenant) break;
      valeur += estVehicule ? alea.entier(150, 900) : alea.entier(2, 30);
      const electrique = estVehicule && alea.chance(0.1);
      const quantite = electrique ? alea.reel(8, 60) : alea.reel(estVehicule ? 20 : 3, estVehicule ? 90 : 25);
      const prixUnitaire = electrique ? alea.reel(0.18, 0.45, 3) : alea.reel(1.55, 2.05, 3);
      pleins.push({
        object_id: v.id,
        fuel_type: electrique ? 'Électrique' : alea.choix(['Diesel', 'Essence SP95', 'Essence SP98', 'GPL']),
        energy_kind: electrique ? 'electric' : 'fuel',
        quantity: quantite,
        unit_price: prixUnitaire,
        total_price: Math.round(quantite * prixUnitaire * 100) / 100,
        mileage: valeur,
        readings: { [compteur]: valeur },
        station: alea.choix(STATIONS),
        entry_date: jour(date),
        notes: alea.chance(0.05) ? description(alea) : null,
      });
    }
  }
  await inserer('fuel_entries', pleins);

  // --- Contrôles techniques : un tous les deux ans, dont certains échus ou à venir
  const controles: Array<Record<string, unknown>> = [];
  for (const v of vehicules) {
    let date = plusJours(ctx.maintenant, -alea.entier(4 * 365, 6 * 365));
    while (date < ctx.maintenant) {
      const resultat = alea.pondere([['passed', 80], ['minor', 12], ['failed', 8]] as const);
      const echeance = plusJours(date, resultat === 'passed' ? 730 : 60);
      const km = alea.entier(5_000, 200_000);
      controles.push({
        object_id: v.id,
        control_date: jour(date),
        expiry_date: jour(echeance),
        mileage: km,
        readings: { kilometrage: km },
        result: resultat,
        center_name: alea.choix(CENTRES),
        cost: alea.reel(65, 110),
        notes: resultat !== 'passed' ? 'Défauts : ' + alea.choix(['éclairage', 'freinage', 'pneumatiques', 'pollution']) : null,
        reminder_sent: echeance < ctx.maintenant,
      });
      date = plusJours(echeance, alea.entier(-20, 40));
    }
  }
  await inserer('technical_controls', controles);

  // --- Entretiens
  const entretiens: Array<Record<string, unknown>> = [];
  const nEntretiens = volume(ctx, 5_000);
  for (let i = 0; i < nEntretiens; i++) {
    const v = alea.choix(roulants);
    const date = alea.dateAutour(ctx.maintenant, 3 * 365, 60);
    const km = alea.entier(1_000, 200_000);
    entretiens.push({
      object_id: v.id,
      maintenance_type: alea.choix(typesEntretien),
      maintenance_date: jour(date),
      next_date: alea.chance(0.6) ? jour(plusJours(date, alea.entier(90, 400))) : null,
      mileage: v.nature === 'vehicule' ? km : null,
      next_mileage: v.nature === 'vehicule' && alea.chance(0.5) ? km + 15_000 : null,
      readings: v.nature === 'vehicule' ? { kilometrage: km } : { heuresMoteur: alea.entier(10, 3_000) },
      cost: alea.chance(0.9) ? alea.reel(30, 2_500) : null,
      provider: alea.choix(PRESTATAIRES),
      notes: alea.chance(0.3) ? description(alea) : null,
      add_to_calendar: alea.chance(0.2),
    });
  }
  await inserer('maintenances', entretiens);
}
