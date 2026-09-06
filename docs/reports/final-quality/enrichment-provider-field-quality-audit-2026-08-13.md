# Auditoría de calidad por proveedor y campo — 2026-08-13

## Alcance y evidencia

Esta auditoría separa tres preguntas distintas:

1. si el proveedor está disponible desde el service worker MV3;
2. qué materia prima devuelve;
3. si esa materia prima es adecuada para cada campo de la tarjeta y para el
   sentido de la oración.

Corpus contextual MV3:

- `apple` — `She ate a ripe apple.`
- `run` — `She ran home.`
- `anything` — contexto positivo y negativo
- `anybody` — contexto positivo y negativo
- `each` — `Each student has a book.`
- `tensor` — `The model uses a tensor.`
- `lit` — `The show was lit.`
- `break up` — relación
- `piece of cake` — modismo
- `forget` — `Do not forget your keys.`

Los ocho proveedores sensibles se ejecutaron aislados en Chromium real. Los
proveedores abiertos se evaluaron con sus payloads individuales y con el merge
del corpus anterior. No se forzó Linguee durante su cooldown y no se
consideraron fallos las fuentes BYOK sin credenciales.

Evidencia principal:

- doce JSON `docs/reports/runtime/mv3-enrichment-audit-2026-08-13T04-4*.json`;
- `docs/reports/enrichment-source-audit-2026-08-12.json`;
- `docs/reports/final-quality/enrichment-merge-probe-2026-08-13.json`;
- `docs/reports/runtime/provider-availability-mv3-2026-08-13.md`.

## Resultado ejecutivo

La arquitectura cubre todos los tipos de campo, pero antes de esta auditoría la
cantidad ocultaba varios fallos de sentido:

- la caché ignoraba la oración y reutilizaba `anything`/`anybody` positivos en
  contextos negativos;
- el bundle tenía glosas incorrectas para `run`, `forget`, `each`, `tensor` y
  resolvía `lit` como `light`;
- WordReference desplazaba traducciones de ejemplos entre filas;
- se promovían sinónimos de MWE como si fueran colocaciones;
- una tarjeta podía acumular hasta ocho audios y conservar TTS aunque ya hubiera
  audio humano/editorial;
- definiciones y ejemplos podían pertenecer a otra acepción.

Estos cinco primeros problemas quedaron corregidos durante la auditoría. El
ranking contextual de definiciones y ejemplos también recibió penalizaciones
para remisiones, usos dialectales/metalingüísticos y sentidos literales de
modismos.

## Calidad y función recomendada por proveedor

Escala:

- **A**: fuente primaria para ese campo;
- **B**: fuente secundaria o fallback de alta calidad;
- **C**: sólo señal de corroboración o requiere filtros fuertes;
- **D**: no usar para ese campo.

