const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const srcDir = path.join(repoRoot, 'node_modules', 'three', 'build');
const outDir = path.join(repoRoot, 'assets', 'vendor');

fs.mkdirSync(outDir, { recursive: true });

for (const file of ['three.module.js', 'three.core.js']) {
  const src = path.join(srcDir, file);
  const dst = path.join(outDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
    console.log(`Copied ${file} -> assets/vendor/${file}`);
  } else {
    throw new Error(`Missing Three.js file: ${src}`);
  }
}
