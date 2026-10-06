// Kopiert die Web-App aus dem Hauptordner in desktop/web, damit sie mit eingepackt wird.
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, 'web');
fs.mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'app.js', 'style.css', 'desktop.js', 'sync.js']) {
  fs.copyFileSync(path.join(__dirname, '..', f), path.join(out, f));
}
console.log('Web-App nach desktop/web kopiert');
