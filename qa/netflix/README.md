# Netflix QA — protocolo en vivo (Chrome a mano + CDP 9222)

El arnés que mide las filas del protocolo contra Netflix REAL (Widevine,
cuenta real, subtítulos EN). Nada aquí lanza un navegador: la sesión la abre
el dueño a mano y el arnés se conecta por CDP.

## Abrir Chrome a mano

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%TEMP%\kivara-qa\chrome-qa2" ^
  --no-first-run --no-default-browser-check
```

- El perfil `chrome-qa2` es SOLO de QA: no se toca el Chrome personal del
  dueño y el perfil NO se borra (regla de entorno: solo el dueño lo pide).
- Sin flags de Playwright: fue lo que rompió Widevine la primera vez. El
  arnés solo hace `chromium.connectOverCDP('http://127.0.0.1:9222')`.
- Este perfil re-pregunta el perfil de Netflix en cada carga: los scripts
  siempre re-clican la tile «Primos» después de cada navegación.

## Preparar el build de QA

```bash
pnpm build                          # producción
node qa/netflix/make-dist-open.mjs  # copia dist → %TEMP%\kivara-qa\dist-open
                                    # y abre el ÚNICO shadow root (mode: open)
```

`dist-open` es la copia de QA: mismo bundle, con el root abierto para poder
leer/clicar desde `page.evaluate`. El permiso de cookies, wordreference.ts y
las fuentes de scraping NO se tocan.

Con acceso a fuentes de imágenes (para F2): añade los hosts de imágenes a
`host_permissions` en `dist-open/manifest.json` antes del
`Extensions.loadUnpacked` (el arnés lo deja documentado en su evidencia).

## Scripts

| Script | Qué mide |
|--------|----------|
| `qa-connect.mjs` | instala `dist-open`, lee `chrome://components`, EME ok |
| `bootstrap.mjs` | instala + /browse + play + estado del reproductor |
| `reload-ext.mjs` | reinstala y recarga la página de /watch |
| `open-st.mjs` | búsqueda → título con subtítulos EN → play |
| `recover.mjs` | recupera la sesión tras un error M73xx |
| `peek.mjs` | estado rápido: URL, vídeo, hosts de Kivara |
| `qa-part2-rows3.mjs` | **B1** (subs off + recarga → aviso) y **B6** (al reactivar vuelve la frase), por el MENÚ del reproductor |
| `qa-part2-b6.mjs` | **B6** solo (la fila del menú es «English (CC)») |
| `qa-part2-v2.mjs` | **D4/E2/E3** con `seeked` + inicio exacto y **B3** en tiempo de vídeo |
| `qa-rest.mjs` | el resto de filas: **B4** (dos líneas/cursivas), **B6**, **C2** (pronunciación, clic de confianza), **C7** (portapapeles), **D5** (búsqueda), **E1/E9** (Limpieza visual), **F2** con acceso de imágenes, **H1**, **I1/I2**, **J4**, **AUTO-SETTING**; siembra el mapeo de Anki de QA |

Cada script escribe en `results.json` del directorio de QA
(`KIVARA_QA_DIR`, por defecto `%TEMP%/kivara-qa`)
y deja consola y captura junto a él.

## Reglas del registro

- Cada fila usa EXACTAMENTE el ID y el texto del protocolo.
- Lo que no se probó con su método es «NO PROBADO», nunca «BLOQUEADO».
- PASS solo con evidencia de ESE caso, en la misma fila.
- La tabla por ID se regenera con:
  `node -e "const r=require(process.env.KIVARA_QA_DIR+'/results.json'); ..."`

## Artefactos que NO se versionan

Resultados, consolas, capturas, `dist-open/` y el perfil `chrome-qa2/`
viven fuera del repo (`.gitignore` en este directorio). El perfil y los
artefactos NO se borran: solo cuando el dueño lo pida.
