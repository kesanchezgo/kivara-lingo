# Enriquecimiento A/B — fase 2 — 2026-08-13

## Alcance

Esta fase comenzó con una revisión completa de los 22 archivos Markdown del
repositorio. El objetivo fue reconstruir el historial antes de seguir
implementando y evitar que planes de junio prevalecieran sobre evidencia MV3 y
auditorías contextuales de agosto.

Principios conservados:

- Standard usa fuentes públicas/gratuitas, APIs abiertas y datos locales;
- VIP usa fuentes editoriales de alto nivel mediante scraping cuando aporta una
  mejora real;
- ningún proveedor bloquea a los demás;
- calidad por `proveedor + campo`, no por proveedor global;
- C sólo puede corroborar y D no llega a la tarjeta;
- un campo vacío es válido cuando no existe evidencia suficiente;
- frecuencia conserva su escala original;
- las relaciones se seleccionan por grupo semántico, no por lista plana global.

## Jerarquía documental utilizada

Cuando existen contradicciones se usa este orden:

1. código y pruebas vigentes;
2. auditorías contextuales/MV3 del 12–13 de agosto de 2026;
3. `docs/ENRICHMENT.md`;
4. informes de cobertura del 11 de agosto;
5. planes y auditorías históricas de junio;
6. `IMPLEMENTATION.md` como especificación histórica, no como fuente única de
   verdad del runtime actual.

Los porcentajes antiguos de cobertura medían presencia de campos, no exactitud
semántica. No se usan como evidencia de calidad A/B.

## Cambios implementados

### 1. Contrato de relaciones por sentido

`SourcePartial` admite ahora `relationGroups`, con:

- guideword;
- definición opcional;
- ejemplo representativo;
- POS opcional;
- sinónimos;
- antónimos.

Las listas planas siguen disponibles por compatibilidad, pero las fuentes nuevas
deben preferir grupos semánticos.

### 2. Cambridge Thesaurus en VIP

Cambridge realiza una segunda consulta paralela a:

```text
https://dictionary.cambridge.org/thesaurus/<token>
```

El parser:

- verifica coincidencia exacta del headword;
- conserva cada `dsense` por separado;
- extrae `dsense_gw`, ejemplo `deg`, `synonym` y `opposite`;
- deduplica grupos;
- limita candidatos por grupo;
- no aplana todos los sentidos;
- falla silenciosamente sin perder la respuesta de Cambridge Dictionary.

La comprobación live de `run` produjo 6+ grupos utilizables. El límite se amplió
a 16 para no truncar sentidos posteriores como gestión/operación.

### 3. Selección contextual de grupos

El orquestador selecciona como máximo un grupo por proveedor usando:

- la oración;
- la definición principal ya rankeada;
- guideword;
- definición del grupo;
- ejemplo del grupo;
- normalización morfológica básica.

Si existe contexto pero el grupo no comparte ninguna señal semántica, se
omite. Esto impide usar el thesaurus de movimiento de Longman para una oración
como `She runs the company from home.`

### 4. Longman ampliado

Longman aporta ahora:

- bandas habladas `S1–S3`;
- bandas escritas `W1–W3`;
- grupos de `ThesBox`;
- colocaciones limitadas al contenido de `ColloBox`;
- fallback al selector antiguo `COLLO` cuando no existe `ColloBox`.

Las bandas se guardan como `FrequencyEvidence`:

```text
longman-spoken: S1
longman-written: W1
corpus: LDOCE
```

No se convierten a `frequencyRank`, porque `S1` significa “top 1000 en lengua
hablada”, no una posición exacta.

La verificación live de `run` confirmó `S1/W1`, el bloque THESAURUS y
colocaciones estructuradas.

### 5. Frecuencia visible y mapeable a Anki

La evidencia de frecuencia:

- se conserva en `VipEnrichment.frequencyEvidence` con atribución;
- se muestra en el popover como `Hablado: S1` / `Escrito: W1`;
- se puede elegir como origen `frequency` en el mapeo de campos Anki;
- se autodetecta para campos llamados `Frequency`, `Frecuencia`, `Freq`,
  `Word rank` o `Rango`.

VIP tiene ahora frecuencia pedagógica parcial. Standard sigue sin una fuente de
frecuencia aprobada.

### 6. Colocaciones A/B

Una colocación sólo puede mostrarse si:

- procede directamente de Longman, Oxford Learner's, Cambridge o el bundle
  curado; o
- coincide en dos fuentes independientes.

Consecuencias:

- Datamuse aislado no publica;
- Ozdic aislado no publica;
- PONS aislado no publica;
- una coincidencia PONS + Datamuse puede actuar como corroboración;
- colocaciones editoriales de Longman siguen visibles;
- placeholders simples como `(your)` se limpian sin aceptar glosas entre
  paréntesis de forma general.

### 7. Cierre de D en relaciones y definiciones

- Moby no se muestra solo.
- Moby tampoco cuenta como la segunda evidencia fuerte que habilita una
  relación C.
- The Idioms queda excluido de definiciones visibles.
- The Idioms continúa excluido de etimología.

