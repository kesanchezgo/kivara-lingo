# Atribuciones

Este archivo lista cada dato de terceros que se distribuye dentro del paquete
de la extensión, con su licencia. Es la referencia que se compara con el
código: todos estos archivos viven en `src/assets/` y se empaquetan tal cual.

> Nota: este documento ya no menciona Figma Make, shadcn/ui ni Unsplash. La
> extensión no incluye componentes de shadcn ni fotos de Unsplash; esas dos
> líneas eran resto de la plantilla con la que se empezó el proyecto.

## 1. Datos lingüísticos empaquetados

### Open English WordNet 2025

`src/assets/wordnet/*.json` — índice por letra con synset, parte del discurso,
definición, ejemplos, sinónimos y antónimos.

- © 2019–presente The Open English WordNet Team.
- Derivado de Princeton WordNet 3.1, © 2011 Princeton University.
- Licencia: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
- Fuente: https://en-word.net/
- Textos de licencia completos dentro del propio paquete:
  `src/assets/wordnet/LICENSE.md` y `src/assets/wordnet/WNDB_License.txt`.
- Modificaciones: conversión a JSON indexado por inicial y reducción de
  columnas. No hay implicación de respaldo por parte de Princeton University ni
  del equipo de Open English WordNet.

### Oxford 3000 / 5000 (nivel CEFR)

`src/assets/dictionaries/en-cefr.json` — superposición de nivel CEFR (A2 para
Oxford 3000, B2 para Oxford 5000) que usa `dictionary.ts` para rellenar
`entry.level`.

- Origen: lista pública `jnoodle/English-Vocabulary-Word-List`, que reconstruye
  las listas oficiales de Oxford (© Oxford University Press) a partir de
  material publicado por Oxford.
- Oxford 3000™ y Oxford 5000™ son marcas de Oxford University Press. Las listas
  aquí incluidas provienen de una reconstrucción pública de terceros, no de una
  distribución autorizada por Oxford, y se usan solo como metadato de nivel.

### NTC's American Idioms Dictionary

`src/assets/dictionaries/en-idioms.json` — 1 618 expresiones idiomáticas con
definición y ejemplo; 1 614 en el corte HOT que se envía y el resto (COLD)
como candidatas de carga diferida.

- Origen: `zaghloul404/englishidioms` (material de investigación / CC0).
- Modificaciones: filtrado a frases de sentido único y uso común, y marcado
  HOT/COLD según el corpus de subtítulos.
- Uso: detección de idioms y glosas en inglés. Atribución conservada aquí y
  en el propio archivo.

### Academic Collocation List (ACL)

`src/assets/collocations/academic-collocation-list.json` — las 2 469
colocaciones más frecuentes del inglés académico.

- Fuente: Ackermann, K. & Chen, Y. (2013), *Developing the Academic Collocation
  List (ACL) — A corpus-driven and expert-judged approach*, Journal of English
  for Academic Purposes. Acceso abierto.
- Modificaciones: mapeo a headword y descarte de las colocaciones por debajo
  del umbral que usa la extensión.

### MWEs de Wiktionary (índice de títulos)

`src/assets/mwes/en-mwe-index.json` — **unas 13 500 títulos de expresiones
multi-palabra** (idioms, phrasal verbs, proverbs) que el tokenizador usa para
reconocer un span como MWE. El archivo contiene solo los títulos, en minúsculas
y deduplicados.

- **Fuente:** Wiktionary (en.wiktionary.org), enumeración de las categorías
  `Category:English_idioms`, `Category:English_phrasal_verbs` y
  `Category:English_proverbs`, que es exactamente lo que consulta
  `scripts/build-mwe-index.cjs`.
- **Licencia: CC BY-SA 4.0**
  (https://creativecommons.org/licenses/by-sa/4.0/).
- **Modificación:** se conservan únicamente los títulos, normalizados a
  minúsculas y deduplicados. Nada más del artículo de Wiktionary se distribuye.
- **Aviso de ShareAlike:** este archivo concreto se distribuye bajo CC BY-SA 4.0,
  **no** bajo la licencia MIT del código de la extensión; la obligación de
  ShareAlike viaja con él.

### Oxford Phrasal Academic Lexicon

`src/assets/mwes/en-phrasal-academic.json` — MWE académicas de alta frecuencia
con su token, nivel y traducción.

- Origen: lista pública `jnoodle/English-Vocabulary-Word-List` (lista curada de
  acceso público; declarada en el `_meta` del propio JSON).
- Uso: que el tokenizador trate el chunk académico como una unidad.

### Diccionario MWE del proyecto

`src/assets/mwes/en.json` — glosas, traducciones y ejemplos de phrasal verbs y
MWE.

- Obra propia: redactado por el proyecto. No contiene texto de Wiktionary ni de
  Oxford; el índice de títulos de Wiktionary es una lista aparte
  (`en-mwe-index.json`) con su propia licencia.

### Tesauro overlay

`src/assets/thesaurus/en-thesaurus.json` — sinónimos y antónimos por acepción.

- Fuente: *Fernald's English Synonyms, Antonyms and Prepositions* (1896),
  dominio público.
- Modificaciones: agrupación por acepción y recorte de acepciones obsoletas.

### Diccionario base y extensiones

`src/assets/dictionaries/en.json` y `en-extensions.json` — entradas base y
paquete de extensión (phrasal verbs, vocabulario B2/C1, slang y
contracciones).

- Obra propia: redactado por el proyecto. Las definiciones y traducciones de
  estos archivos son originales, no extraídas de un diccionario con copyright.

### Paquetes Yomitan instalables

Los paquetes de diccionario (Wiktionary, etc.) no se distribuyen dentro de la
extensión: el usuario los descarga a demanda desde su origen, con su propia
licencia. Esta lista no altera la de cada paquete.

### OpenSubtitles FrequencyWords (lista de frecuencias EN)

`src/assets/frequency/en-rank.json` — rango de frecuencia por lema (objeto
`{ "<lema>": <rango> }` más `_meta`), la escala que usan el estimador de
vocabulario y la banda de nivel (`src/shared/study/lexicalModel.ts`).

- **Fuente:** OpenSubtitles FrequencyWords de HermitDave,
  https://github.com/hermitdave/FrequencyWords (corpus de subtítulos de
  OpenSubtitles, 2018).
