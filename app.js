'use strict';
// PrintMaker OS Retro - GBA / IodineGBA. No utiliza EmulatorJS.
const R2 = 'https://pub-e255b156b86149298448979225186068.r2.dev/';
const GAMES = {gba001:'Assets01/12.gba'}; // Añade IDs únicamente cuando sepas su ruta.
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const gameId = params.get('id') || 'gba001';
let emulator, timer, started = false;
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
  clearInterval(timer); frames=0; started=false; if(emulator)emulator.pause();
  const path=GAMES[gameId];
  if(!path){message('Cartucho no configurado: '+gameId,true);return;}
  if(typeof window.GameBoyAdvanceEmulator!=='function'){
    message('Falta el motor IodineGBA. Instala sus archivos en vendor/ y revisa LEEME.txt.',true);return;
  }
  message('Descargando juego…');
  try{
    const [romRes,biosRes]=await Promise.all([fetch(R2+path),fetch(R2+'System/gba_bios.bin', {mode:'cors'})]);
    if(!romRes.ok)throw Error('ROM: HTTP '+romRes.status);
    if(!biosRes.ok)throw Error('BIOS en R2: HTTP '+biosRes.status);
    const rom=new Uint8Array(await romRes.arrayBuffer());
    const bios=new Uint8Array(await biosRes.arrayBuffer());
    if(rom.length<1024)throw Error('La ROM está vacía');
    if(bios.length!==16384)throw Error('La BIOS GBA debe tener 16 KiB');
    message('Iniciando emulador…');
    emulator=new GameBoyAdvanceEmulator();
    emulator.settings.offthreadGfxEnabled=false;
    emulator.attachGraphicsFrameHandler(graphicsSink);
    emulator.attachPlayStatusHandler(()=>{});
    emulator.attachSaveExportHandler(()=>{});
    emulator.attachSaveImportHandler(()=>{});
    emulator.attachBIOS(bios);
    emulator.attachROM(rom);
    emulator.play();
    timer=setInterval(()=>{try{emulator.timerCallback(performance.now());}catch(e){clearInterval(timer);console.error(e);message("Error del motor: "+e.message,true)}},16);
    setTimeout(()=>{if(!frames)message('El motor se cargó, pero aún no ha dibujado imagen. Comprueba compatibilidad del motor/BIOS.',true)},12000);
  }catch(error){console.error(error);message('No se pudo iniciar: '+error.message,true)}
}
$('retry').addEventListener('click',boot);
for(const button of document.querySelectorAll('[data-key]')){
  const key=Number(button.dataset.key);
  const release=event=>{event.preventDefault();button.classList.remove('pressed');emulator?.keyUp(key)};
  button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);button.classList.add('pressed');emulator?.keyDown(key)});
  button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
}
$('sound').addEventListener('click',()=>{$('sound').textContent='Audio no disponible en esta prueba';});
boot();
