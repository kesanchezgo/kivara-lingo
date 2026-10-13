# Privacidad — Kivara Lingo

Documento interno + base para la ficha de la Chrome Web Store. Describe qué
datos salen del navegador del usuario, adónde van y qué NO se hace con ellos.

## Qué guarda la extensión

| Dato | Dónde | Notas |
|---|---|---|
| Ajustes de la app | `chrome.storage.sync` | Sincronizado con la cuenta Chrome del usuario. Los campos de secreto (API keys) van SIEMPRE en blanco en este blob. |
| API keys del usuario (DeepL, Google, OpenAI, Anthropic, Gemini, ElevenLabs, Unsplash, Pixabay, WordReference, AnkiConnect) | `chrome.storage.local`, cifradas (`enc:v1:`) | Solo las lee este dispositivo. Se borran por completo al pulsar «Quitar» (se escribe una tumba `__cleared__`, no un campo vacío, para que no reaparezcan). |
| Caché de diccionarios, traducciones, enriquecimiento, media | `chrome.storage.local` / IndexedDB | Datos locales derivados de consultas públicas. `vip_cache` se poda. |
| Notas ya creadas (ledger de idempotencia) | IndexedDB local | Evita tarjetas duplicadas. |
| Contadores de telemetría (opt-in) | Local; nunca se envían a servidores ajenos | Ver abajo. |

## Qué sale del navegador

Solo cuando el usuario dispara una función concreta:

1. **Traducción** — el texto de la frase a la API del proveedor elegido
   (DeepL / Google / Lingva / MyMemory / LibreTranslate…). Nunca se envía el
   vídeo completo ni las pulsaciones: solo la frase capturada.
2. **Enriquecimiento** — la PALABRA a consultar a cada fuente habilitada
   (Cambridge, Merriam-Webster, WordReference, Tatoeba, Forvo, Wikimedia…).
3. **IA (opt-in)** — palabra + frase al proveedor elegido (OpenAI /
   Anthropic / Gemini). Apagado por defecto.
4. **Anki** — las tarjetas a `http://127.0.0.1` / `http://localhost`
   (AnkiConnect), solo en el puerto configurado. La URL se comprueba en el
   punto de uso y se rechaza si no apunta a esta máquina.
5. **Imagen / audio** — las URLs que esas mismas respuestas devuelven, para
   incrustarlas en la tarjeta. Todo con `credentials: 'omit'`: las cookies
   del usuario NO viajan (excepción: `wordreference.com`, que requiere poner
   su propia cookie de paso para que responda).
6. **TTS (opt-in), dos rutas distintas:**
   - **Frase y tarjeta completa** — se envía la frase a **OpenAI** o a
     **ElevenLabs**, con la API key que el usuario introduce en Ajustes.
     Si esas fallan, el botón reproduce un error; Google TTS no se
     sustituye aquí (sí es un error audible y explicable, no un silencio).
   - **Pronunciación de la palabra suelta** — cuando diccionarios y
     ElevenLabs no devuelven una grabación humana, la extensión pide a
     `translate.google.com/translate_tts` un MP3 de esa palabra — que es
     la única ruta por la que una frase no viaja a Google.

## Qué NO hace

- Sin servidores propios. No existe backend de Kivara: nada se recopila ni se envía a
  kivara.dev ni a ningún dominio del autor.
- Sin analítica de terceros, sin píxeles, sin reporte de errores remoto.
- Sin `credentials: 'include'` generalizado (ver arriba).
- Sin descargas remotas sin límites donde importa: los medios que entran en
  las tarjetas (imagen, audio de palabra) y los paquetes de diccionario se
  descargan dentro del service worker con
  - destino limitado a HTTPS público (nada de `http`, ni loopback, ni LAN, ni
    `169.254.169.254`);
  - validación de CADA redirección (un `302` hacia localhost se rechaza);
  - tope de tiempo y de bytes, comprobado contra el `Content-Length` y contra
    lo realmente leído.
  Las APIs de traducción, IA y TTS usan HTTP directo con timeout pero sin esa
  puerta de destinos, porque el host lo fija el usuario al elegir proveedor.
- Sin inyección de scripts remotos en páginas de extensión: la CSP de MV3 lo
  prohíbe, y esa es la razón por la que la transcripción on-device se retiró en
  lugar de empaquetarse (issue #30): un glue remoto no puede cargar jamás desde
  una página de la extensión. La CSP declara además `'wasm-unsafe-eval'` para
  que cualquier módulo WASM futuro siga compilable sin relajar el resto.
- **Anki remoto no soportado**: el permiso cubre `127.0.0.1` y `localhost` en
  cualquier puerto; un Anki en otra máquina queda fuera a propósito (ver
  `IMPLEMENTATION.md` §11.0).

## Límites conocidos

- **DNS rebinding**: la puerta de destinos mira el nombre de host escrito en
  la URL. Un dominio propio del atacante que responde con una A record en
  `127.0.0.1` o en la LAN — y cuyo TTL permite cambiarla entre la validación y
  la conexión — no se puede detectar desde un service worker sin resolución
  propia. Lo que sí queda cerrado: URLs privadas literales, redirecciones a
  privado, y toda la ruta de paquetes de diccionario. Mitigarlo del todo
  exigiría un proxy de resolución; no está en el alcance.
- **Lista de hosts**: el manifest declara 18 hosts fijos (streaming + Anki en
  loopback, incluido `http://[::1]:8765/*` y `http://[::1]/*`) y los de
  diccionarios/APIs viven en `optional_host_permissions`
  (78 entradas, una por origen): no se solicitan hasta que el usuario activa la
  fuente o pulsa «Conceder» en Ajustes → Permisos, y se pueden revocar igual.
  Las URL de Anki se restringen además a loopback (ver más abajo).
- **Telemetría**: se contabiliza en local (porcentaje de enriquecimiento que
  requirió red, fallos de proveedores). Nunca se envía fuera del dispositivo.

## Permisos que pide y por qué

| Permiso | Por qué |
|---|---|
| `storage` | Ajustes, claves cifradas y cachés. |
| `cookies` | Solo para poner la cookie de paso de WordReference. |
| `tabCapture` | Capturar el audio de la pestaña para los clips de las tarjetas. |
| `activeTab` | Capturar el fotograma del vídeo al guardar la tarjeta. |
| `offscreen` | Decodificar/recortar audio sin bloquear el service worker. |
| `alarms` | Reintentar tarjetas pendientes. |
| `tts` | Pronunciación cuando la API de audio falla. |
| `declarativeNetRequestWithHostAccess` | Reescribir el origen de AnkiConnect en un puerto propio. La regla solo modifica peticiones iniciadas por la propia extensión (`initiatorDomains`), así que ninguna página puede aprovecharla; y el destino se limita a loopback. |
| `host_permissions` (18) | Streaming (subtítulos) y AnkiConnect en loopback, incluido `[::1]` (IPv6 loopback, `http://[::1]:8765/*` y `http://[::1]/*`). Los diccionarios y las APIs de traducción NO están aquí: son `optional_host_permissions` concedidos a demanda. |

## Contacto

Incidencia legal o de privacidad: abre un issue en
`https://github.com/kesanchezgo/kivara-lingo/issues` con la etiqueta
`privacy`.