| Proveedor | Mejor uso | Calidad | Hallazgos y límites |
|---|---|---:|---|
| Bundled | traducción/definición inmediata | A | Ancla offline; se corrigieron `run`, `forget`, `each`, `tensor` y `lit` |
| Yomitan packs | traducción/definición local | A/B | Depende de packs instalados; sin cobertura medible en este corpus |
| Cambridge | traducción, definición, IPA, ejemplos | A | Muy buena fuente pedagógica; sus glosas necesitan ranking por polaridad/sentido |
| Oxford Learner's | definición, IPA, audio, colocaciones | A | Excelente para aprendizaje; menor cobertura de MWE |
| Longman | definición y colocaciones | A | Vocabulario definitorio fuerte; audios de oraciones ya se excluyen |
| Merriam-Webster | definición, técnico, etimología, audio | A | Excelente en `tensor`, `forget` y sentidos de `lit`; ejemplos pueden pertenecer a otra acepción |
| Britannica | definición y ejemplos comunes | A/B | Definiciones claras; débil/intermitente en técnico y slang; circuit breaker activo |
| Dictionary.com | definición, IPA y audio | B | Buena cobertura, incluso MWE; fragmenta algunas definiciones y da ejemplos literales para modismos |
| FreeDictionaryAPI | definición, IPA, ejemplos | B | Cobertura alta; relaciones léxicas requieren filtro de sentido |
| Free Dictionary | IPA, audio y definición fallback | B | Útil como base; no confiar ciegamente en relaciones o IPA discordante |
| Wiktionary REST | definición y ejemplos | B | Amplio, pero irregular en MWE |
| Wiktionary HTML | etimología y relacionados | B/C | Valioso, parser/cobertura variables |
| Wiktionary API | definiciones y relaciones | B/C | Puede priorizar acepciones dialectales o metalingüísticas |
| WiktAPI | definición, IPA, audio y traducción | B | Payload rico; las traducciones necesitan ancla local |
| WordReference | traducción y gramática | A | Mejor inventario para polaridad y categoría; emparejamiento de ejemplos corregido |
| Reverso | ejemplos bilingües contextuales | A | Mejor fuente de ejemplos; traducciones mezclan sentidos y alguna lengua ajena (`mela`) |
| PROMT Contexts | ejemplos bilingües fallback | A/B | Buen reemplazo de Linguee; mezcla sentidos en `lit` y MWE; `tensor` quedó vacío |
| Linguee | traducción/ejemplos bilingües | no evaluado | Cooldown real; no recibió solicitudes durante el corpus |
| SpanishDict | traducciones comunes | B | Buena en vocabulario frecuente, débil en MWE |
| PONS | traducción y material colocacional | B/C | Rico, pero mezcla frames, labels y frases; exige limpieza |
| bab.la | traducción | B | Útil; audio sólo con evidencia léxica real |
| dict.cc | traducción compacta | B | Buena señal secundaria, menor cobertura de MWE |
| Tatoeba | ejemplos bilingües | B | Cobertura alta; calidad variable y algunas traducciones poco naturales |
| Thesaurus.com | sinónimos/antónimos | B | Útil si coincide el sentido y existe corroboración |
| Datamuse | relaciones y colocaciones | C | Sólo señal secundaria; no autoridad semántica |
| WordHippo | antónimos y frases relacionadas | B/C | Útil para MWE; algunas relaciones son perifrásticas |
| Moby Thesaurus | asociaciones | D/C | Muy amplio y ruidoso; nunca debe ser única evidencia |
| Ozdic | colocaciones | B/C | Buena materia prima, pero contiene frames y combinaciones espurias |
| The Idioms | definición de modismos | C | Etimologías no fiables; permanecen excluidas |
| Etymonline | etimología | A | Fuente principal para palabras simples |
| Forvo | audio humano | A | Primera opción para palabras simples; sin cobertura de las dos MWE auditadas |
| Lingua Libre | audio humano | A/B | Calidad alta y cobertura baja |
| Google TTS | audio sintético | B fallback | Sólo cuando no existe audio humano/editorial válido |
| YouGlish | vídeo contextual | A | Enlace útil para pronunciación en contexto |
| Wikimedia Commons | imagen con procedencia | B | Buena trazabilidad, cobertura/relevancia menores |
| Openverse | imagen licenciada | B | Preferible por licencia, pero requiere ranking semántico |
| Bing Images | imagen general | C | Cobertura alta; produjo logos, noticias y resultados SEO irrelevantes |
| DuckDuckGo Images | imagen general | C | Cobertura alta, relevancia y estabilidad variables |
| Unsplash | imagen | no evaluado | BYOK sin credenciales de auditoría |
| Pixabay | imagen | no evaluado | BYOK sin credenciales de auditoría |

## Distribución correcta por campo

### Traducción principal

Orden recomendado:

1. bundle/Yomitan curado como ancla;
2. WordReference y Cambridge para categoría y equivalentes;
3. Reverso para escoger según la oración;
4. PONS, SpanishDict, dict.cc y bab.la como expansión;
5. MT/IA sólo si las fuentes léxicas no resuelven el término.

La traducción principal debe recalcularse por oración aunque el payload léxico
esté cacheado. La caché ya incluye la oración para impedir contaminación de
polaridad.

Casos críticos corregidos:

- `run`: `carrera` → `correr`;
- `forget`: `que te olvides` → `olvidar`;
- `each student`: `cada uno` → `cada`;
- `tensor` técnico: `templadores, tensores` → `tensor`;
- `lit` slang: `luz` → `genial`.

### Definición principal

Orden recomendado:

1. Longman/Cambridge/Oxford;
2. Merriam-Webster/Britannica;
3. Dictionary.com;
4. WiktAPI/Wiktionary/Free Dictionary;
5. bundle como fallback inmediato.

