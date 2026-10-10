// PrintMaker OS Retro · App shell completo offline. BIOS y ROM en IndexedDB de la página.
const VERSION='printmaker-gba-v11-1';
const PRECACHE=["./", "./index.html", "./app.js", "./style.css", "./games.json", "./manifest.webmanifest", "./icon.svg", "./IodineGBA/includes/TypedArrayShim.js", "./IodineGBA/core/Cartridge.js", "./IodineGBA/core/DMA.js", "./IodineGBA/core/Emulator.js", "./IodineGBA/core/Graphics.js", "./IodineGBA/core/RunLoop.js", "./IodineGBA/core/Memory.js", "./IodineGBA/core/IRQ.js", "./IodineGBA/core/JoyPad.js", "./IodineGBA/core/Serial.js", "./IodineGBA/core/Sound.js", "./IodineGBA/core/Timer.js", "./IodineGBA/core/Wait.js", "./IodineGBA/core/CPU.js", "./IodineGBA/core/Saves.js", "./IodineGBA/core/sound/FIFO.js", "./IodineGBA/core/sound/Channel1.js", "./IodineGBA/core/sound/Channel2.js", "./IodineGBA/core/sound/Channel3.js", "./IodineGBA/core/sound/Channel4.js", "./IodineGBA/core/CPU/ARM.js", "./IodineGBA/core/CPU/THUMB.js", "./IodineGBA/core/CPU/CPSR.js", "./IodineGBA/core/graphics/Renderer.js", "./IodineGBA/core/graphics/RendererShim.js", "./IodineGBA/core/graphics/RendererProxy.js", "./IodineGBA/core/graphics/BGTEXT.js", "./IodineGBA/core/graphics/BG2FrameBuffer.js", "./IodineGBA/core/graphics/BGMatrix.js", "./IodineGBA/core/graphics/AffineBG.js", "./IodineGBA/core/graphics/ColorEffects.js", "./IodineGBA/core/graphics/Mosaic.js", "./IodineGBA/core/graphics/OBJ.js", "./IodineGBA/core/graphics/OBJWindow.js", "./IodineGBA/core/graphics/Window.js", "./IodineGBA/core/graphics/Compositor.js", "./IodineGBA/core/memory/DMA0.js", "./IodineGBA/core/memory/DMA1.js", "./IodineGBA/core/memory/DMA2.js", "./IodineGBA/core/memory/DMA3.js", "./IodineGBA/core/cartridge/SaveDeterminer.js", "./IodineGBA/core/cartridge/SRAM.js", "./IodineGBA/core/cartridge/FLASH.js", "./IodineGBA/core/cartridge/EEPROM.js", "./IodineGBA/core/cartridge/GPIO.js"];
const APP_ROOT=new URL('./',self.registration.scope).href;
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(VERSION);
    // Si falta cualquier dependencia, NO activar una versión offline incompleta.
    await cache.addAll(PRECACHE);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for(const key of await caches.keys()){
      if(key.startsWith('printmaker-gba-')&&key!==VERSION)await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
  const url=new URL(req.url);
  const normalized=url.origin+url.pathname; // El NFC tiene ?id=, sin crear caché por cada cartucho.
  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const response=await fetch(req);
        if(response.ok)return response;
      }catch(_e){}
      const cache=await caches.open(VERSION);
      return await cache.match('./index.html')||Response.error();
    })());return;
  }
  if(url.pathname.endsWith('/games.json')||url.pathname.endsWith('/app.js')||url.pathname.endsWith('/style.css')){
    event.respondWith((async()=>{
      const cache=await caches.open(VERSION);
      try{
        const result=await fetch(req,{cache:'no-store'});
        if(result.ok)await cache.put(normalized,result.clone());
        return result;
      }catch(e){return await cache.match(normalized)||Response.error();}
    })());return;
  }
  event.respondWith((async()=>{
    const cache=await caches.open(VERSION);
    return await cache.match(normalized)||await fetch(req);
  })());
});
