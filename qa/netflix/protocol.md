# Netflix QA — mapa de filas (estado a la ronda del 16 nov 2026)

Evidencia completa con su método en `results.json` del directorio de QA.
Regla: PASS solo con evidencia de ESE caso; lo no probado con su método es
«NO PROBADO».

## Serie B — subtítulos

- **B1** PASS — subtítulos off (menú del reproductor, verificado `NONE`) +
  recarga → aviso «No hay subtítulos activos…».
- **B2** PASS — la placa es la frase del bus, sin duplicados.
- **B3** PASS — 10/10 cambios ≤ 31 ms medidos en tiempo de vídeo.
- **B4** FAIL/NO PROBADO — frase de dos líneas/cursivas: el arnés la busca en
  el TTML (ticks 10 MHz) y la placa no llegó a mostrarla; método en
  `qa-rest-v9.mjs`.
- **B5** NO PROBADO — su texto exacto no pasó por esta ronda.
- **B6** PASS — al reactivar (menú «English (CC)») la frase vuelve y el aviso
  se retira.
- **B7** PASS — línea traducida vista («Apuesto a que se escapó de
  Pennhurst.»); el conmutador de traducción queda por probar.
- **B8** NO PROBADO — hasta probarlo con su texto exacto.

## Serie C — tarjeta de palabra

- **C1/C3/C3b/C5/C6b/C4b** PASS (rondas anteriores).
- **C2** FAIL — botón de pronunciación presente; ni `Audio.play()` ni
  `speechSynthesis.speak` sonaron en 12 s (método: `qa-rest-v9.mjs`).
- **C7** PASS — botón «Copiar texto» → portapapeles = placa (permisos
  `clipboardReadWrite` por CDP).

## Serie D — transcripción

- **D1/D2/D4** PASS; **E2/E3** PASS (|Δ| = 11 ms con `seeked` + inicio exacto).
- **D5** NO PROBADO/FAIL — la búsqueda de la rail no llegó a abrirse con su
  método en las últimas rondas.
- **D6/D7** NO PROBADO — D7 solo con clave de IA [H].

## Serie E — barra/reproducción

- **E1** PASS — controles nativos desmontados del DOM en reposo y de vuelta
  al mover el ratón (la otra mitad del caso).
- **E4/E6** PASS; **E9** PASS — «Limpieza visual» activa: mismo comportamiento
  medido.

## Serie F — guardar

- **F1** PASS; **F2** FAIL — nota sin imagen aunque las fuentes de imágenes
  tienen acceso concedido en el arnés (revisar salud de fuentes).
- **F5** NO PROBADO — cerrar Anki [H]; **F7** NO PROBADO (texto exacto);
  resto NO PROBADO.

## Serie G/H/I/J

- **G1/G2** PASS; **G3/G4** NO PROBADO (texto exacto).
- **H1** PASS — salto a ~20 s del final → siguiente episodio, hosts montados.
- **H2/H4** PASS; **H3** NO PROBADO.
- **I1/I2** PASS — pantalla completa con la tecla f (evento de confianza) y
  salida; hosts y frase visibles.
- **J4** PASS — 35 s sin ratón → Guardar → nota creada.
- **J1** NO PROBADO — sesión de 30 min pendiente.
- **AUTO-SETTING** PASS — ajuste OFF + cambio manual a español → sigue es-ES
  tras 12 s (el vigilante no toca el reproductor).
