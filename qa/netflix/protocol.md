# Netflix QA — mapa de filas (estado a la ronda del 16 nov 2026, cierre)

Evidencia completa con su método en `results.json` del directorio de QA.
Regla: PASS solo con evidencia de ESE caso; lo no probado con su método es
«NO PROBADO». Cierre de la ronda: **40 PASS · 0 FAIL · resto NO PROBADO con
su motivo**.

## Serie B — subtítulos

- **B1** PASS — subtítulos off (menú del reproductor, verificado `NONE`) +
  recarga → aviso «No hay subtítulos activos…».
- **B2** PASS — la placa es la frase del bus, sin duplicados.
- **B3** PASS — 10/10 cambios ≤ 31 ms medidos en tiempo de vídeo.
- **B4** PASS — frase de dos líneas («[stammers] Can you do that for me,
  sweetie?») buscada en el TTML (ticks 10 MHz), seek por la API del
  reproductor y la placa mostró EXACTAMENTE esa frase. OJO: el seek a mano
  (`v.currentTime`) MATA la sesión (M7375); solo la API del reproductor.
- **B5** NO PROBADO — su texto exacto no pasó por esta ronda.
- **B6** PASS — al reactivar (menú «English (CC)») la frase vuelve y el aviso
  se retira.
- **B7** PASS — línea traducida vista («Apuesto a que se escapó de
  Pennhurst.»); el conmutador de traducción queda por probar.
- **B8** NO PROBADO — hasta probarlo con su texto exacto.

## Serie C — tarjeta de palabra

- **C1/C3/C3b/C4b/C5/C6b** PASS (rondas anteriores; C4b con la palabra "we").
- **C2** NO PROBADO — botón presente y Libre según el arnés, pero
  `elementFromPoint` en su centro devuelve el contenedor propio de la tarjeta
  (el popover se recolocó) y ni el clic real ni el sintético llegaron al
  handler (`audio.play()=0`, `speechSynthesis.speak=0`) en 4 palabras.
  Prueba a mano: hover → icono de pronunciación → se oye.
- **C7** PASS — botón «Copiar texto» → portapapeles = placa (permisos
  `clipboardReadWrite` por CDP).

## Serie D — transcripción

- **D1/D2/D4** PASS; **E2/E3** PASS (|Δ| = 11 ms con `seeked` + inicio exacto).
- **D5** PASS — buscar "matter" filtra la rail 671 → 4 y todas coinciden. El
  botón de búsqueda lleva `title`, NO `aria-label`; sin abrirlo no hay input.
- **D6/D7** NO PROBADO — D7 solo con clave de IA [H].

## Serie E — barra/reproducción

- **E1** PASS — mitad nativa: los controles de Netflix se DESMONTAN del DOM
  en reposo y vuelven al mover el ratón (`control-nav-back`).
- **E4/E6** PASS; **E9** PASS — «Limpieza visual» activa: mismo comportamiento
  medido.

## Serie F — guardar

- **F1** PASS; **F2** PASS — nota "school" con `<img src="kivara_school_img_…png">`
  tras conceder los hosts de imágenes en el arnés (las fuentes van activas por
  defecto; sin acceso no dan URL y la nota sale sin imagen).
- **F5** NO PROBADO — cerrar Anki [H]; **F7** NO PROBADO (texto exacto);
  resto NO PROBADO.

## Serie G/H/I/J

- **G1/G2** PASS; **G3/G4** NO PROBADO (texto exacto).
- **H1** PASS — salto a ~20 s del final → siguiente episodio, hosts montados,
  0 errores de seek.
- **H2/H4** PASS; **H3** NO PROBADO.
- **I1/I2** PASS — pantalla completa con la tecla f (evento de confianza) y
  salida; hosts y frase visibles en ambos estados.
- **J1** PASS — 30 min con consolas: 15 muestras cada 2 min, vídeo en
  reproducción todo el rato, 0 errores M73xx, 1 línea de consola (0
  sospechosas).
- **J4** PASS — 35 s sin ratón (la tarjeta queda abierta, vídeo pausado por
  pauseOnLookup) → Guardar → nota creada.
- **J2** NO PROBADO.

## Serie AUTO — el ajuste de subtítulos automáticos

- **AUTO** PASS — Netflix en español al montar → Kivara cambia a `en`.
- **AUTO-MANUAL** PASS — cambio manual a español → Kivara no revierte.
- **AUTO-OFF** PASS (e2e) — Kivara OFF → 0 llamadas a `setTimedTextTrack`.
- **AUTO-SETTING** PASS (en vivo) — ajuste OFF + cambio manual a español →
  sigue es-ES tras 12 s.

## Nota de entorno

Netflix corta la sesión con M7375 si se escribe `v.currentTime` a mano o
tras muchos recargas seguidas; con la API del reproductor (`s.seek`) y un
descanso de ~5 min la sesión se recupera. `recover.mjs` hace ese reinicio.
