// PrintMaker OS Retro — almacenamiento local + Cloudflare R2
// Usa únicamente archivos de juegos que tengas derecho a distribuir.
const $ = id => document.getElementById(id);
const dbName = 'printmaker-retro-v1';
const R2_BASE = 'https://pub-e255b156b86149298448979225186068.r2.dev';
const TEST_URL = `${R2_BASE}/Assets01/prueba2.txt`;
let deferredInstall = null;
let objectUrl = null;
let starting = false;

// Los nombres son convenciones: el archivo debe existir realmente en R2.
// Cambia los nombres aquí si subes tus propios juegos autorizados con otros nombres.
const remoteGames = {};
for (let i = 1; i <= 10; i++) {
  const n = String(i).padStart(3, '0');
  remoteGames[`gba${n}`] = { path: `Assets01/${n}.gba`, type: 'gba' };
  remoteGames[`snes${n}`] = { path: `Assets02/${n}.sfc`, type: 'snes' };
}

function status(message) { $('status').textContent = message; }
function gameId() { return $('id').value; }
function update() {
  const url = new URL(location.href);
  url.searchParams.set('id', gameId());
  $('url').textContent = url.href;
  history.replaceState(null, '', url);
}

// Amplía el selector original sin modificar index.html.
const selector = $('id');
const existing = new Set([...selector.options].map(option => option.value));
for (const id of Object.keys(remoteGames)) {
  if (!existing.has(id)) selector.add(new Option(id.toUpperCase(), id));
}
const requestedId = new URLSearchParams(location.search).get('id');
if (requestedId && remoteGames[requestedId]) selector.value = requestedId;
selector.onchange = () => { update(); status(''); };
update();

function db() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('games')) request.result.createObjectStore('games');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function put(key, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('games', 'readwrite');
    transaction.objectStore('games').put(value, key);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}
async function get(key) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('games', 'readonly');
    const request = transaction.objectStore('games').get(key);
    request.onsuccess = () => { database.close(); resolve(request.result); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}
function valid(file) { return file && /\.(gba|sfc|smc|zip)$/i.test(file.name); }
function plausibleRom(bytes, type) {
  // Reject empty/text/HTML error pages. This is a sanity check, not a ROM validator.
  if (!bytes || bytes.byteLength < 32768) return false;
  const head = new Uint8Array(bytes, 0, Math.min(256, bytes.byteLength));
  const prefix = new TextDecoder().decode(head.slice(0, 80)).trimStart().toLowerCase();
  if (prefix.startsWith('<!doctype') || prefix.startsWith('<html') || prefix.startsWith('<?xml') || prefix.startsWith('hola printmaker')) return false;
  return type === 'gba' || type === 'snes';
}
async function removeSaved(id) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('games', 'readwrite');
    tx.objectStore('games').delete(id);
    tx.oncomplete = () => { database.close(); resolve(); };
    tx.onerror = () => { database.close(); reject(tx.error); };
  });
}

$('save').onclick = async () => {
  const file = $('rom').files[0];
  if (!valid(file)) return status('Selecciona un archivo .gba, .sfc, .smc o .zip');
  const isGba = gameId().startsWith('gba');
  if (!/\.zip$/i.test(file.name) && (isGba ? !/\.gba$/i.test(file.name) : !/\.(sfc|smc)$/i.test(file.name))) {
    return status('El archivo no corresponde a la consola seleccionada.');
  }
  try {
    const bytes = await file.arrayBuffer();
    if (!plausibleRom(bytes, isGba ? 'gba' : 'snes')) return status('El archivo es demasiado pequeño o no parece un juego válido.');
    await put(gameId(), { name: file.name, bytes, type: isGba ? 'gba' : 'snes' });
    status('✓ Guardado en este navegador. Pulsa Iniciar juego guardado.');
  } catch (error) { status('No se pudo guardar: ' + error.message); }
};

async function play(game) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(new Blob([game.bytes]));
  $('setup').style.display = 'none';
  $('playArea').style.display = 'block';
  $('player').replaceChildren();
  window.EJS_player = '#player';
  window.EJS_core = game.type;
  window.EJS_gameUrl = objectUrl;
  window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
  window.EJS_startOnLoaded = true;
  const script = document.createElement('script');
  script.src = 'https://cdn.emulatorjs.org/stable/data/loader.js';
  script.onerror = () => {
    alert('No se pudo descargar EmulatorJS. Comprueba tu conexión.');
    $('back').click();
  };
  $('player').append(script);
}

async function startGame() {
  if (starting) return;
  starting = true;
  try {
    const id = gameId();
    const remote = remoteGames[id];
    let game = await get(id);
    if (game && !plausibleRom(game.bytes, game.type)) {
      await removeSaved(id);
      game = null;
      status('Se descartó un archivo local inválido; comprobando servidor…');
    }
    if (game) {
      status('✓ Cargando juego guardado en este dispositivo…');
      await play(game);
      return;
    }
    if (remote) {
      status('Buscando juego autorizado en Cloudflare…');
      try {
        const response = await fetch(`${R2_BASE}/${remote.path}`, { mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (!plausibleRom(bytes, remote.type)) throw new Error('No parece una ROM válida (podría ser texto o una página de error)');
        game = { name: remote.path.split('/').pop(), bytes, type: remote.type };
        try { await put(id, game); } catch (e) { console.warn('No se pudo guardar copia local:', e); }
        status('✓ Archivo cargado desde Cloudflare.');
        await play(game);
        return;
      } catch (error) {
        console.warn('R2 no disponible para', id, error);
      }
    }
    status('No hay un juego disponible para este cartucho. Sube un archivo autorizado a R2 o selecciona uno localmente.');
  } catch (error) {
    status('Error: ' + error.message);
  } finally { starting = false; }
}
$('start').onclick = startGame;
$('testR2').onclick = testR2;
$('clearSaved').onclick = async () => {
  try { await removeSaved(gameId()); status('✓ Archivo local borrado para este cartucho.'); }
  catch (error) { status('No se pudo borrar: ' + error.message); }
};
$('back').onclick = () => location.reload();
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('url').textContent); status('✓ Enlace copiado.'); }
  catch { status('Copia el enlace que aparece arriba.'); }
};

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); deferredInstall = event; $('install').hidden = false;
});
$('install').onclick = async () => {
  if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; $('install').hidden = true; }
};

// Comprueba lectura entre dominios, no solamente que el enlace abra por separado.
async function testR2() {
  try {
    const response = await fetch(TEST_URL, { mode: 'cors', cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const content = await response.text();
    if (!content.trim()) throw new Error('archivo vacío');
    status('✓ Conexión Cloudflare R2 verificada. Selecciona un juego para continuar.');
  } catch (error) {
    status('Cloudflare R2: no se pudo comprobar la conexión (' + error.message + '). Puedes seguir usando archivos locales.');
  }
}
// Al abrir el enlace NFC se intenta iniciar el juego asignado.
// El archivo de prueba .txt NUNCA se envía al emulador.
if (requestedId && remoteGames[requestedId]) startGame();
else testR2();