La prioridad de proveedor no basta: primero debe ganar la acepción compatible
con la oración. Se penalizan remisiones (`→ anyone`), `dialect`, `obsolete`,
`placeholder verb`, la literatura/luz para `lit`, árbol/modismo para `apple` y
acepciones no técnicas para `tensor`.

### Ejemplos

Orden recomendado:

1. Reverso;
2. PROMT;
3. Tatoeba;
4. Cambridge/Oxford/Longman/Britannica/Merriam-Webster/Dictionary.com;
5. WordReference sólo después de validar la alineación por fila.

Filtros obligatorios:

- token o flexión presentes;
- traducción alineada;
- mismo sentido que la definición/traducción principal;
- máximo dos por proveedor;
- eliminar prompts editoriales y duplicados normalizados;
- penalizar pastel literal para `piece of cake`;
- penalizar pelea, queso, señal o suelo para `break up` relacional;
- penalizar `lit up`, literatura y luz para `lit` slang.

### Sinónimos y antónimos

Orden recomendado:

1. Thesaurus.com/Free Dictionary/Wiktionary cuando concuerdan;
2. Datamuse y WordHippo como corroboración;
3. Moby únicamente si otra fuente independiente confirma el término.

No completar cupos. Campo vacío es mejor que `coitize` para `know`, `ladder`
para `run`, `future` para `week` o `dark` para `wonderful`.

### Colocaciones

Orden recomendado:

1. Oxford/Longman/Ozdic;
2. PONS/dict.cc tras limpiar labels y frames;
3. listas locales curadas.

Un sinónimo de varias palabras no es automáticamente una colocación. Se eliminó
esa promoción, que convertía `duck soup` y `child's play` en colocaciones de
`piece of cake`.

### IPA

Orden recomendado:

1. Cambridge/Oxford/Longman;
2. Dictionary.com/Merriam-Webster;
3. Free Dictionary/WiktAPI.

Para MWE sólo se acepta IPA de la frase completa. Deben rechazarse espacios
internos anómalos y desacuerdos evidentes como `/ɹʊn/` para `run`.

### Audio

Orden recomendado:

1. Forvo/Lingua Libre;
2. Cambridge/Oxford/Longman;
3. Dictionary.com/Britannica/Merriam-Webster;
4. APIs abiertas;
5. Google TTS únicamente si no existe audio real.

Ahora se deduplica por URL entre proveedores, se limita a cuatro pistas totales
y se elimina TTS cuando existe una pista no sintética.

### Etimología

1. Etymonline;
2. Merriam-Webster;
3. Wiktionary como complemento.

No usar The Idioms sin corroboración. En MWE es correcto dejar el campo vacío si
no hay fuente fiable.

### Imagen

La cobertura 9/9 anterior no equivale a calidad. Se observaron logos para
`anything`, noticias/Malwarebytes para `week`, clipart para `know` y pastel
literal para `piece of cake`.

Política recomendada:

- concretos: Wikimedia/Openverse y luego buscadores generales;
- abstractos, pronombres y conectores: permitir campo vacío;
- modismos: exigir representación figurada, no literal;
- rechazar logos, wallpapers, noticias fechadas e infografías SEO.

Este campo sigue siendo el principal pendiente porque su relevancia necesita
metadatos mejores o revisión visual, no sólo HTTP 200.

### Vídeo

YouGlish es el proveedor adecuado. Debe mantenerse como enlace contextual y no
confundirse con audio descargable.

### Frecuencia

La auditoría original observó cobertura 0. La segunda fase añadió bandas
Longman `S1–S3` y `W1–W3` como evidencia tipada y visible, sin convertirlas en
un rango BNC/COCA ficticio. VIP tiene ahora frecuencia pedagógica parcial;
Standard continúa sin una fuente de frecuencia aprobada.

## Fallos exactos observados

- Dictionary.com fragmentó `apple`: `any of these trees.`
- Britannica/Merriam-Webster duplicaron ejemplos y URLs de audio.
- Reverso devolvió `mela` para `apple`.
- WordReference contaminó `each` con `estar como perro y gato expr`.
- WordReference desplazó traducciones de ejemplos en `forget` y
  `piece of cake`; el parser ahora empareja dentro del mismo `<tr>`.
