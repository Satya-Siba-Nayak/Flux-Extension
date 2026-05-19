const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

// Read version from arguments, fallback to package.json version
let targetVersion = process.argv[2];
if (!targetVersion) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    targetVersion = pkg.version;
  } catch {
    targetVersion = '1.0.0';
  }
}

// Clean version string (remove leading 'v' if present)
targetVersion = targetVersion.replace(/^v/, '');

// Helper to clean and recreate a directory
function setupDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

// Helper to copy files recursively
function copyFileOrFolder(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(child => {
      copyFileOrFolder(path.join(src, child), path.join(dest, child));
    });
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// Zip directory helper
function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`Created archive: ${outPath} (${archive.pointer()} total bytes)`);
      resolve();
    });

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn(err);
      } else {
        reject(err);
      }
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function build() {
  console.log(`Building version: ${targetVersion}`);
  setupDir(DIST_DIR);

  const platforms = ['chrome', 'firefox'];

  for (const platform of platforms) {
    console.log(`\nPackaging for ${platform.toUpperCase()}...`);
    const platformDist = path.join(DIST_DIR, platform);
    setupDir(platformDist);

    // 1. Copy common source files
    const commonFiles = [
      'background.js',
      'content.js',
      'content.css',
      'popup.html',
      'popup.js',
      'popup.css',
    ];

    commonFiles.forEach(file => {
      const srcPath = path.join(ROOT_DIR, file);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, path.join(platformDist, file));
        console.log(`  Copied: ${file}`);
      } else {
        console.warn(`  Warning: Common file ${file} not found.`);
      }
    });

    // 2. Copy assets (only required icons and fonts, ignoring screenshots)
    const assetDist = path.join(platformDist, 'assets');
    fs.mkdirSync(assetDist, { recursive: true });

    const icons = [
      'Flux transparent-16x.png',
      'Flux transparent-32x.png',
      'Flux transparent-48x.png',
      'Flux transparent-128x.png',
    ];

    icons.forEach(icon => {
      const srcPath = path.join(ROOT_DIR, 'assets', icon);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, path.join(assetDist, icon));
        console.log(`  Copied asset: ${icon}`);
      } else {
        console.warn(`  Warning: Icon ${icon} not found.`);
      }
    });

    // Copy fonts folder
    const fontSrc = path.join(ROOT_DIR, 'assets', 'fonts');
    if (fs.existsSync(fontSrc)) {
      copyFileOrFolder(fontSrc, path.join(assetDist, 'fonts'));
      console.log('  Copied asset folder: fonts');
    }

    // 3. Process and copy manifest (renaming to manifest.json)
    const manifestSrc = path.join(ROOT_DIR, `manifest.${platform}.json`);
    if (fs.existsSync(manifestSrc)) {
      const manifestContent = fs.readFileSync(manifestSrc, 'utf8');
      const manifestJson = JSON.parse(manifestContent);

      // Automatically inject the target version
      manifestJson.version = targetVersion;

      // Write back manifest.json to the package directory
      const manifestDest = path.join(platformDist, 'manifest.json');
      fs.writeFileSync(manifestDest, JSON.stringify(manifestJson, null, 2), 'utf8');
      console.log(`  Generated manifest.json (version set to ${targetVersion})`);
    } else {
      throw new Error(`Manifest file for ${platform} not found: ${manifestSrc}`);
    }

    // 4. Zip the output
    const zipPath = path.join(DIST_DIR, `flux-${platform}-v${targetVersion}.zip`);
    await zipDirectory(platformDist, zipPath);

    // 5. Clean up temporary platform directory
    fs.rmSync(platformDist, { recursive: true, force: true });
    console.log(`  Cleaned temporary folder: dist/${platform}`);
  }

  console.log('\nBuild completed successfully!');
}

build().catch(err => {
  console.error('\nBuild failed:', err);
  process.exit(1);
});