Los módulos pueden conservarse temporalmente como señales internas, pero no
llenan campos de tarjeta.

### 8. Imágenes Standard con múltiples candidatos

Openverse devuelve hasta cinco candidatos con:

- URL;
- título;
- tags;
- página de procedencia;
- dimensiones.

Wikimedia Commons resuelve hasta cuatro archivos y solicita:

- URL/thumbnail;
- dimensiones;
- `ImageDescription`;
- `Categories`;
- `LicenseShortName`;
- página de descripción.

El ranking central sólo permite ganar directamente a:

- Wikimedia Commons;
- Openverse;
- Unsplash;
- Pixabay.

Bing y DuckDuckGo ya no pueden producir la imagen visible directamente. Siguen
como módulos/señales hasta decidir si se retiran.

La comprobación live produjo:

- Openverse: 5 candidatos para `apple`;
- Wikimedia Commons: 4 candidatos para `apple`.

### 9. Britannica pasa a VIP

Britannica fue retirada de `STANDARD_SOURCE_KEYS` porque:

- es scraping editorial;
- tiene disponibilidad intermitente por Cloudflare;
- conceptualmente pertenece al valor adicional de VIP.

La preferencia `britannicaDictionary` se conserva para mantener compatibilidad.
La UI la muestra ahora dentro de diccionarios VIP y existe una prueba que
confirma que no se ejecuta cuando el master VIP está apagado.

## Estado actualizado por tier

### Standard

Fuentes principales visibles A/B:

- Bundled/Yomitan;
- Free Dictionary;
- Wiktionary REST/HTML/API y WiktAPI;
- Tatoeba;
- Lingua Libre;
- Google TTS sólo fallback;
- Etymonline;
- Openverse;
- Wikimedia Commons;
- YouGlish.

Señales C internas o corroboradas:

- Datamuse;
- WordHippo;
- Moby como señal débil que no habilita resultados;
- Bing Images;
- DuckDuckGo Images;
- The Idioms sin autoridad visible.

Gaps Standard:

1. frecuencia pública con licencia confirmada;
2. WSD general;
3. cobertura humana de audio/IPA para MWE;
4. imageability general y `depicts (P180)`.

Siguiente proveedor Standard aprobado e integrado: **Open English WordNet**
(véase «Fase 3» más abajo).

### VIP

Mejoras editoriales actuales:

- Britannica;
- Cambridge Dictionary + Cambridge Thesaurus;
- Oxford Learner's;
- Longman Dictionary + THESAURUS/COLLOCATIONS + frecuencia S/W;
- Dictionary.com;
- Merriam-Webster Dictionary;
- Ozdic;
- PONS, bab.la, dict.cc;
- Reverso, Linguee/PROMT, WordReference, SpanishDict;
- Forvo;
- Unsplash/Pixabay opcionales.

VIP mejora de forma clara:

- definición;
- traducción;
- ejemplos;
- IPA/audio;
- sinónimos/antónimos por grupos Cambridge;
- colocaciones editoriales;
- frecuencia pedagógica.

Gap VIP principal:

1. segunda fuente editorial de thesaurus para corroborar Cambridge;
2. WSD/POS general;
3. auditoría contextual amplia de Cambridge/Longman nuevos;
4. etimología con atribución/confianza visible;
5. imágenes específicas por sentido.

Siguiente candidato VIP: **Merriam-Webster Thesaurus**. La ruta está verificada,
pero el entorno externo recibió Cloudflare 403. Antes de implementar selectores
se debe capturar un fixture real desde MV3; no se inventó un parser sin evidencia.

## Archivos principales modificados

- `src/background/enrichment/types.ts`
- `src/background/enrichment/orchestrator.ts`
- `src/background/enrichment/sources/cambridge.ts`
- `src/background/enrichment/sources/longman.ts`
- `src/background/enrichment/sources/openverse.ts`
- `src/background/enrichment/sources/wikimedia-commons.ts`
- `src/shared/types.ts`
- `src/shared/store.ts`
- `src/shared/anki-field-detect.ts`
- `src/background/capture-orchestrator.ts`
- `src/content/ui/WordPopover.tsx`
- `src/app/components/tabs/CardsTab.tsx`
- `src/app/components/tabs/VipSection.tsx`

Pruebas nuevas/actualizadas:

- `tests/unit/cambridge-thesaurus.test.ts`
- `tests/unit/longman-quality.test.ts`
- `tests/unit/image-source-candidates.test.ts`
- `tests/unit/enrichment-orchestrator.test.ts`
- `tests/unit/anki-field-detect.test.ts`

## Validación

### Pruebas focalizadas

```text
5 archivos
49 pruebas aprobadas
```

### Suite completa

```text
23 archivos aprobados
219 pruebas aprobadas
```

### Build

```text
1798 módulos transformados
build correcto
```

Permanece una advertencia previa de Vite: `ai-providers.ts` se importa de forma
estática y dinámica, por lo que no se separa en otro chunk. No fue causada por
esta fase.

## Próxima fase

1. ejecutar el corpus completo Standard/VIP con los parsers nuevos
   (OEWN + M-W Thesaurus incluidos);