- PROMT dio sólo sentidos de `light` para `The show was lit.`
- Dictionary.com y Merriam-Webster dieron ejemplos literales de pastel para el
  modismo `piece of cake`.
- Forvo respondió 200 sin audio extraíble para `break up` y `piece of cake`.
- PROMT respondió 200 sin datos para `tensor`.
- Britannica tuvo un error de red/redirección aislado en `tensor`.
- Linguee permaneció en cooldown y no es evaluable con este corpus.

## Cambios aplicados como resultado de la auditoría

- La oración forma parte de la clave de caché de enriquecimiento.
- La polaridad EN→ES de `anything`/`anybody` se resuelve con una regla
  gramatical contextual cuando los proveedores no publican `nada`/`nadie` como
  glosa, aunque sí aparezcan dentro de sus ejemplos.
- Se añadieron entradas locales curadas para `run`, `forget`, `each`, `tensor`
  y `lit`.
- WordReference empareja ejemplos por fila.
- Se eliminó la promoción de sinónimos MWE a colocaciones.
- Audio deduplicado por URL, máximo cuatro pistas y TTS sólo como fallback.
- Definiciones modernas/contextuales ganan frente a remisiones, dialectalismos
  y acepciones incompatibles.
- Ejemplos idiomáticos/contextuales ganan frente a coincidencias literales.

## Actualización posterior: estado A/B real tras el endurecimiento

### Respuesta directa: ¿los proveedores C/D subieron a A/B?

**No de forma global.** La calificación pertenece a la combinación
`proveedor + campo`, y añadir filtros no convierte automáticamente una fuente C
en una fuente A/B. Lo que cambió fue el permiso de publicación:

- una fuente A/B puede aportar directamente en los campos donde está auditada;
- una fuente C debe actuar como señal interna y no debería llenar sola un campo;
- una fuente D no debe publicar ni contar como evidencia suficiente;
- cuando no hay evidencia A/B, el campo debe quedar vacío.

La segunda fase aplica esta política a etimología, relaciones y colocaciones,
y restringe las imágenes visibles a fuentes abiertas/editoriales admitidas.
La selección semántica general por acepción todavía no está terminada.

| Área | Estado actual | ¿Sólo A/B visible? | Qué falta |
|---|---|---:|---|
| Traducción | fuerte y contextual | mayormente sí | WSD general y limpiar `vip.translations` crudas |
| Definición | fuerte, con ranking contextual | mayormente sí | sustituir reglas específicas del corpus por WSD general |
| Ejemplos | fuerte, deduplicados y contextualizados | mayormente sí | validar sentido de forma general, no sólo casos auditados |
| IPA | fuerte | sí en fuentes principales | ampliar cobertura de MWE |
| Audio | fuerte, humano/editorial antes de TTS | sí | ampliar cobertura humana de MWE |
| Vídeo | YouGlish | sí | sin gap importante |
| Etimología | prioridad explícita y lista cerrada | sí para fuentes admitidas | atribución/confianza y corroboración de contradicciones |
| Sinónimos/antónimos | Cambridge/Longman por grupos; C aislada oculta | parcial | Open English WordNet Standard y MW Thesaurus VIP |
| Colocaciones | editorial directa o corroboración independiente | mayormente sí | WSD de colocaciones y corpus contextual mayor |
| Imágenes | Openverse/Wikimedia con múltiples candidatos y metadata | parcial | `depicts`/imageability general y auditoría visual amplia |
| Frecuencia | Longman S/W tipado, visible y mapeable a Anki | VIP parcial | fuente Standard con licencia confirmada |

### Destino concreto de las fuentes C/D

