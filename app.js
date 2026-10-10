// PrintMaker OS Retro · Cloudflare R2 · versión de prueba
const $ = id => document.getElementById(id);
const BASE = 'https://pub-e255b156b86149298448979225186068.r2.dev/';
const DB = 'printmaker-retro-v1';
// Solo asociamos los archivos que hemos comprobado por nombre. Edita esta tabla para agregar más.
const GAMES = {
  gba001: {path:'Assets01/12.gba', core:'gba'}
};
let deferredInstall = null, objectUrl = null, loading = false;
const idSelect = $('id');
idSelect.replaceChildren();
for (const [prefix,label] of [['gba','Game Boy Advance'],['snes','Super Nintendo']]) {
  for(let n=1;n<=10;n++) {
    const id = prefix+String(n).padStart(3,'0');
    const option=document.createElement('option'); option.value=id;
    option.textContent=label+' · Cartucho '+String(n).padStart(3,'0');
    idSelect.append(option);
  }
}
const requested = new URLSearchParams(location.search).get('id');
if(requested && [...idSelect.options].some(o=>o.value===requested)) idSelect.value=requested;
const gameId=()=>idSelect.value;
function status(message){$('status').textContent=message}
function update(){const url=new URL(location.href);url.searchParams.set('id',gameId());$('url').textContent=url.href;history.replaceState(null,'',url)}
idSelect.addEventListener('change',()=>{update();status('')});
update();
function db(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('games'))req.result.createObjectStore('games')};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function put(key,value){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('games','readwrite');t.objectStore('games').put(value,key);t.oncomplete=()=>{d.close();resolve()};t.onerror=()=>{d.close();reject(t.error)}})}
async function get(key){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('games','readonly');const req=t.objectStore('games').get(key);req.onsuccess=()=>{d.close();resolve(req.result)};req.onerror=()=>{d.close();reject(req.error)}})}
function typeFromName(name){const ext=name.split('.').pop().toLowerCase();return ({gba:'gba',gbc:'gb',sfc:'snes',smc:'snes'})[ext]||null}
$('save').onclick=async()=>{
  const f=$('rom').files[0];if(!f){status('Selecciona una ROM autorizada.');return}
  const core=typeFromName(f.name);
  if(!core){status('Formato no compatible. Usa .gba, .gbc, .sfc o .smc.');return}
  if(f.size<1024){status('El archivo es demasiado pequeño para ser una ROM válida.');return}
  try{await put(gameId(),{name:f.name,bytes:await f.arrayBuffer(),type:core});status('✓ ROM guardada en este navegador. Pulsa Iniciar juego guardado.')}catch(e){status('Error al guardar: '+e.message)}
};
function launch(url,core){
  if(loading)return;
  loading=true;
  $('setup').style.display='none';$('playArea').style.display='block';$('player').replaceChildren();
  window.EJS_player='#player';window.EJS_core=core;window.EJS_gameUrl=url;
  window.EJS_pathtodata='https://cdn.emulatorjs.org/stable/data/';window.EJS_startOnLoaded=true;
  const script=document.createElement('script');script.src='https://cdn.emulatorjs.org/stable/data/loader.js';
  script.onerror=()=>{loading=false;alert('No se pudo descargar EmulatorJS. Comprueba tu conexión.');location.reload()};
  $('player').append(script);
}
$('start').onclick=async()=>{try{const game=await get(gameId());if(!game){status('Primero guarda un juego en este navegador.');return}if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(new Blob([game.bytes]));launch(objectUrl,game.type)}catch(e){status('Error: '+e.message)}};
async function remoteStart(){
  const game=GAMES[gameId()];
  if(!game){status('Este cartucho todavía no tiene un archivo asignado en Cloudflare.');return}
  status('Comprobando juego remoto…');
  try{
    const response=await fetch(BASE+game.path,{method:'GET',mode:'cors',cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength<1024)throw new Error('Archivo vacío o demasiado pequeño');
    if(objectUrl)URL.revokeObjectURL(objectUrl);
    objectUrl=URL.createObjectURL(new Blob([bytes]));
    status('✓ Archivo descargado. Iniciando…');launch(objectUrl,game.core);
  }catch(e){status('No se pudo cargar desde Cloudflare: '+e.message+'. Puedes iniciar un juego local guardado.')}
}
$('remote').onclick=remoteStart;
$('testR2').onclick=async()=>{
  status('Comprobando conexión con Cloudflare…');
  try{const response=await fetch(BASE+'Assets01/prueba2.txt',{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);const content=await response.text();if(!content.trim())throw new Error('El TXT está vacío');status('✓ Conexión Cloudflare R2 verificada.')}catch(e){status('Error al comprobar Cloudflare: '+e.message)}
};
$('back').onclick=()=>location.reload();
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('url').textContent);status('✓ Enlace copiado.')}catch(e){status('Copia el enlace mostrado arriba.')}};
// El Service Worker existente puede servir versiones antiguas: no lo registramos aquí.
// Una vez revisado sw.js, se podrá actualizar para cachear el emulador y sus recursos.
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;$('install').hidden=false});
$('install').onclick=async()=>{if(deferredInstall){deferredInstall.prompt();deferredInstall=null;$('install').hidden=true}};
// Solo arrancamos automáticamente si hay un identificador válido y una ROM asignada.
if(requested===gameId() && GAMES[requested])remoteStart();