2. almacenar ganador, runner-ups y motivos de descarte para QA;
3. añadir WSD/POS general;
4. investigar una fuente Standard de frecuencia sólo cuando su licencia sea
   inequívoca.

## Fase 3: Open English WordNet integrado (2026-08-13)

### Qué se integró

**Open English WordNet 2025** quedó integrado como fuente `wordnet` del tier
Standard — el primer proveedor que ataca directamente el gap de relaciones
por synset:

- dataset local derivado del JSON oficial 2025 (CC BY 4.0 + WordNet License);
- no hay API remota ni token: los shards se empaquetan con la extensión;
- 128 009 lemas y 185 129 sentidos en `src/assets/wordnet/` (27 MB, un shard
  por inicial, 0.6–3.3 MB cada uno);
- carga perezosa por inicial vía `import.meta.glob`: una consulta de `run`
  sólo lee `r.json`, nunca el corpus completo;
- el service worker sigue en 285 kB (gzip 65 kB) porque cada inicial es un
  chunk dinámico independiente.

### Campos que publica

- `relationGroups` — cada synset con sinónimos o antónimos se publica como
  grupo ligado a acepción (glosa + ejemplo + POS implícito), máximo 12;
- `definitions` — glosas en orden de frecuencia WordNet (hasta 20),
  fusionando la entrada literal y la del lema base;
- `examples` — ejemplos de uso del synset (hasta 4), verificando que
  pertenezcan al lema resuelto.

La publicación es por grupo de sentido, NO listas planas de
sinónimos/antónimos: el selector contextual del merger
(`pickSenseRelationGroups`) elige el grupo compatible con la oración.
Eso hace que `She runs the company` publique manage/operate y no
sprint/jog sin reglas específicas de corpus.

### Comportamiento lexicográfico clave

- Inflección — el hover se resuelve por lematizador (mwe-lemma para MWE):
  `running` publica tanto el adjetivo propio de OEWN como los sentidos
  verbales de `run`; `pieces of cake` resuelve a `piece of cake`;
- fusión literal + lema base — deduplicada por synset ID, con la forma de
  cita primero y la entrada derivada propia después (`lit` conserva su
  inventario adjetival sin enmascarar `light`);
- MWE — `piece of cake` resuelve su synset idiomático (cinch, breeze,
  picnic, snap) sin promover sinónimos a colocaciones;
- `break up` conserva el sentido relacional (separate, part, split) junto
  a los literales, disponible para el selector por oración;
- antónimos directos del lexicon — p.ej. `give` → `take` llega como grupo
  con antónimo, no como lista plana;
- `wordnet` está en `DISPLAYABLE_RELATED_TERM_SOURCES`, así que sus
  relaciones pueden publicarse solas, sin corroboración externa.

### Licencias y atribución

- textos completos de CC BY 4.0 y WordNet License incluidos en
  `src/assets/wordnet/LICENSE.md` y `WNDB_License.txt`;
- `ATTRIBUTIONS.md` documenta la derivación de Princeton WordNet 3.1 y
  las modificaciones (índice por lema + reducción a synset/POS/glosa/
  ejemplos/relaciones);
- sin sugerencia de endorsement de Princeton ni del equipo OEWN.

### Script de regeneración

`scripts/build-oewn-index.ts` descarga el ZIP oficial, lo reduce a shards
por lema y escribe `metadata.json` con versión, fuente y transformaciones.
Uso: `npx tsx scripts/build-oewn-index.ts [ruta-al-zip]`.

### Validación de la fase 3

```text
Nueva suite: tests/unit/wordnet-source.test.ts (9 pruebas)
Orquestador: 23 pruebas (nuevo test de tier Standard)
Suite completa: 24 archivos, 229 pruebas aprobadas
Build: correcto, 28 chunks de shard a–z + other
```

Casos verificados contra datos reales de OEWN 2025:

- `run` → primer grupo con relaciones = sentido 1 sustantivo (score),
  orden de frecuencia preservado;
- `running` → definición de movimiento del verbo base alcanzable;
- `break up` → grupo relacional con `separate` presente;
- `piece of cake` → synset idiomático exacto;
- `give` → antónimo directo `take`;
- `know` → ejemplos reales del synset publicados;
- español (`casa`) → `{}` inmediato (sólo inglés);
- token desconocido → `{}`.

### Estado del gap de relaciones Standard

Antes de esta fase, las relaciones Standard dependían de corroboración
C+1 porque ninguna fuente abierta publicaba grupos por sentido. OEWN
resuelve eso por diseño: sus grupos son synsets completos con glosa y
ejemplo, por lo que quedan exentos de corroboración en la capa visible
(mismo criterio que Cambridge/Longman) y sirven además como ancla
independiente para corroborar relaciones de Datamuse/WordHippo/Moby.

## Fase 4: Merriam-Webster Thesaurus integrado (2026-08-30)

### Captura del fixture real

El requisito era no inventar selectores. Se capturaron cuatro fixtures
reales desde el runtime MV3 (origen de la extensión con sus host
permissions, donde las auditorías previas confirmaron que M-W responde
200 — el 403 de Node era falso negativo):

