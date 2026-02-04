const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Get all TypeScript files from src directory
function getAllTsFiles(dir, files = []) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllTsFiles(fullPath, files);
    } else if (item.endsWith('.ts') && !item.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function build() {
  try {
    // Build all TypeScript files
    await esbuild.build({
      entryPoints: getAllTsFiles('./src'),
      bundle: false,
      outdir: './dist',
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      sourcemap: true,
    });
    
    console.log('Server build completed successfully!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
