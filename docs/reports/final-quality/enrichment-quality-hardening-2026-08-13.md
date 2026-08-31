# Endurecimiento A/B del enriquecimiento — 2026-08-13

> **Estado:** informe histórico de la fase 1. Los pendientes descritos aquí se
> actualizaron parcialmente en
> `docs/reports/final-quality/enrichment-ab-phase-2-2026-08-13.md`.

## Objetivo

Esta fase inicia la aplicación técnica de la política acordada para la tarjeta:

- mostrar únicamente contenido de calidad **A/B**;
- utilizar fuentes **C** sólo como señales internas de corroboración;
- impedir que contenido **D** llegue a la tarjeta;
- preferir un campo vacío antes que un resultado dudoso;
- conservar el fan-out independiente y los contratos existentes mientras se
  migran gradualmente los proveedores.

El alcance de esta iteración fue deliberadamente reducido. No se añadieron
proveedores ni se reescribieron parsers. Se endureció el merge central para que
los datos ya disponibles no se muestren únicamente por haber respondido antes.

## Archivos modificados

- `src/background/enrichment/types.ts`
- `src/background/enrichment/orchestrator.ts`
- `tests/unit/enrichment-orchestrator.test.ts`

## 1. Relaciones léxicas: las fuentes C ya no aparecen solas

### Problema anterior

`pickRelatedTerms()` agrupaba sinónimos y antónimos por texto y premiaba el
consenso, pero una asociación entregada por una sola fuente de baja confianza
todavía podía llegar a la tarjeta. Moby tenía una restricción especial para
expresiones de varias palabras, pero Datamuse, WordHippo y otras listas planas
podían ganar individualmente.

Esto contradecía la política:

> pocos resultados muy confiables > muchos resultados ruidosos.

### Política implementada

Se introdujo una separación operativa entre fuentes mostrables por sí solas y
fuentes de corroboración.

Fuentes que actualmente pueden aportar una relación individual visible:

- Cambridge;
- Merriam-Webster;
- Longman;
- Thesaurus.com;
- Free Dictionary;
- Dictionary.com;
- Britannica Dictionary;
- Oxford Learner's.

Las demás fuentes se tratan, de momento, como corroboración. Una relación
procedente sólo de Datamuse, Moby, WordHippo, Wiktionary plano o una fuente local
no curada se descarta del resultado visible. Puede mostrarse cuando dos fuentes
independientes coinciden en el mismo término normalizado.

### Efecto esperado

- `coitize` o `go to bed with` no aparecen para `know` sólo porque Moby los
  relacione con alguna acepción histórica o periférica;
- una sugerencia aislada de Datamuse no completa artificialmente el campo;
- dos fuentes C independientes pueden corroborar una misma relación;
- una relación editorial A/B puede mostrarse sin exigir cobertura duplicada;
- el campo queda vacío cuando no existe evidencia suficiente.

### Límite pendiente

El contrato continúa transportando `synonyms?: string[]` y
`antonyms?: string[]`. Todavía no contiene `senseId`, POS, definición guía,
labels ni confianza por candidato. La corroboración reduce ruido, pero no
sustituye la selección de grupo semántico que deberán aportar Cambridge
Thesaurus y Merriam-Webster Thesaurus.

## 2. Etimología: prioridad explícita y lista cerrada

### Problema anterior

El merge conservaba la primera etimología recibida, excepto si procedía de The
Idioms. Como el fan-out es paralelo y el arreglo final depende del orden de
fuentes activas, Wiktionary HTML podía ocupar el campo antes que Etymonline.

La calidad dependía indirectamente del orden de proveedores, no de la autoridad
etimológica.

### Política implementada

Todas las etimologías se acumulan primero y después se elige una mediante la
siguiente prioridad explícita:

1. Etymonline;
2. Merriam-Webster;
3. American Heritage, reservado para una posible integración futura;
4. Wiktionary HTML;
5. Wiktionary API;
6. WiktAPI;
7. Wiktionary REST.

También se exige un contenido mínimo no vacío y se normaliza el espacio antes
de seleccionarlo.

### Exclusiones

- The Idioms no pertenece a la lista elegible y no puede llegar al campo;
- una fuente no auditada para etimología no se acepta automáticamente;
- responder primero ya no concede prioridad.