- `run` — 21 sentidos, 1126581 bytes;
- `support` — 10 sentidos, 954923 bytes;
- `lit` — 7 sentidos, 976862 bytes;
- `piece of cake` — 1 sentido, 695400 bytes.

Script: `scripts/capture-mw-thesaurus.mjs`. Fixtures en
`docs/reports/runtime/fixtures/mw-thesaurus/`.

### Esquema verificado contra el HTML real

- cada sentido vive en su propio `thesaurus-entry-N-M`;
- el número `N` es el índice de entrada y `M` el índice de sentido —
  NO un ordinal global de sentido (hallazgo clave: la primera
  implementación lo confundió y sólo publicaba 2 de 21 grupos de
  `run`);
- cada entrada contiene exactamente un bloque `sense` con:
  - `as-in-word` — guía "as in to manage" que desambigua sin reglas;
  - `dt` — glosa del sentido;
  - `d-block thread-anchor-content` — ejemplo;
  - `sim-list-scored-content-N-M` — sinónimos del sentido;
  - `opp-list-scored-content-N-M` — antónimos del sentido (opcional);
- `span.syl` — una palabra de relación por ítem.

### Fuente `merriamWebsterThesaurus` (VIP)

`src/background/enrichment/sources/mw-thesaurus.ts`:

- itera contenedores de entrada, cada uno con su propio par sim/opp
  (imposible la contaminación entre sentidos);
- publica `relationGroups` con guide + definition + example +
  synonyms + antonyms por sentido (máx. 16 grupos, 12 relaciones por
  grupo);
- publica hasta 2 ejemplos por sentido;
- el corte del contenedor respeta que el ancla "Example Sentences"
  puede aparecer ANTES del contenedor en el documento;
- sólo inglés; devuelve `{}` en caso contrario.

### Integración

- tier VIP (requiere el interruptor maestro, como Merriam-Webster);
- flag `merriamWebsterThesaurus` en `VipSettings` (default `true`);
- incluido en `RELATED_TERM_SOURCE_PRIORITY` y en
  `DISPLAYABLE_RELATED_TERM_SOURCES` — sus grupos pueden publicarse
  solos, corroborando a Cambridge como segunda autoridad editorial;
- toggle en la UI VIP;
- hosts ya cubiertos por `manifest.json` (`www.merriam-webster.com`),
  sin cambios de permisos;
- registro en el arnés MV3.

### Correcciones derivadas de la verificación live

La auditoría MV3 de `merriamWebsterThesaurus` con la oración
"He runs a small company downtown." expuso un fallo previo de la fase 3:

**`wordnet` fallaba en el service worker con `window is not defined`.**

Causa raíz: `import.meta.glob` con importación dinámica genera código
que pasa por `__vitePreload`, helper de Vite que toca `window` y
`document`, inexistentes en el SW MV3. Los shards se cargaban en los
tests (Vitest resuelve el import nativo) pero nunca en producción.

Solución: cargar los shards con `fetch` de URLs resueltas como strings
en build time (`import.meta.glob` con `query: '?url'` y `eager: true`,
que produce constantes string sin `__vitePreload`). Los tests stubbean
`fetch` para servir los JSON desde disco.

Verificación live posterior: `wordnet` devuelve `ok` con
`relationGroups, definitions, examples` desde el SW real, y el selector
contextual elige el grupo correcto para "She ran home." (definición de
movimiento, sinónimo `running`, ejemplo del propio synset).

Nota de comportamiento verificado: para "He runs a small company
downtown." ninguna fuente publicó sinónimos de M-W porque el gate
contextual detectó cero solapamiento con cada sentido — el contenido
visible (fly/zip/race/trot) provenía de la red de corroboración
existente, no de un grupo sin contexto. El gate funciona como debe:
prefiere ausencia antes que publicar el sentido equivocado.

### Validación de la fase 4

```text
Nueva suite: tests/unit/mw-thesaurus.test.ts (9 pruebas contra fixtures reales)
Suite completa: 25 archivos, 238 pruebas aprobadas
Build: service worker 283 KB, sin __vitePreload en shards
MV3 live: merriamWebsterThesaurus → ok (relationGroups, examples), HTTP 200
MV3 live: wordnet → ok (relationGroups, definitions, examples)
```

Casos verificados contra los fixtures:

- `run` → 16 grupos con el orden editorial preservado; el sentido
  "to operate" presente y seleccionable;
- `support` → antónimos directos de dos acepciones distintas
  (`interference` del sentido estructural, `oppose` del sentido
  de defender);
- `lit` → el clúster slang (drunk/fried, antónimo sober) separado del
  clúster de iluminación (bright/alight, antónimo dark);
- `piece of cake` → grupo idiomático con antónimos directos (pain);
- página sin marcado de tesauro → `{}`;
- respuesta no-200 → `{}`.

## Fase 5: WSD por sentido en ambos tiers (2026-08-30)