| Proveedor/campo | Calidad conservada | Qué hace ahora | Decisión final recomendada |
|---|---:|---|---|
| Datamuse — relaciones | C | una relación aislada ya no se muestra | mantener sólo como corroboración |
| Datamuse — colocaciones | C | una colocación aislada ya no se muestra | mantener sólo como corroboración |
| Moby — sinónimos/asociaciones | D/C | no se muestra solo ni cuenta como corroboración fuerte | conservar únicamente como señal débil interna o retirar |
| WordHippo — relaciones | B/C | se trata como corroboración en el ranking nuevo | mantener para MWE, exigiendo otra evidencia |
| Wiktionary — relaciones | B/C | se trata conservadoramente como corroboración | mantener; mejorar cuando haya sentido/POS explícitos |
| Ozdic — colocaciones | B/C | no publica solo; exige otra evidencia | mantener materia prima y añadir WSD |
| PONS — colocaciones | B/C | no publica solo; exige otra evidencia | mantener traducción B y colocaciones corroboradas |
| The Idioms — definición | C | excluida del merge visible | conservar sólo como señal de detección o retirar |
| The Idioms — etimología | D | queda fuera de la lista elegible | exclusión definitiva |
| Bing Images — imagen | C | no puede ganar el ranking visible | señal interna o retirada futura |
| DuckDuckGo Images — imagen | C | no puede ganar el ranking visible | señal interna o retirada futura |

Por tanto, **D no fue transformado en A/B**. The Idioms está excluido de
etimología y definición visibles. Moby no puede publicar solo ni contar como
corroboración fuerte.

## Estado real de Standard y VIP

### Standard actual en el código

Standard se ejecuta aunque el interruptor maestro VIP esté apagado. En este
momento contiene:

- base local: Bundled y Yomitan packs;
- diccionarios abiertos: Free Dictionary, Wiktionary REST/HTML/API y WiktAPI;
- relaciones: Datamuse, Moby, Thesaurus.com y WordHippo;
- modismos: The Idioms;
- etimología: Etymonline;
- ejemplos: Tatoeba;
- audio: Lingua Libre y Google TTS fallback;
- imágenes: Wikimedia Commons, Openverse, Bing y DuckDuckGo;
- vídeo: YouGlish.

Britannica fue retirada de `STANDARD_SOURCE_KEYS` y ahora sólo se ejecuta con el
interruptor maestro VIP. Su preferencia individual se conserva para no romper
configuraciones existentes.

### Standard objetivo

Standard debe conservar una tarjeta fuerte sin depender de scraping premium:

| Campo | Fuentes principales A/B objetivo | Señales internas |
|---|---|---|
| Traducción/definición | Bundled, Yomitan, Free Dictionary, Wiktionary/WiktAPI | ninguna fuente C debe desplazar el ancla local |
| Relaciones | VIP: Cambridge + M-W Thesaurus (fase 4); Standard: Open English WordNet (fase 3) + corroboradas | Datamuse, WordHippo; Moby sólo señal débil |
| Ejemplos | Tatoeba + ejemplos de diccionarios abiertos | — |
| IPA/audio | Free Dictionary, WiktAPI, Lingua Libre; TTS fallback | — |
| Imágenes | Wikimedia Commons y Openverse | Bing/DDG sólo fallback filtrado |
| Etimología | Etymonline; Wiktionary fallback | — |
| Vídeo | YouGlish | — |
| Frecuencia | pendiente de dataset redistribuible confirmado | no inventar rango |

El objetivo no es eliminar físicamente todos los módulos C, sino impedir que su
contenido se publique sin evidencia suficiente. Moby y The Idioms sí son
candidatos a salir del camino visible porque su valor no compensa el riesgo en
los campos problemáticos.

### VIP actual en el código

VIP añade, cuando su interruptor maestro está activo:

- Britannica Dictionary;
- Cambridge, incluido Cambridge Thesaurus por grupos de sentido;
- Oxford Learner's;
- Longman;
- Dictionary.com bajo la clave histórica `collins`;
- Merriam-Webster;
- Ozdic;
- PONS;
- bab.la;
- dict.cc;
- Reverso;
- Linguee;
- PROMT Contexts;
- WordReference;
- SpanishDict;
- Forvo;
- Unsplash y Pixabay BYOK.

VIP ya aporta una mejora real en definición editorial, traducción, ejemplos
contextuales, IPA, audio, relaciones por sentido de Cambridge y frecuencia
pedagógica de Longman. Las imágenes mejoraron en Standard mediante metadata
abierta; VIP todavía necesita corroborar mejor relaciones con una segunda
fuente editorial y completar WSD de colocaciones.

### VIP objetivo

