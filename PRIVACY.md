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
   (AnkiConnect), solo en el puerto configurado.
5. **Imagen / audio** — las URLs que esas mismas respuestas devuelven.
   Todo con `credentials: 'omit'`: las cookies del usuario NO viajan
   (excepción: `wordreference.com`, que requiere poner su propia cookie de
   paso para que responda).

## Qué NO hace

- Sin servidores propios. No existe backend de Kivara: nada se recopila ni
  se envía a kivara.dev ni a ningún dominio del autor.
- Sin analítica de terceros, sin píxeles, sin reporte de errores remoto.
- Sin `credentials: 'include'` generalizado (ver arriba).
- Sin descargas remotas sin límites: todo `fetch` saliente exige HTTPS
  público (nunca http, nunca loopback ni LAN) y va acotado en tiempo y
  tamaño. El permiso de Anki cubre `127.0.0.1` y `localhost` en cualquier
  puerto; **un Anki en otra máquina no está soportado** a propósito (ver
  `IMPLEMENTATION.md` §11.0).
- Sin inyección de scripts remotos en páginas de extensión: la CSP de MV3 lo
  prohíbe y eso mantiene el ASR (Whisper) deshabilitado hasta que se empaquete
  su glue dentro de la extensión.

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
| `declarativeNetRequestWithHostAccess` | Reescribir el origen de AnkiConnect en un puerto propio. |
| `host_permissions` (~96) | Streaming (subtítulos) + cada diccionario/API de traducción. La lista completa está en `manifest.json`; contiene entradas muertas pendientes de poda (`lexico.com`, mirrors de `lingva`). |

## Contacto

Incidencia legal o de privacidad: abre un issue en
`https://github.com/kesanchezgo/kivara-lingo/issues` con la etiqueta
`privacy`.