Caso de prueba: `run` en `She runs the company from home.` debía publicar
definición/traducción/sinónimos del sentido `manage`, no del sense-default
`correr`. La definición ya ganaba (regla dominio-vs-sentido en
`definitionContextScore`), pero la traducción y los ejemplos permanecían
anclados al bundle local.

### Hallazgos de la auditoría MV3 aislada

El script de auditoría se extendió a las fuentes de traducción (ahora
incluye cambridge, pons, babla, dictCc, spanishDict, wiktApi,
freeDictionary). Para `run` + oración de gestión:

- dictCc publica `dirigir`;
- wordReference publica `manejar`;
- el bundle sólo tiene `correr`.

Los candidatos de gestión SÍ llegaban al pool — el fallo era el merge.

### Causas raíz corregidas

1. `resolve-word.ts` daba precedencia absoluta a la fase local sobre la
   cadena de enriquecimiento en `translation`, `bilingual` y `examples`.
   La cadena rankea contextualmente contra la oración (y su pool incluye
   la glosa del bundle con trust bonus), así que ahora la cadena gana
   cuando produjo un valor; el pack Yomitan (autoridad elegida por el
   usuario) mantiene la máxima precedencia; sin señal contextual el
   bundle sigue ganando DENTRO del propio ranking de la cadena. Control
   verificado: `She ran home.` sigue publicando `correr` primero.
2. `MAX_SENSE_GROUPS` de wordnet era 12; el synset manage (`02448714-v`)
   es el grupo nº 13 con relaciones en el entry de `run` (57 sentidos,
   37 con relaciones) y caía fuera del corte. Subido a 20. Los grupos
   son locales (sin red), el coste es sólo el tamaño del array.
3. Wiktionary lista glosas de otros idiomas en la columna ES con
   `code: "es"` (verificado live: `apple` → `mela` [it], `poma` [oc/ca],
   `mazana` [an]). `cleanTranslation` de wiktapi ahora las bloquea,
   igual que `diñar`/`cognocer`.
4. Entradas curadas del bundle: `apple` no tenía entrada (la única fuente
   ES en Standard era wiktApi con las filas mal etiquetadas); añadida a
   `en-extensions.json` con `manzana`. Corregido también
   `give → presentará` (futuro de indicativo como glosa base) por `dar`
   en `en.json`.

### Verificación (MV3 real, perfil fresco)

- Standard `company`: traducción `dirigir`, definición
  `direct or control; projects, businesses, etc.`, sinónimo `operate`
  (único sinónimo del synset manage en OEWN).
- VIP `company`: traducción `dirigir`, mismos 12 sinónimos de gestión de
  M-W Thesaurus (work/drive/operate/use/steer/wield...).
- Corpus completo 15 tokens × 2 tiers: 0 errores, 30/30 traducciones
  correctas, sin regresiones en `piece of cake`, `lit`, `break up`,
  `anything`, `anybody`.
- Suite: 25 archivos, 239 pruebas (nuevas: regresión del ranking
  contextual de `dirigir`; guard del synset manage en el test de cap
  de wordnet).

## Fase 6: Frecuencia Standard e imágenes con depicts (2026-08-30)

Dos gaps del backlog cerrados con verificación MV3 real.

### Frecuencia Standard — `books-band` vía Datamuse

Ninguna fuente pública alimentaba `frequencyEvidence` en Standard. El
gap se cierra sin fuentes nuevas: Datamuse ya integrado publica la
frecuencia del headword con `md=f` (metadato gratuito en una consulta
`sp=` dedicada).

Hallazgo crítico de la verificación live: el tag `f:` es LINEAL
(ocurrencias por millón de palabras: `run` → 96.4, `know` → 383.3,
`apple` → 9.85, `tensor` → 2.23), NO log10. La banda se mapea al
estilo Longman: 1 = ubicuo (≥200/M), 2 = muy común (≥30/M),
3 = común (≥3/M), 4 = poco común (<3/M). Frecuencia 0 (`piece of
cake` en el corpus de Datamuse) → sin banda: ausencia antes que banda
equivocada.

La tarjeta muestra `Libros N` en Standard y `Libros N · Hablado S…`
en VIP (ambas escalas preservadas).

### Imágenes — anclaje por concepto con `depicts` (P180)

`wikimediaCommons` pasó de búsqueda de texto plano a dos etapas:

1. `wbsearchentities` (Wikidata) resuelve el token a un ítem con
   label exacto + descripción de concepto real; se rechazan las
   descripciones de desambiguación (canciones, películas, empresas,
   apellidos, `vocal track`, `unit of time`…). `apple` ancla en Q89
   (fruta) y NO en Q312 (Apple Inc.) aunque la empresa rankea primera.
2. Commons busca con `haswbstatement:P180=<qid>`: cada resultado
   *depicta* el concepto — la señal estructurada de relevancia que la
   búsqueda de texto no tenía (logos, noticias y SEO nunca llevan el
   P180 de la fruta).

Sin concepto seguro → la fuente devuelve `{}`: `run`, `know`, `lit`,
`week`, `piece of cake` quedan sin imagen de Wikimedia por diseño
(ausencia antes que imagen equivocada). El host
`www.wikidata.org` se añadió al manifest.

