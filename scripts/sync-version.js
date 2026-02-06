/**
 * Script de synchronisation de version
 * 
 * Ce script extrait la dernière version du CHANGELOG.md et peut :
 * - Mettre à jour le package.json
 * - Mettre à jour le README.md
 * - Afficher la version actuelle
 * 
 * Usage:
 *   node scripts/sync-version.js         # Affiche la version du CHANGELOG
 *   node scripts/sync-version.js --sync  # Synchronise package.json et README.md
 *   node scripts/sync-version.js --check # Vérifie si les versions sont synchronisées
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CHANGELOG_PATH = path.join(ROOT_DIR, 'CHANGELOG.md');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const README_PATH = path.join(ROOT_DIR, 'README.md');

/**
 * Extrait la dernière version du CHANGELOG.md
 * Cherche le pattern ## [X.Y.Z] - YYYY-MM-DD
 */
function getVersionFromChangelog() {
  try {
    const changelog = fs.readFileSync(CHANGELOG_PATH, 'utf8');
    // Cherche le premier ## [X.Y.Z] qui n'est pas "Non publié"
    const versionRegex = /^## \[(\d+\.\d+\.\d+)\]/m;
    const match = changelog.match(versionRegex);
    
    if (match && match[1]) {
      return match[1];
    }
    
    console.error('❌ Aucune version trouvée dans le CHANGELOG.md');
    process.exit(1);
  } catch (error) {
    console.error('❌ Erreur lors de la lecture du CHANGELOG.md:', error.message);
    process.exit(1);
  }
}

/**
 * Récupère la version du package.json
 */
function getVersionFromPackage() {
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
    return pkg.version;
  } catch (error) {
    console.error('❌ Erreur lors de la lecture du package.json:', error.message);
    process.exit(1);
  }
}

/**
 * Met à jour la version dans le package.json
 */
function updatePackageVersion(version) {
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
    const oldVersion = pkg.version;
    pkg.version = version;
    fs.writeFileSync(PACKAGE_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log(`✅ package.json: ${oldVersion} → ${version}`);
    return true;
  } catch (error) {
    console.error('❌ Erreur lors de la mise à jour du package.json:', error.message);
    return false;
  }
}

/**
 * Met à jour le badge de version dans le README.md
 */
function updateReadmeVersion(version) {
  try {
    let readme = fs.readFileSync(README_PATH, 'utf8');
    const badgeRegex = /(!\[Version\]\(https:\/\/img\.shields\.io\/badge\/version-)([\d.]+)(-blue\.svg\))/;
    const match = readme.match(badgeRegex);
    
    if (match) {
      const oldVersion = match[2];
      readme = readme.replace(badgeRegex, `$1${version}$3`);
      fs.writeFileSync(README_PATH, readme, 'utf8');
      console.log(`✅ README.md: ${oldVersion} → ${version}`);
      return true;
    } else {
      console.log('⚠️  Badge de version non trouvé dans README.md');
      return false;
    }
  } catch (error) {
    console.error('❌ Erreur lors de la mise à jour du README.md:', error.message);
    return false;
  }
}

/**
 * Vérifie si toutes les versions sont synchronisées
 */
function checkVersions() {
  const changelogVersion = getVersionFromChangelog();
  const packageVersion = getVersionFromPackage();
  
  let readme = '';
  let readmeVersion = null;
  try {
    readme = fs.readFileSync(README_PATH, 'utf8');
    const match = readme.match(/!\[Version\]\(https:\/\/img\.shields\.io\/badge\/version-([\d.]+)-blue\.svg\)/);
    readmeVersion = match ? match[1] : null;
  } catch (error) {
    // README peut ne pas exister
  }
  
  console.log('\n📋 Versions actuelles:');
  console.log(`   CHANGELOG.md:  ${changelogVersion}`);
  console.log(`   package.json:  ${packageVersion}`);
  if (readmeVersion) {
    console.log(`   README.md:     ${readmeVersion}`);
  }
  
  const allSync = packageVersion === changelogVersion && 
                  (!readmeVersion || readmeVersion === changelogVersion);
  
  if (allSync) {
    console.log('\n✅ Toutes les versions sont synchronisées!');
    return true;
  } else {
    console.log('\n⚠️  Les versions ne sont pas synchronisées.');
    console.log(`   Utilisez: node scripts/sync-version.js --sync`);
    return false;
  }
}

// Point d'entrée principal
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
📦 Synchronisation de version depuis CHANGELOG.md

Usage:
  node scripts/sync-version.js           Affiche la version du CHANGELOG
  node scripts/sync-version.js --sync    Synchronise package.json et README.md
  node scripts/sync-version.js --check   Vérifie si les versions sont synchronisées
  node scripts/sync-version.js --get     Retourne uniquement le numéro de version (pour scripts)
  `);
  process.exit(0);
}

if (args.includes('--get')) {
  console.log(getVersionFromChangelog());
  process.exit(0);
}

if (args.includes('--check')) {
  const synced = checkVersions();
  process.exit(synced ? 0 : 1);
}

if (args.includes('--sync')) {
  const version = getVersionFromChangelog();
  console.log(`\n🔄 Synchronisation vers la version ${version}...\n`);
  
  const pkgUpdated = updatePackageVersion(version);
  const readmeUpdated = updateReadmeVersion(version);
  
  if (pkgUpdated) {
    console.log('\n✅ Synchronisation terminée!');
  }
  process.exit(0);
}

// Par défaut: affiche la version
const version = getVersionFromChangelog();
console.log(`\n📌 Version actuelle dans CHANGELOG.md: ${version}\n`);
checkVersions();