### Efecto esperado

Cuando Etymonline y Wiktionary devuelven información, gana Etymonline. Si
Etymonline no tiene cobertura, Merriam-Webster actúa como fallback editorial.
Wiktionary queda como fallback secundario y no desplaza fuentes más fuertes.

### Límite pendiente

La salida pública sigue siendo `vip.etymology?: string`. Aún no expone fuente,
confianza ni corroboración en la interfaz. Tampoco se compara todavía si dos
relatos históricos se contradicen. En una fase posterior conviene conservar la
atribución del candidato ganador y distinguir “fuente primaria” de
“corroboración”.

## 3. Imágenes: ranking central y permiso para dejar el campo vacío

### Problema anterior

El merge utilizaba la primera URL no vacía:

```ts
if (partial.imageUrl && !vip.imageUrl) vip.imageUrl = partial.imageUrl;
```

Esto hacía que el orden de ejecución/proveedores sustituyera a la relevancia.
No existía información para comparar título, etiquetas, dimensiones,
procedencia o significado. Casos como `anything`, `week`, `know` y
`piece of cake` podían terminar con logos, noticias, frases decorativas o una
foto literal de pastel.

### Nuevo contrato compatible

Se añadió `ImageCandidate` con estos campos:

- `url`;
- `title` opcional;
- `tags` opcionales;
- `sourcePageUrl` opcional;
- `width` y `height` opcionales.

`SourcePartial` acepta ahora `imageCandidates?: ImageCandidate[]` y conserva
`imageUrl?: string` como compatibilidad temporal. Los proveedores actuales no
se rompen: su URL antigua se convierte internamente en un candidato sin
metadatos.

### Ranking implementado

El orquestador acumula todos los candidatos y los compara después del fan-out.
La prioridad inicial de procedencia es:

1. Wikimedia Commons;
2. Openverse;
3. Unsplash;
4. Pixabay;
5. Bing Images;
6. DuckDuckGo Images.

La puntuación también considera:

- coincidencia de la palabra completa en título o etiquetas;
- coincidencia de palabras léxicas en metadatos o URL;
- disponibilidad de metadatos;
- dimensiones mínimas;
- resolución suficiente;
- formato excesivamente panorámico;
- indicadores de contenido no pedagógico.

Se rechazan candidatos asociados con términos como:

- logo;
- icon;
- banner;
- wallpaper;
- clipart;
- stock vector;
- news/headline;
- template;
- SEO;
- meme;
- quote.

### Reglas conservadoras

Por ahora se permite que la tarjeta quede sin imagen para los términos de baja
representabilidad observados en la auditoría:

- `anything`;
- `anybody`;
- `anyone`;
- `each`;
- `know`;
- `week`.

Las expresiones de varias palabras requieren metadatos que coincidan con la
frase completa. Para `piece of cake`, además, se exige evidencia explícita de
sentido idiomático o figurado. Una foto titulada únicamente “a piece of cake on
a plate” se descarta.

### Efecto esperado

- una fuente no gana sólo por ser la primera en responder;
- Openverse/Wikimedia pueden desplazar un resultado genérico de Bing/DDG;
- logos, noticias y recursos decorativos se descartan antes de la tarjeta;
- los abstractos auditados pueden quedar correctamente sin imagen;
- un modismo no recibe automáticamente una representación literal.

### Límite pendiente

Los proveedores de imágenes todavía devuelven principalmente una sola
`imageUrl`. El ranking ya está preparado, pero alcanzará su valor completo
cuando cada parser devuelva varios candidatos con título, etiquetas,
dimensiones y página de atribución. La siguiente migración debería comenzar por
Openverse y Wikimedia Commons, aprovechando `depicts (P180)` cuando esté
disponible.

La lista de términos poco representables es una protección inicial basada en el
corpus auditado, no un clasificador general de imageability. Más adelante debe
reemplazarse o complementarse con POS, tipo de entrada, detección de idiom y
coherencia con la definición elegida.

## 4. Frecuencia: contrato preparado sin mezclar escalas

Se añadió `FrequencyEvidence` para evitar convertir señales incompatibles en un
supuesto rango exacto. Cada evidencia conserva:

- `scale`;
- `value`;
- `corpus` opcional.

Escalas previstas inicialmente:

- `rank`;
- `longman-spoken`;
- `longman-written`;
- `zipf`;
- otras escalas identificadas por nombre.

`frequencyRank` se mantiene por compatibilidad, pero queda documentado como un
rango exacto legado. Las bandas `S1–S3` y `W1–W3` de Longman no deben almacenarse
como si fueran posiciones precisas de BNC/COCA, y un valor Zipf no debe
promediarse directamente con ellas.

Esta fase sólo crea el contrato. Todavía no modifica la tarjeta ni extrae las
bandas de Longman.

## 5. Pruebas añadidas

Se ampliaron las pruebas unitarias del orquestador para cubrir:

1. una relación entregada únicamente por fuentes C queda vacía;
2. dos fuentes C independientes pueden corroborar el mismo término;
3. una relación de una fuente editorial A/B conserva prioridad;
4. Etymonline gana aunque Wiktionary haya producido candidato;
5. The Idioms no puede ganar etimología;
6. `anything` puede quedar sin imagen;
7. `piece of cake` rechaza una fotografía literal sin evidencia figurativa;
8. `apple` selecciona una fotografía relevante de Openverse y descarta un
   resultado de noticias de Bing.

## 6. Validación realizada

### Prueba focalizada

```text
npx vitest run tests/unit/enrichment-orchestrator.test.ts
18 pruebas aprobadas
```

### Suite completa

```text
npm test
20 archivos aprobados
202 pruebas aprobadas
```

El mensaje de error de red mostrado por `phonetic-augment.test.ts` corresponde
a una prueba deliberada del fallback cuando falla `fetch`; la prueba terminó
correctamente.

### Compilación

```text
npm run build
1798 módulos transformados
compilación completada correctamente
```

Vite mantiene una advertencia previa: `ai-providers.ts` se importa tanto de
forma dinámica como estática y por eso no se separa en otro chunk. No fue
causada por esta fase.

## 7. Qué cambió realmente en la calidad A/B

| Campo | Antes | Después | Estado |
|---|---|---|---|
| Sinónimos | una fuente C podía aparecer sola | C requiere consenso o respaldo A/B | endurecido |
| Antónimos | una fuente C podía aparecer sola | C requiere consenso o respaldo A/B | endurecido |
| Etimología | ganaba el primer proveedor elegible | prioridad editorial explícita | endurecido |
| Imágenes | primera URL no vacía | ranking, blacklist y campo vacío permitido | base implementada |
| Frecuencia | sólo supuesto rango numérico | evidencias tipadas por escala | contrato preparado |

## 8. Trabajo que no se hizo en esta fase

Para evitar confundir infraestructura con calidad ya completada, queda
explícitamente fuera de este cambio:

- scraping de Cambridge Thesaurus;
- scraping de Merriam-Webster Thesaurus;
- extracción de bloques THESAURUS de Longman;
- extracción de bandas Longman `S1–S3` y `W1–W3`;
- migración de Openverse/Wikimedia/Bing/DDG a múltiples candidatos;
- WSD general por definición, oración y POS;
- relaciones asociadas a `senseId`;
- atribución visible de la etimología ganadora;
- reclasificación de Britannica de Standard a VIP.

## 9. Próxima fase recomendada

Orden recomendado para continuar sin aumentar ruido:

1. migrar Openverse y Wikimedia Commons a `imageCandidates` con metadatos;
2. añadir pruebas de imagen del corpus completo antes de migrar Bing/DDG;
3. extraer Cambridge Thesaurus por grupos conceptuales y seleccionar el grupo
   contra oración/definición;
4. extraer Merriam-Webster Thesaurus por bloques `as in ...`;
5. ampliar Longman con bandas de frecuencia y bloques de thesaurus/collocation;
6. añadir un contrato opcional de relaciones por sentido sin romper las listas
   planas actuales;
7. mover Britannica a VIP después de revisar defaults, UI, caché y pruebas de
   tiers.

## Criterio de aceptación de esta fase

La fase se considera aprobada porque las fuentes C ya no pueden llenar por sí
solas sinónimos o antónimos, una etimología débil no gana por orden de llegada y
la ausencia de imagen se trata como un resultado válido. Esto reduce la
cobertura aparente, pero aumenta la fiabilidad visible de la tarjeta y alinea el
merge con el objetivo A/B.