### Verificación del flujo card (imágenes)

El popover excluye imágenes por diseño (fuentes lentas; se buscan al
guardar). Para auditar el camino real se añadió `purpose` al puerto
`kvl-resolve-word` (propagado a `runEnrichment`) y `--purpose card`
al corpus script; el orquestador emite `[kivara:enrichment:image]`
con la imagen seleccionada, su fuente y el número de candidatos.

Corpus card (5 tokens × 2 tiers, MV3 real, perfil fresco):

- `apple` → Wikimedia, depicts Q89 (ambos tiers);
- `tensor` → Wikimedia, concepto matemático (ambos tiers);
- `run` → Openverse (foto real de running — válida para el verbo de
  movimiento; `pickImageCandidate` sigue rankeando por metadatos);
- `week` → sin imagen (gate de concepto correcto);
- 0 errores, 245 tests verdes.

### Pruebas nuevas

- `tests/unit/datamuse-frequency.test.ts` (5): bandas por
  per-millón lineal, banda 1 para `know`, banda 4 para `tensor`,
  ausencia con frecuencia 0, relaciones intactas si la consulta de
  frecuencia falla.
- `tests/unit/image-source-candidates.test.ts` (+1, reescritas las
  de Commons): anclaje de concepto con rechazo de Apple Inc.,
  consulta P180 verificada, ausencia total con ruido de
  desambiguación sin llamada a Commons.

## Fase 7: Provenance interna por campo (2026-08-30)

Último gap del backlog de calidad: la tarjeta publicaba valores sin
exponer POR QUÉ cada valor ganó. Ahora cada campo con ranking
contextual lleva un registro de provenance.

### Contrato

`VipEnrichment.provenance?: FieldProvenance[]` — un registro por campo
publicado (definition, translation, synonyms, collocations, examples,
phonetic, etymology, image) con:

- `winner` — el valor elegido (truncado);
- `source` — la fuente que lo autoró (o la suma `a+b` cuando la glosa
  ganadora llegó de varias fuentes);
- `score` — el score crudo del ranking (escala por campo: sólo
  comparable dentro del mismo campo);
- `reasons` — códigos `ok-*` / `penalty-*` de cada señal del ranking
  que aplicó al ganador;
- `runnerUps` — los siguientes mejores con su fuente;
- `candidates` — cuántos candidatos crudos entraron al ranking.

No se renderiza en el popover: existe para que auditorías, tests y
debugging asserten el porqué sin re-derivarlo.

### Implementación

- `definitionContextScore` y `contextTranslationScore` se refactoraron
  a un patrón *trace* único (`definitionContextTrace` /
  `contextTranslationTrace`) que devuelve score + códigos de las
  MISMAS condiciones — cero duplicación de reglas, cero cambio de
  comportamiento (ranking binario antes/después idéntico).
- `mergeFields` construye los registros con los datos que los pickers
  ya produjeron — sin segunda pasada de ranking.
- Todo código espeja su regla: `ok-manage-sense`,
  `penalty-motion-vs-domain`, `ok-run-manage`,
  `penalty-piece-of-cake-literal`, etc.

### Verificación

MV3 real, VIP `run` + "She runs the company from home." — 7 registros:

```text
definition  wordnet               score -16  ok-manage-sense, ok-domain-gloss
translation wiktApi+dictCc        score -12  ok-run-manage
synonyms    merriamWebsterThesaurus  —      ok-sense-group-endorsed
collocations pons                     —      ok-editorial-or-corroborated
examples    pons                       —      ok-contextual-alignment
phonetic    cambridge                  —      ok-source-priority
etymology   etymonline                 —      ok-source-priority
```

Suite: 248 tests verdes (3 nuevos de contrato: campos publicados con
registro, códigos del caso manage documentado, score crudo sin
normalizar). Corpus popover sin regresiones.

El corpus script ahora captura `provenance` en el reporte JSON para
ambos tiers.

## Fase 8: Colocaciones por sentido (2026-08-30)

Último campo débil del audit original. El corpus expuso el problema con
números: `give` publicaba "freely give, clearly give, directly give,
currently give" en ambos tiers, y `run` en el sentido manage publicaba
"to run aground" (acepción náutica).

### Investigación de fuentes nuevas

Se evaluaron los dos candidatos de calidad para colocaciones:

- **Just-The-Word** (BNC, U. Leeds): sitio caído (502 persistente en
  3 intentos espaciados). Descartado.
- **Netspeak** (n-grams web, TU Graz): sin API scrapeable estable
  (SPA sin endpoint público documentado, 404 en todos los formatos
  probados). Descartado.

Conclusión: no existe proveedor externo de calidad disponible; la
solución debía salir de las fuentes ya integradas.

### Causas raíz encontradas (tres capas)

1. **El origen del ruido `-ly` no era Datamuse** — era el Academic
   Collocation List bundled (Ackermann & Chen 2013): `give` llevaba
   "clearly give" etc. como datos curados del dataset local. El overlay
   del bundle en `dictionary.ts` ahora filtra bigramas adverbio+verbo
   (`isLearnerCollocation`), la misma firma de ruido que
   `normalizeCollocation`.