- URL exacta del fichero de origen:
  https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt
- **Licencia: CC BY-SA 4.0**
  (https://creativecommons.org/licenses/by-sa/4.0/).
- **Modificaciones:** se descartan las fichas que no son palabras (fragmentos
  de contracción como `'s` o `'t`, abreviaturas con punto, formas con guion,
  ruido tipográfico), se toman las 28 000 formas superficiales más frecuentes,
  se lematizan con `src/content/nlp/lemma.ts` (candidatos del lematizador
  propio, con puertas de precisión: la base debe existir en la propia lista y
  no ser una palabra funcional mucho más frecuente) y el rango de cada lema es
  la posición de su forma superficial más frecuente en la lista original. El
  resultado son 21 731 lemas.
- **Generación:** `pnpm exec tsx scripts/build-frequency.ts` (determinista;
  admite `--input` para reconstruir sin red y `--top` para cambiar el corte).
- **Aviso de ShareAlike:** este archivo se distribuye bajo CC BY-SA 4.0, **no**
  bajo la licencia MIT del código de la extensión; la obligación de
  ShareAlike viaja con él y con todo trabajo derivado (el banco de la prueba
  de vocabulario, más abajo).

### Falsos amigos ES↔EN

`src/assets/study/es-en-false-friends.json` — 311 pares de falsos amigos y
falsos amigos parciales entre inglés y español (`en`, `es`, `note`).

- Obra propia: redactado para el proyecto a partir del repertorio clásico de
  falsos amigos de la lexicografía de aprendices. Ninguna entrada copia texto
  de un diccionario con copyright; las notas son originales.
- Licencia: MIT, la misma del código.
- Validación: `pnpm exec tsx scripts/build-false-friends.ts` (forma, notas de
  una línea, unicidad de `en`, recuento frente a `_meta.count`).

### Banco de la prueba de vocabulario y pseudopalabras

`src/assets/study/vocab-bank.json` — 160 lemas en 4 franjas de frecuencia
(40 por franja, muestreo determinista con semilla fija) y 60 pseudopalabras.

- **Los 160 lemas derivan de la lista de frecuencias de OpenSubtitles**, así
  que este archivo se distribuye bajo **CC BY-SA 4.0**, con el mismo aviso de
  ShareAlike que `en-rank.json`. El nivel CEFR de cada palabra no es una
  escala nueva: es la etiqueta más cercana en la escala `LABEL_RANK` que ya
  usa `src/shared/study/lexicalModel.ts`.
- **Las 60 pseudopalabras son obra propia** (MIT): se generaron una vez con un
  modelo silábico y se revisaron a mano; el script comprueba en cada
  ejecución que no colisionan con ningún lema de la lista de frecuencias ni
  con ninguna entrada del diccionario empaquetado.
- Generación: `pnpm exec tsx scripts/build-vocab-bank.ts` (determinista, sin
  red).

## 2. Código de terceros

Dependencias de npm, enumeradas en `package.json` con sus licencias.

### Inter (tipografía variable)

`src/assets/fonts/kivara-inter-*.woff2` — subconjuntos `latin` y `latin-ext`
de Inter, empaquetados dentro de la extensión y registrados en tiempo de
ejecución con la API `FontFace` bajo el nombre `Kivara Inter` (ver
`src/ui/fonts.ts`). Se sirve en local a propósito: ninguna pantalla de
streaming hace una petición a Google Fonts (ver `PRIVACY.md`).

- © 2016–presente The Inter Project Authors (https://github.com/rsms/inter).
- Licencia: SIL Open Font License 1.1 — https://openfontlicense.org
- Subconjuntos: build oficial de Fontsource (`@fontsource-variable/inter`).

### Phosphor Icons

Los iconos de la interfaz son de Phosphor Icons, envueltos por
`src/ui/icons.tsx` detrás de la API estilo lucide que usan los componentes.

- © Phosphor Icons (https://phosphoricons.com).
- Licencia: MIT.

## 3. Licencia del paquete

El **código** de la extensión es MIT (ver `LICENSE`). Los **datos** no: cada
conjunto lingüístico conserva la licencia indicada arriba, y
`src/assets/mwes/en-mwe-index.json` (Wiktionary) se distribuye bajo CC BY-SA
4.0 con la obligación de ShareAlike que eso implica. Lo mismo vale para
`src/assets/frequency/en-rank.json` y `src/assets/study/vocab-bank.json`, que
derivan de OpenSubtitles FrequencyWords y llevan el mismo CC BY-SA 4.0;
`src/assets/study/es-en-false-friends.json` es obra propia y va con MIT.