| Campo | Fuente VIP principal | Función |
|---|---|---|
| Definición | Cambridge, Oxford, Longman, Merriam-Webster | selección editorial por sentido |
| Traducción | Cambridge, WordReference, PONS, SpanishDict | equivalentes por categoría y contexto |
| Sinónimos/antónimos | Cambridge Thesaurus y Merriam-Webster Thesaurus | grupos conceptuales ligados a acepción |
| Colocaciones | Longman/Oxford/Ozdic filtrados | pocas combinaciones pedagógicas y del mismo sentido |
| Ejemplos | Reverso, PROMT y diccionarios editoriales | contexto bilingüe y editorial |
| Frecuencia | bandas Longman S1–S3/W1–W3 | evidencia pedagógica, no rango falso |
| IPA/audio | Cambridge, Oxford, Longman, Forvo | pronunciación editorial/humana |
| Etimología | Merriam-Webster; posible American Heritage | fallback/corroboración de Etymonline |
| Imágenes | no añadir más buscadores | usar mejor metadata y coherencia semántica |
| Vídeo | YouGlish ya cubre la necesidad | no se necesita proveedor VIP adicional |

## Nuevos proveedores que sí valen la pena

### Standard

#### 1. Open English WordNet — recomendado

- **Estado:** investigado, no integrado.
- **Reputación:** continuación abierta del WordNet inglés, mantenida como recurso
  léxico estructurado.
- **Licencia observada:** CC BY 4.0 para la distribución 2025.
- **Campos que mejora:** definiciones, sinónimos, antónimos y relaciones por
  synset.
- **Calidad esperada:** A como backbone semántico estructurado; B como texto
  pedagógico visible, porque no sustituye un learner's dictionary.
- **Ventaja:** aporta identificadores de sentido y relaciones dentro del synset,
  justo lo que falta al contrato plano actual.
- **Integración recomendada:** dataset local/bundled, no dependencia de una API
  remota.
- **Inconveniente:** hace falta mapear oración/POS al synset correcto; sin WSD,
  WordNet también puede elegir otra acepción.
- **Decisión:** sí vale la pena y es la prioridad nueva de Standard.

#### 2. SUBTLEX-US/SUBTLEX-UK — bloqueado hasta aclarar licencia

- **Estado:** candidato para frecuencia, no aprobado para empaquetado.
- **Campo que mejora:** frecuencia moderna basada en subtítulos.
- **Calidad esperada:** A/B para frecuencia de uso cotidiano si la edición y
  escala se documentan correctamente.
- **Problema:** se encontraron declaraciones de licencia incompatibles entre
  repositorios (`Other`, CC BY-NC-ND y CC BY-SA).
- **Decisión:** investigar y obtener una licencia inequívoca antes de usarlo. No
  incluirlo todavía ni presentar `frequencyRank` como resuelto.

#### 3. Wikimedia Structured Data (`depicts`, P180) — mejorar, no añadir

No es un proveedor nuevo. Es una mejora de Wikimedia Commons para obtener
entidades representadas, captions y procedencia. Tiene más valor que incorporar
otro buscador general de imágenes.

### VIP por scraping editorial

#### 1. Cambridge Thesaurus — integrado

- **Estado:** parser integrado y verificado con fixtures y página live de `run`.
- **Campos:** sinónimos y antónimos.
- **Calidad esperada:** A cuando se selecciona el grupo conceptual correcto.
- **Ventaja:** organiza alternativas por concepto, definición/guideword y
  ejemplos, lo que permite comparar el grupo con la oración.
- **Cobertura observada externamente:** palabras comunes y MWE como `run` y
  `piece of cake` tienen páginas.
- **Scraping:** segunda consulta paralela al mismo host de Cambridge Dictionary,
  fail-silent y limitada a grupos de sentido.
- **Decisión:** incorporado; falta ampliar la auditoría contextual del corpus.

#### 2. Merriam-Webster Thesaurus — prioridad alta

- **Estado:** páginas verificadas; parser no integrado.
- **Campos:** sinónimos y antónimos.
- **Calidad esperada:** A/B.
- **Ventaja:** separa grupos con etiquetas del tipo `as in to jog` o
  `as in to manage`, útiles para evitar mezclar acepciones de `run`.
- **Scraping:** viable como ruta `/thesaurus/<token>` en el host que ya funciona
  desde MV3; requiere tests de cambios HTML y rate limiting conservador.