2. **ozdic SÍ es sense-aware y el parser lo ignoraba**: cada bloque de
   colocación trae un gloss por acepción ("(noun.) of success/failure")
   y el parser volcaba los 6 bloques planos. Ahora cada bloque se
   publica como `relationGroup` con su gloss como `definition`, y el
   gate contextual existente selecciona la acepción. Además: ozdic
   empaqueta variantes en un string separado por comas
   ("long,winning") — el parser ahora divide, evitando publicar
   "long,winning run".
3. **`pickSenseRelationGroups` ignoraba grupos sin synonyms/antonyms** —
   los grupos de colocación de ozdic nunca entraban al gate. Corregido:
   los grupos con `collocations` también participan.

### Gate de colocaciones (contrado con el de sinónimos)

- Grupo seleccionado con colocaciones → sus chunks ganan el campo; las
  listas planas sólo complementan lo endosado.
- Grupos activos pero NINGUNO con colocaciones → los chunks planos
  publican sólo con corroboración EDITORIAL (≥1 fuente editorial +
  ≥2 fuentes totales): "apple tree" (PONS+dictCc) publica, "to run
  aground" (corroboración de corpus) no.
- Filtros de forma nuevos en `normalizeCollocation`: chunks con
  infinitivo "to <headword>" y adverbios planos de corpus
  ("clean forget") bloqueados.

### Verificación (MV3 real, corpus completo)

| Token | Antes | Después |
|---|---|---|
| `give` (ambos) | freely/clearly/directly/currently give | — (ruido de corpus) |
| `run` manage | to run aground + fun run + bad run | — (sin ancla de sentido) |
| `forget` VIP | clean forget | — |
| `apple` VIP | ruido mezclado | apple tree, baked apple, cooking apple |
| `week` VIP | mezclado | working week, in a week, during the week |
| `support` ambos | broad support... | strong/broad support (editorial) |

Corpus 15 tokens × 2 tiers: 0 errores, sin regresiones en otros campos.
Suite: 255 tests verdes (3 nuevos: adverbios de corpus, corroboración
ozdic, infinitivos/adverbios planos).

El audit script de providers ahora limpia la caché de enriquecimiento
antes de cada probe aislado (los `cache-hit` contaminaban la
clasificación con merges previos).

## Fase 10: IPA Standard — cierre del gap de integración (2026-08-31)

Última cobertura real faltante. El mapa de gaps del corpus fijo mostró
IPA Standard en 67% vs VIP 87%, con `apple` y `tensor` en la lista de
huecos PERO con `wiktApi` publicando phonetic en sus source logs.

### Causa raíz

`phoneticPriority` en `mergeFields` sólo consultaba 6 fuentes, todas
VIP/editoriales: cambridge, oxfordLearners, longman, dictionaryCom,
merriamWebster, freeDictionary. Las tres fuentes Standard con IPA
(wiktApi, wiktionaryApi, wiktionary) estaban fuera de la lista — el
mismo patrón que el bug de `MAX_SENSE_GROUPS` de la fase 5: los datos
llegaban, el merge los ignoraba.

### Fix

Una línea: las tres fuentes Standard se añaden al final de
`phoneticPriority` (después de las editoriales, así la preferencia
editorial se mantiene cuando ambas tiers publican). El guard de
frase-completa para MWE sigue intacto.

### Verificación (corpus fijo, 15 × 2 tiers)

| Tier | IPA antes | IPA después | Huecos restantes |
|---|---|---|---|
| Standard | 10/15 (67%) | **13/15 (87%)** | `break up`, `piece of cake` (MWE — por diseño) |
| VIP | 13/15 (87%) | 13/15 (87%) | idem |

Ambos tiers quedan nivelados en 87% con los mismos 2 huecos
intencionales: los MWE sin IPA de frase completa no publican el IPA
del primer verbo de la frase (política de ausencia controlada).

Suite: 267 tests verdes (3 nuevos: fallback a fuente Standard,
preferencia editorial mantenida, guard MWE intacto).

### Estado final del sistema tras las fases 5-10

| Campo | Standard | VIP | Contrato |
|---|---|---|---|
| Traducción | 100% | 100% | WSD por sentido + gate POS |
| Definición | 100% | 100% | ranking contextual por dominio |
| Ejemplos | 100% | 100% | alineación bilingüe |
| IPA | 87% | 87% | prioridad editorial + fallback Standard |
| Frecuencia | 93% | 93% | books-band + bands editoriales |
| Etimología | 93% | 93% | Etymonline/M-W con corroboración |
| Sinónimos | 80% | 87% | gate de acepción (ausencia preferida) |
| Antónimos | 20% | 60% | gate de acepción (ausencia preferida) |
| Colocaciones | 7% | 20% | editorial corroborada (ausencia preferida) |

Los porcentajes bajos de sinónimos/antónimos/colocaciones son el
CONTRATO, no un gap: el sistema prefiere campo vacío antes que datos de
otra acepción (política del audit 2026-08-13). Todas las fuentes
necesarias ya estaban integradas — no se añadió ninguna.

