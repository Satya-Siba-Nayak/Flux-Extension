const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

const arg = process.argv[2];
if (!arg) {
  console.error('Error: Please specify a version (e.g., 2.3.0) or a release type (patch, minor, major).');
  process.exit(1);
}

const files = [
  { path: 'package.json', key: 'version' },
  { path: 'manifest.chrome.json', key: 'version' },
  { path: 'manifest.firefox.json', key: 'version' }
];

// Read current version from package.json
let currentVersion;
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  currentVersion = pkg.version;
} catch (e) {
  console.error('Error: Could not read package.json version.', e);
  process.exit(1);
}

console.log(`Current codebase version: ${currentVersion}`);

let nextVersion = arg.replace(/^v/, '');

if (['patch', 'minor', 'major'].includes(arg.toLowerCase())) {
  const parts = currentVersion.split('.').map(Number);
  while (parts.length < 3) parts.push(0);

  if (parts.some(isNaN)) {
    console.error(`Error: Current version "${currentVersion}" is not in standard X.Y.Z format. Cannot auto-bump. Please specify the target version string directly.`);
    process.exit(1);
  }

  const type = arg.toLowerCase();
  if (type === 'major') {
    parts[0] += 1;
    parts[1] = 0;
    parts[2] = 0;
  } else if (type === 'minor') {
    parts[1] += 1;
    parts[2] = 0;
  } else if (type === 'patch') {
    parts[2] += 1;
  }
  nextVersion = parts.join('.');
}

// Validate nextVersion format (X.Y or X.Y.Z)
if (!/^\d+(\.\d+){1,2}$/.test(nextVersion)) {
  console.error(`Error: Invalid target version format "${nextVersion}". Must be X.Y or X.Y.Z.`);
  process.exit(1);
}

console.log(`Updating codebase to version: ${nextVersion}`);

files.forEach(fileSpec => {
  const filePath = path.join(ROOT_DIR, fileSpec.path);
  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: File ${fileSpec.path} not found.`);
    return;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse(content);
    json[fileSpec.key] = nextVersion;
    fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n', 'utf8');
    console.log(`  Updated ${fileSpec.path}`);
  } catch (e) {
    console.error(`Error updating ${fileSpec.path}:`, e);
  }
});

console.log('\nVersion bump completed successfully!');
