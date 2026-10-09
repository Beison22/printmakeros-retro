# PrintMaker OS Retro — prueba NFC GBA/SNES

## Publicar
1. Crea un repositorio público en GitHub llamado `printmaker-retro`.
2. Sube los cuatro archivos `index.html`, `app.js`, `sw.js` y `manifest.webmanifest` a la raíz. **No subas ROMs comerciales.**
3. Settings → Pages → Deploy from a branch → main / (root) → Save.
4. Abre `https://TU-USUARIO.github.io/printmaker-retro/?id=gba001` en tu teléfono con internet.
5. Selecciona una ROM local, pulsa «Guardar juego» y luego «Iniciar juego guardado».
6. Programa un NFC NTAG213 con esa URL usando NFC Tools (registro URL).
7. Para otro juego usa `?id=snes001` o modifica el código para agregar más identificadores.

## Limitaciones importantes
- La ROM se guarda solo en IndexedDB del navegador en el teléfono donde se eligió. **Un cliente nuevo no obtendrá el juego al tocar el NFC**.
- El emulador se descarga desde `cdn.emulatorjs.org`; sin internet puede no cargar. Para offline real hay que incorporar recursos locales de EmulatorJS y probarlos.
- No se garantiza acceso NFC a una URL cuando el teléfono no tiene conexión.
- El guardado de partidas depende del núcleo y del almacenamiento del navegador.
- Se usa EmulatorJS bajo sus licencias respectivas. Comprueba las condiciones antes de uso comercial.
- GitHub Pages no garantiza que se puedan alojar aplicaciones comerciales ni archivos con derechos de terceros.

## Prueba local
Con Python: `python -m http.server 8000` y visita http://localhost:8000. Para NFC se necesita HTTPS público.
