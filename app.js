'use strict';
// PMOS - GBA / IodineGBA. No utiliza EmulatorJS.
const R2 = 'https://pub-e255b156b86149298448979225186068.r2.dev/';
const GAMES = {}; // games.json: rutas de ROM autorizadas configuradas por cartucho.
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const gameId = params.get('id') || 'gba001';
let emulator, timer, started = false;
let currentPath='', activeCart='';
let saveStoreReady = null, saveTimer = null, lastSavedFingerprint = '';
let saveDirty = new Map(), saveFlushPromise = Promise.resolve();
let audioContext=null, audioNode=null, audioSink=null, rafId=0, lastFrameTime=0;
let ticks = 0, bootStart = 0;

// Modo offline: ROM y BIOS en IndexedDB; el Service Worker conserva la app y motor.
const ASSET_DB='printmaker-gba-offline-v11';
let assetDbPromise=null;
function assetDB(){
  if(!assetDbPromise) assetDbPromise=new Promise((resolve,reject)=>{
    const r=indexedDB.open(ASSET_DB,1);
    r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('assets'))r.result.createObjectStore('assets');};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  }).catch(e=>{assetDbPromise=null;throw e});
  return assetDbPromise;
}
async function assetGet(key){
  const db=await assetDB();return new Promise((resolve,reject)=>{
    const r=db.transaction('assets','readonly').objectStore('assets').get(key);
    r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);
  });
}
async function assetPut(key,bytes){
  const db=await assetDB();return new Promise((resolve,reject)=>{
    const t=db.transaction('assets','readwrite');t.objectStore('assets').put(bytes,key);
    t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);
  });
}
async function fetchOrOffline(key,url,verify){
  // Priorizar archivos locales evita descargas reiteradas y funciona en modo avión.
  const previous=await assetGet(key).catch(e=>{console.warn('Caché local:',e);return null});
  if(previous){
    const bytes=new Uint8Array(previous);
    if(verify(bytes))return {bytes,source:'local'};
  }
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),25000);
  try{
    const response=await fetch(url,{mode:'cors',signal:controller.signal,cache:'no-store'});
    if(!response.ok)throw Error('HTTP '+response.status);
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(!verify(bytes))throw Error('Archivo inválido o incompleto');
    await assetPut(key,bytes.buffer.slice(0)).catch(e=>{throw Error('Sin espacio para guardar el juego offline: '+e.message)});
    return {bytes,source:'red'};
  }finally{clearTimeout(timeout)}
}
function offlineStatus(value){const e=$('offlineStatus');if(e)e.textContent=value;}
async function isAppOfflineReady(){
  if(!('serviceWorker' in navigator))return false;
  const ready=await Promise.race([navigator.serviceWorker.ready,new Promise(resolve=>setTimeout(()=>resolve(null),4500))]);
  if(!ready?.active)return false;
  const cache=await caches.open('printmaker-gba-v11-2');
  const [index,engine]=await Promise.all([cache.match('./index.html'),cache.match('./IodineGBA/core/Emulator.js')]);
  return !!(index&&engine);
}

function emuState(){
 if(!emulator) return 'motor no creado';
 const e=emulator;
 const st=e.emulatorStatus|0;
 const statusLabel=({1:'esperando guardado',5:'ejecutando',16:'pausado/sin iniciar',17:'pausado con núcleo cargado',21:'pausado con núcleo listo'})[st] || 'estado '+st;
 const cycles=e.clockCyclesSinceStart ?? 0;
 const scan=e.IOCore?.gfxState?.currentScanLine ?? '—';
 return `estado ${st} (${statusLabel}) · ciclos ${cycles} · ticks ${ticks} · línea ${scan} · cuadros ${frames}`;
}
window.PrintMakerDiagnostico=()=>({state:emuState(), status:emulator?.emulatorStatus, frames,ticks,cycles:emulator?.clockCyclesSinceStart, core:!!emulator?.IOCore});

