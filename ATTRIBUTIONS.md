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

`src/assets/dictionaries/en-idioms.json` — 21 866 expresiones idiomáticas con
definición y ejemplo, filtradas a frases de sentido único y uso común.

- Origen: `zaghloul404/englishidioms` (material de investigación / CC0).
- Uso: detección de idioms y glosas en inglés. Atribución conservada aquí y en
  el `_meta` del propio JSON.

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

## 2. Código de terceros

Dependencias de npm, enumeradas en `package.json` con sus licencias.

## 3. Licencia del paquete

El **código** de la extensión es MIT (ver `LICENSE`). Los **datos** no: cada
conjunto lingüístico conserva la licencia indicada arriba, y
`src/assets/mwes/en-mwe-index.json` (Wiktionary) se distribuye bajo CC BY-SA
4.0 con la obligación de ShareAlike que eso implica.
