'use strict';
// PrintMaker OS Retro - GBA / IodineGBA. No utiliza EmulatorJS.
const R2 = 'https://pub-e255b156b86149298448979225186068.r2.dev/';
const GAMES = {gba001:'Assets01/12.gba'}; // Añade IDs únicamente cuando sepas su ruta.
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const gameId = params.get('id') || 'gba001';
let emulator, timer, started = false;
let audioContext=null, audioNode=null, audioSink=null, rafId=0, lastFrameTime=0;
let ticks = 0, bootStart = 0;
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
  cancelAnimationFrame(rafId); clearInterval(timer); frames=0; ticks=0; bootStart=performance.now(); started=false; if(emulator)emulator.pause();
  if(audioSink) audioSink.reset();
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
    if(audioSink) emulator.attachAudioHandler(audioSink);
    emulator.attachPlayStatusHandler(()=>{});
    // No activamos funciones de guardado hasta tener implementacion real.
    // No registrar importador de guardados hasta implementarlo: un callback vacío
    // deja el estado del emulador en 1 (esperando guardado) indefinidamente.
    // Sin importador, IodineGBA pasa directamente a estado 5 (listo para ejecutar).
    emulator.attachBIOS(bios);
    emulator.attachROM(rom);
    emulator.play();
    console.info('[PrintMaker Retro] IodineGBA estado tras iniciar:', emulator.emulatorStatus);
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