function message(value, retry=false){$('overlay').hidden=false;$('message').textContent=value;$('retry').hidden=!retry;}
const canvas = $('gba');
const ctx = canvas.getContext('2d', {alpha:false});
const image = ctx.createImageData(240,160);
let frames=0;
const graphicsSink = {
  copyBuffer(rgb) {
    // IodineGBA entrega RGB: 240 × 160 × 3 bytes (no RGBA).
    if (!rgb || rgb.length !== 240*160*3) return;
    const dst=image.data;
    for(let s=0,d=0;s<rgb.length;s+=3,d+=4){dst[d]=rgb[s];dst[d+1]=rgb[s+1];dst[d+2]=rgb[s+2];dst[d+3]=255;}
    ctx.putImageData(image,0,0);
    if (++frames===1) {$('overlay').hidden=true;}
  }
};
async function boot(){
  try {await flushSave()}catch(e){console.warn(e)}
  clearInterval(saveTimer); cancelAnimationFrame(rafId); clearInterval(timer); frames=0; ticks=0; bootStart=performance.now(); started=false; if(emulator)emulator.pause();
  if(audioSink) audioSink.reset();
  // Fetch config fresh; SW usa network-first para juegos.json.
  let path;
  try {
    const res=await fetch('games.json', {cache:'no-store'});
    if(!res.ok) throw new Error('games.json HTTP '+res.status);
    const games=await res.json();
    Object.assign(GAMES,games);
    path=GAMES[gameId];
  } catch(e){message('No se pudo leer games.json: '+e.message,true);return;}
  if(typeof path !== 'string' || !/^Assets0[1-9]\/[a-zA-Z0-9._/-]+\.gba$/i.test(path) || path.includes('..')){
    message('El cartucho '+gameId+' no tiene una ROM GBA configurada en games.json.',false);return;
  }
  currentPath=path; activeCart=gameId;
  lastSavedFingerprint='';

  if(typeof window.GameBoyAdvanceEmulator!=='function'){
    message('Falta el motor IodineGBA. Instala sus archivos en vendor/ y revisa LEEME.txt.',true);return;
  }
  message('Preparando archivos del juego…');
  try{
    const [romResult,biosResult]=await Promise.all([
      fetchOrOffline('rom:'+path,R2+path,data=>data.length>=1024),
      fetchOrOffline('bios:gba',R2+'System/gba_bios.bin',data=>data.length===16384)
    ]);
    const rom=romResult.bytes;
    const bios=biosResult.bytes;
    const local=romResult.source==='local'&&biosResult.source==='local';
    offlineStatus(local?'🎮 ROM y BIOS guardadas en este dispositivo':'⬇ ROM y BIOS descargadas y guardadas');
    isAppOfflineReady().then(ok=>{
      if(ok)offlineStatus('✓ Listo para jugar sin internet (mientras se conserven los datos del navegador)');
      else offlineStatus('Juego guardado. La página terminará de prepararse para uso offline al instalar su caché.');
    }).catch(console.warn);
    message('Iniciando emulador…');
    emulator=new GameBoyAdvanceEmulator();
    emulator.settings.offthreadGfxEnabled=false;
    emulator.attachGraphicsFrameHandler(graphicsSink);
    if(audioSink) emulator.attachAudioHandler(audioSink);
    emulator.attachPlayStatusHandler(()=>{});
    // Guardado real: importación asíncrona con callback SIEMPRE completado.
    // IodineGBA solicita primero el save y luego TYPE_ + nombre.
    emulator.attachSaveImportHandler((name, success, failure)=>{
      readSaveKey(activeCart+':'+name).then(value=>{
        if(value && value.length) success(Array.from(value));
        else failure(); // IodineGBA necesita failure() para continuar sin guardado anterior.
      }).catch(err=>{
        console.warn('Lectura de partida:',err);
        failure();
      });
    });
    emulator.attachSaveExportHandler((name, values)=>{
      if(!values || !values.length) return;
      saveDirty.set(activeCart+':'+name, new Uint8Array(values));
    });
    // No activamos funciones de guardado hasta tener implementacion real.
    // No registrar importador de guardados hasta implementarlo: un callback vacío
    // deja el estado del emulador en 1 (esperando guardado) indefinidamente.
    // Sin importador, IodineGBA pasa directamente a estado 5 (listo para ejecutar).
    emulator.attachBIOS(bios);
    emulator.attachROM(rom);
    emulator.play();
    clearInterval(saveTimer);
    saveTimer=setInterval(()=>{flushSave().catch(console.error)},12000);
    console.info('[PMOS] IodineGBA estado tras iniciar:', emulator.emulatorStatus);
    $('message').textContent='Iniciando GBA… '+emuState();
    // Sin acumular intervalos mientras el hilo principal dibuja o recibe pulsaciones.
    lastFrameTime=0;
    const cycle=(stamp)=>{
      try {
        if (!lastFrameTime || stamp-lastFrameTime >= 15) {
          lastFrameTime=stamp;
          ticks++;
          emulator.timerCallback(stamp);
        }
        rafId=requestAnimationFrame(cycle);
      } catch(e) {cancelAnimationFrame(rafId);console.error(e);message('Error del motor: '+e.message,true);}
    };
    rafId=requestAnimationFrame(cycle);
    const diagnostic=setInterval(()=>{
      if(frames>0){clearInterval(diagnostic);return;}
      const age=Math.floor((performance.now()-bootStart)/1000);
      message('Diagnóstico ('+age+' s): '+emuState(),age>=10);
      if(age>=25)clearInterval(diagnostic);
    },1000);
  }catch(error){console.error(error);message('No se pudo iniciar: '+error.message,true)}
}
$('retry').addEventListener('click',boot);
for(const button of document.querySelectorAll('[data-key]')){
  const key=Number(button.dataset.key);
  const release=event=>{event.preventDefault();button.classList.remove('pressed');emulator?.keyUp(key)};
  button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);button.classList.add('pressed');emulator?.keyDown(key)});
  button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
}
// WebAudio: salida estéreo para el buffer PCM de IodineGBA.
// La activación inicial requiere un gesto del usuario por las reglas del navegador.
function createAudioSink(context) {
  let samples=new Float32Array(131072), read=0, write=0, count=0;
  let enabled=false;
  const capacity=samples.length;
  function enqueue(v){
    if(count>=capacity){read=(read+1)%capacity;count--;}
    samples[write]=v; write=(write+1)%capacity;count++;
  }
  const sink={
    initialize(channels,sampleRate,bufferLimit) {
      sink.reset();
    },
    register(){enabled=true;},
    unregister(){enabled=false; sink.reset();},
    setBufferSpace(){},
    remainingBuffer(){return count;},
    reset(){read=0;write=0;count=0;},
    push(buffer,start,end){for(let i=start;i<end;i++) enqueue(buffer[i]);}
  };
  // ScriptProcessor es compatible con los navegadores modernos, aunque legado.
  // Mantiene baja latencia con buffers de 1024 muestras; AudioWorklet es una mejora futura.
  const node=context.createScriptProcessor(1024,0,2);
  node.onaudioprocess=(event)=>{
    const left=event.outputBuffer.getChannelData(0);
    const right=event.outputBuffer.getChannelData(1);
    for(let i=0;i<left.length;i++){
      if(enabled && count>=2){
        left[i]=samples[read]; read=(read+1)%capacity;
        right[i]=samples[read];read=(read+1)%capacity;count-=2;
      }else {left[i]=0;right[i]=0;}
    }
  };
  node.connect(context.destination);
  audioNode=node;
  return sink;
}
$('sound').addEventListener('click',async()=>{
  try{
    if(!audioContext){
      audioContext=new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive',sampleRate:44100});
      audioSink=createAudioSink(audioContext);
      if(emulator)emulator.attachAudioHandler(audioSink);
    }
    if(emulator?.audioFound){
      emulator.disableAudio();
      $('sound').textContent='Activar sonido';
    } else {
      await audioContext.resume();
      emulator?.enableAudio();
      $('sound').textContent='Silenciar sonido';
    }
  }catch(error){console.error(error);$('sound').textContent='Error de audio';}
});
// Controles de teclado para probar latencia en PC sin depender de pantalla táctil.
const keyMap={ArrowRight:4,ArrowLeft:5,ArrowUp:6,ArrowDown:7,KeyZ:0,KeyX:1,Enter:3,ShiftRight:2,KeyA:9,KeyS:8};
window.addEventListener('keydown',e=>{const key=keyMap[e.code];if(key===undefined)return;e.preventDefault();if(!e.repeat)emulator?.keyDown(key)});
window.addEventListener('keyup',e=>{const key=keyMap[e.code];if(key===undefined)return;e.preventDefault();emulator?.keyUp(key)});
boot();

