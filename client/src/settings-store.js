// Sauvegarde des réglages dans un fichier JSON (dossier de données de l'appli)
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  serverUrl: '',
  accessKey: '',
  nickname: '',
  enabled: true, // réception ON/OFF
  displayId: null, // null = écran principal
  position: 'top-right', // center | top-left | top-center | top-right | bottom-left | bottom-center | bottom-right
  maxWidthPct: 30, // taille max du média, en % de la largeur de l'écran
  maxHeightPct: 35, // ... et de la hauteur
  durationSec: 10, // durée d'affichage d'une image / d'un gif
  maxVideoSec: 30, // une vidéo est coupée au-delà
  volume: 50, // 0-100
  showText: true,
  hotkeyHide: 'Alt+Shift+H', // masquer ce qui s'affiche (et vider la file)
  hotkeyToggle: 'Alt+Shift+L', // ON/OFF de la réception
  autoStart: false,
};

class SettingsStore {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = { ...DEFAULTS };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const k of Object.keys(DEFAULTS)) if (k in raw) this.data[k] = raw[k];
    } catch {
      /* premier lancement */
    }
  }
  get() {
    return { ...this.data };
  }
  set(patch) {
    for (const [k, v] of Object.entries(patch || {})) {
      if (!(k in DEFAULTS)) continue;
      if (typeof DEFAULTS[k] === 'number') {
        const n = Number(v);
        if (Number.isFinite(n)) this.data[k] = n;
      } else if (typeof DEFAULTS[k] === 'boolean') {
        this.data[k] = !!v;
      } else {
        this.data[k] = v;
      }
    }
    this.data.maxWidthPct = clamp(this.data.maxWidthPct, 5, 100);
    this.data.maxHeightPct = clamp(this.data.maxHeightPct, 5, 100);
    this.data.durationSec = clamp(this.data.durationSec, 2, 60);
    this.data.maxVideoSec = clamp(this.data.maxVideoSec, 3, 120);
    this.data.volume = clamp(this.data.volume, 0, 100);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.error('Impossible de sauvegarder les réglages', e);
    }
    return this.get();
  }
}

function clamp(n, a, b) {
  return Math.min(b, Math.max(a, Number(n) || a));
}

module.exports = { SettingsStore, DEFAULTS };