- **Decisión:** incorporar como segunda fuente editorial y corroboración de
  Cambridge.

#### 3. Ampliación de Longman — integrada

- **Estado:** bandas FREQ, `ThesBox` y `ColloBox` integrados y verificados live.
- **Campos:** frecuencia, thesaurus y colocaciones.
- **Calidad esperada:** A/B.
- **Mejora concreta:** bandas `S1–S3` y `W1–W3` preservadas como evidencia
  tipada; bloques THESAURUS/COLLOCATIONS extraídos sin mezclarlos con ejemplos o
  definiciones principales.
- **Inconveniente:** las bandas sólo indican top 1000/2000/3000 hablado/escrito;
  no son un rango exacto y no deben mezclarse con Zipf.
- **Decisión:** ampliación aplicada; no añadir otra fuente VIP de frecuencia
  hasta medir cobertura Longman.

#### 4. American Heritage — sólo investigación

- **Estado:** no integrado y viabilidad de scraping no validada todavía en MV3.
- **Campo:** corroboración etimológica.
- **Calidad esperada:** B como fuente editorial secundaria.
- **Ventaja:** puede cubrir o contrastar casos donde Etymonline/Merriam-Webster
  sean incompletos.
- **Inconvenientes:** hay que verificar estabilidad HTML, términos de uso,
  cobertura y disponibilidad real desde la extensión.
- **Decisión:** investigar después de Cambridge/MW/Longman; no es prioritaria.

## Proveedores que no hace falta añadir

- otro buscador general de imágenes: aumentaría cobertura, no relevancia;
- APIs de Oxford, Sketch Engine u otras con pago obligatorio;
- Collins por scraping mientras mantenga Cloudflare Challenge;
- Macmillan Dictionary, cerrado;
- Vocabulary.com mientras sus términos/reutilización no permitan una
  integración clara;
- una segunda fuente de vídeo: YouGlish ya cubre el campo;
- más TTS: el problema no es cobertura sintética sino audio humano de MWE.

## Orden de trabajo para completar A/B

Completado en la segunda fase:

- Moby dejó de contar como corroboración fuerte;
- colocaciones C/B-C necesitan corroboración;
- Openverse/Wikimedia devuelven múltiples candidatos con metadatos;
- Cambridge Thesaurus está integrado por grupos de sentido;
- Longman aporta frecuencia S/W y bloques semánticos;
- Britannica pasó de Standard a VIP.

Continuación 2026-09-06 (ver
`enrichment-relations-collocations-hardening-2026-09-06.md`):

- puntos 2 y 3 del veredicto atacados por FORMA: filtro de taxonomía/
  perifrasis/componente-literal en sinónimos (`apple`, `each`, `anybody`,
  `piece of cake`) y publicación solo de chunks de diccionario de aprendizaje
  en colocaciones (`apple`, `week`, `support`);
- lo que resta de 2 y 3 es binding por acepción (`know`, `each` vip,
  antónimos figurados) — no resoluble por forma.

Pendiente, en orden:

1. integrar Open English WordNet en Standard con synsets;
2. capturar fixture MV3 e integrar Merriam-Webster Thesaurus en VIP;
3. ampliar WSD general y POS para relaciones/colocaciones;
4. obtener una fuente Standard de frecuencia con licencia inequívoca;
5. volver a ejecutar el corpus y reclasificar por `proveedor + campo` según la
   tarjeta final, no sólo el payload.

## Veredicto

La distribución recomendada ya está definida y las fuentes principales son de
calidad suficiente para una tarjeta fuerte:

- traducción: bundle + WordReference/Cambridge/Reverso;
- definición: diccionarios pedagógicos/editoriales;
- ejemplos: Reverso/PROMT/Tatoeba;
- audio: Forvo/Lingua Libre + diccionarios, TTS sólo fallback;
- etimología: Etymonline/Merriam-Webster;
- vídeo: YouGlish.

No deben considerarse completamente resueltos todavía:

1. imágenes por sentido;
2. sinónimos/antónimos ligados a acepción;
3. colocaciones estrictas en palabras polisémicas;
4. frecuencia;
5. Linguee mientras siga en cooldown;
6. fuentes BYOK sin credenciales.

La tarjeta debe preferir ausencia controlada antes que rellenar cualquiera de
estos campos con información incorrecta.