// === Partidas de cada cartucho: IndexedDB, separadas por ID + nombre ROM ===
function openSaveDB(){
  if(!saveStoreReady){
    saveStoreReady=new Promise((resolve,reject)=>{
      const request=indexedDB.open('printmaker-gba-saves',2);
      request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('saves'))db.createObjectStore('saves')};
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    }).catch(e=>{saveStoreReady=null;throw e});
  }
  return saveStoreReady;
}
async function readSaveKey(key){
  const db=await openSaveDB();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('saves','readonly');
    const request=transaction.objectStore('saves').get(key);
    request.onsuccess=()=>resolve(request.result ?? null);
    request.onerror=()=>reject(request.error);
  });
}
async function writeSaveBatch(entries){
  const db=await openSaveDB();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('saves','readwrite');
    const store=transaction.objectStore('saves');
    for(const [name,data] of entries) store.put(data,name);
    transaction.oncomplete=resolve;
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error || Error('Guardado cancelado'));
  });
}
function flushSave(){
  if(emulator && emulator.emulatorStatus === 5) emulator.exportSave();
  if(saveDirty.size===0) return saveFlushPromise;
  const batch=[...saveDirty.entries()]; saveDirty.clear();
  saveFlushPromise=saveFlushPromise.catch(()=>{}).then(()=>writeSaveBatch(batch)).then(()=>{
    if(document.getElementById('saveStatus')) $('saveStatus').textContent='Partida interna sincronizada ✓';
  }).catch(err=>{
    for(const [key,value] of batch) if(!saveDirty.has(key)) saveDirty.set(key,value);
    if(document.getElementById('saveStatus')) $('saveStatus').textContent='No se pudo guardar: '+err.message;
    throw err;
  });
  return saveFlushPromise;
}
// Visibilidad: al cambiar de aplicación, captura RAM de guardado del juego.
document.addEventListener('visibilitychange',()=>{if(document.hidden) flushSave().catch(console.error)});
window.addEventListener('pagehide',()=>{flushSave().catch(console.error)});
const manualSave=document.getElementById('saveNow');
if(manualSave) manualSave.addEventListener('click',async()=>{
  const status=$('saveStatus');
  if(status)status.textContent='Comprobando partida…';
  try {
    if(!emulator || emulator.emulatorStatus!==5)throw Error('El juego todavía no está ejecutándose.');
    const cartName=emulator.getGameName?.();
    await flushSave();
    const data=cartName ? await readSaveKey(activeCart+':'+cartName) : null;
    if(status)status.textContent=data?.length
      ? '✓ Guardado interno respaldado en este dispositivo ('+data.length+' bytes).'
      : 'Aún no hay partida para respaldar. Primero usa Guardar dentro del menú del juego; luego pulsa este botón.';
  }catch(e){if(status)status.textContent='No se pudo guardar: '+e.message;console.error(e)}
});
// Copia de seguridad portable (.json), evita perder avances al borrar datos del sitio.
document.getElementById('backup')?.addEventListener('click',async()=>{
  try{
    await flushSave();
    if(!emulator?.getGameName()) throw Error('Espera a que arranque el juego.');
    const name=emulator.getGameName();
    const data=await readSaveKey(gameId+':'+name);
    const type=await readSaveKey(gameId+':TYPE_'+name);
    if(!data)throw Error('Este juego todavía no ha generado un guardado interno.');
    const payload={format:'PrintMaker-GBA-save-v1',cart:gameId,game:name,save:Array.from(data),type:Array.from(type||[])};
    const link=document.createElement('a');
    link.href=URL.createObjectURL(new Blob([JSON.stringify(payload)],{type:'application/json'}));
    link.download='PMOS_'+gameId+'_partida.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(link.href),15000);
  }catch(err){alert(err.message)}
});
document.getElementById('restoreFile')?.addEventListener('change',async(e)=>{
  try{
    const file=e.target.files[0];if(!file)return;
    const payload=JSON.parse(await file.text());
    if(payload.format!=='PrintMaker-GBA-save-v1'||payload.cart!==gameId||typeof payload.game!=='string'||
       !Array.isArray(payload.save)||!Array.isArray(payload.type)||payload.save.length>131072||payload.type.length>4||
       payload.save.some(n=>!Number.isInteger(n)||n<0||n>255))throw Error('Archivo incompatible con este cartucho.');
    await writeSaveBatch([[gameId+':'+payload.game,new Uint8Array(payload.save)],[gameId+':TYPE_'+payload.game,new Uint8Array(payload.type)]]);
    alert('Partida importada. Recarga la página para usarla.');
  }catch(err){alert('No se pudo importar: '+err.message)}finally{e.target.value=''}
});
// SW solo guarda el sitio y el motor. La BIOS y ROM permanecen fuera de su caché.
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').then(async reg=>{await reg.update();if(currentPath) {const ok=await isAppOfflineReady(); if(ok)offlineStatus('✓ Listo para jugar sin internet (mientras se conserven los datos del navegador)');}}).catch(e=>{console.warn(e);offlineStatus('No se pudo preparar la página offline. Revisa tu conexión.');}));
  navigator.serviceWorker.addEventListener('controllerchange',()=>{document.getElementById('updateNotice')?.removeAttribute('hidden')});
}