## Fase 11: POS gate general en definición y relaciones (2026-09-06)

Se corrió el corpus completo (15 tokens × 2 tiers) MÁS una tanda de
tipos de palabra que el corpus fijo no cubría (adjetivo, adverbio,
preposición, abstracto, conjunción, colocación fuerte: `happy`,
`quickly`, `through`, `freedom`, `although`, `interest`, `beautiful`,
`however`, `make a decision`) en Chromium MV3 real, `purpose card`, y se
auditó el CONTENIDO campo por campo, no la cobertura.

### Hallazgo

Cero errores de red en 50 tarjetas. Traducción/IPA/audio/etimología/
ejemplos/vídeo sólidos y sensibles al sentido. Los defectos restantes
eran de UNA sola clase: definiciones y sinónimos de la acepción
equivocada por POS discordante, y sólo en Standard. VIP acertaba los
mismos casos (`interest`, `through`, `support`, `however`, `happy`)
porque sus diccionarios pedagógicos separan acepciones por POS; Standard
dependía de WordNet/Wiktionary/Free Dictionary y elegía el synset #1 sin
anclar al POS de la oración.

**Diagnóstico: no faltan fuentes. Faltaba usar el POS que las fuentes YA
entregan.** El mismo patrón que los bugs de `MAX_SENSE_GROUPS` (fase 5)
y `phoneticPriority` (fase 10): el dato llega, el merge lo ignora.

### Causa raíz

`definitionContextTrace` era una pila de reglas por-token (apple, tensor,
lit…) sin ninguna regla general de alineación POS. WordNet emitía sus
definiciones como strings planos, tirando el POS del synset (`p`:
n/v/a/r/s) que SÍ conoce. Sin ese POS el merge no podía distinguir un
gloss de adverbio de uno de adjetivo para `quickly`, ni el sustantivo
financiero de `interest` del verbo "be on the mind of".

### Fix (general, sin reglas por-token)

1. **wordnet.ts** — cada sentido publica su POS: `partOfSpeech` en cada
   `relationGroup` y una vista tipada `definitionsPos` paralela a
   `definitions`. Mapa OEWN → coarse: `n`→noun, `v`→verb, `a`/`s`→
   adjective, `r`→adverb.
2. **types.ts** — `SourcePartial.definitionsPos?`.
3. **orchestrator.ts**:
   - `sentencePosHint` amplía su dominio de verb/noun a también
     **adverb** (forma `-ly` + posición) y **adjective** (predicativo
     tras cópula: "was beautiful", "felt happy"). El adjetivo predicativo
     se comprueba ANTES que la regla de verbo para que "was beautiful"
     no se lea como "was + [verbo]"; sólo casa el token DESNUDO, así
     "was walking" sigue siendo verbo.
   - Regla general de premodificador de calidad (`high interest`,
     `heavy rain`) que la lista base de determinantes no cubría.
   - `definitionContextTrace` recibe el mapa POS y aplica una
     penalización general `penalty-pos-mismatch` (+14) / bonus
     `ok-pos-match` (−6) cuando ambos POS existen. Sin metadata POS la
     regla se mantiene neutra.
   - `pickSenseRelationGroups` descarta grupos cuyo POS discrepa del de
     la oración, pero SÓLO cuando existe un grupo con el POS correcto en
     esa fuente (si la fuente tiene un único POS, no vacía el campo).

### Verificación (MV3 real, perfil FRESCO)

Hallazgo de proceso: el perfil persistente de auditoría cacheaba un
service worker viejo y enmascaraba el fix. Con perfil nuevo:

| Token | POS oración | Antes (Standard) | Después (Standard) |
|---|---|---|---|
| `quickly` | adverbio | def "moving quickly and lightly" (adj) | def "with speed" (adv) + sinónimos apace/rapidly/speedily |
| `interest` | sustantivo | def "be on the mind of" (verbo) | def "a reason for wanting something done" (sust) |

Sin regresiones: `run`→correr/dirigir, `lit`→genial, `tensor`→
matemático, `break up`→relación, `piece of cake`→pan comido,
`forget`→olvidar, `give`→dar intactos. Corpus fijo 15×2 con cobertura
idéntica a la fase 10.

### Límite conocido (queda como contrato, no gap)

Los defectos MISMO-POS no los toca este gate y siguen siendo WSD de
dominio pendiente (audit 2026-08-13 punto 2): `happy`→"good fortune"
(adj vs adj), `beautiful`→"(of weather)" (adj vs adj), `support`→"adopt
as a belief" (verbo vs verbo), `apple`→malus pumila (sust árbol vs sust
fruta). El POS gate cierra la clase cross-POS; la clase same-POS necesita
la fase de WSD por dominio, aún abierta.

### Veredicto sobre fuentes

**No se añadió ninguna fuente y no hace falta.** Todos los defectos
auditados eran de merge, no de materia prima. Suite: 273 pruebas verdes
(6 nuevas: hints adverb/adjetivo/premodificador, gate de definición por
POS, códigos de razón, neutralidad sin metadata).
