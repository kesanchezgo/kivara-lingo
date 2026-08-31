# Auditoría live de proveedores y tarjeta final — 2026-08-12

## Alcance

Corpus real EN→ES: `give`, `wonderful`, `anything`, `anybody`, `week`,
`know`, `run`, `break up` y `piece of cake`.

Se ejecutaron dos recorridos:

1. los 37 módulos remotos individualmente, conservando payloads y muestras en
   `docs/reports/enrichment-source-audit-2026-08-12.json`;
2. el flujo real del orquestador para Standard y VIP, con tarjeta y atribución
   completas en `enrichment-merge-probe-2026-08-13.json`.

No se borró el cooldown real de Linguee. El recorrido individual original se
hizo desde Node y sirve para evaluar parsers y APIs abiertas, pero no para
determinar la disponibilidad de sitios protegidos por huella TLS/HTTP. Esa
clasificación se corrigió el 2026-08-13 con Chromium y el service worker MV3
real; los informes reproducibles están en `docs/reports/runtime/`. Unsplash y
Pixabay se probaron sin claves porque no hay credenciales de auditoría
configuradas.

## Estado por proveedor

| Proveedor | Datos/casos | Campos observados | Evaluación |
|---|---:|---|---|
| Free Dictionary | 8/9 | definición, ejemplos, IPA, audio, sin./ant. | Buena base; relaciones semánticas requieren ranking |
| Datamuse | 7/9 | sinónimos, antónimos, colocaciones | Útil como señal secundaria, no como autoridad única |
| Wiktionary REST | 7/9 | definición, ejemplos | Buena cobertura común; irregular en MWE |
| Wiktionary HTML | 5/9 | etimología, relacionados, sin./ant. | Valioso pero parser/cobertura variable |
| FreeDictionaryAPI | 9/9 | definición, ejemplos, IPA, sin./ant. | Muy buena cobertura, incluso MWE |
| WiktAPI | 7/9 | definición, traducción, ejemplos, IPA, audio | Rico; traducciones necesitan ancla local |
| Britannica | MV3 intermitente | definición, ejemplos, IPA, audio cuando responde | Cloudflare alternó 403 challenge y 200; circuit breaker persistente evita repetir el desafío durante 10 min |
| Moby Thesaurus | 9/9 | sinónimos | Cobertura alta pero asociaciones demasiado amplias; sólo fallback |
| Thesaurus.com | 7/9 | sinónimos, antónimos | Útil, con ruido por polisemia |
| WordHippo | 8/9 | antónimos | Bueno especialmente para frases; algunas relaciones son perifrásticas |
| The Idioms | 2/9 | definición, etimología | Útil sólo para idioms; afirmaciones etimológicas deben tratarse con cautela |
| Etymonline | 7/9 | etimología | Fuente principal sólida para palabras simples |
| Tatoeba | 9/9 | ejemplos bilingües | Cobertura y alineación altas |
| Lingua Libre | 2/9 | audio humano | Cobertura baja, calidad alta cuando existe |
| Google TTS | 9/9 | audio sintético | Fallback completo; nunca debe desplazar audio humano |
| YouGlish | 9/9 | enlace de vídeo | Cobertura completa, no es audio descargable |
| Bing Images | 9/9 | imagen | Cobertura alta, relevancia desigual para abstractos |
| Openverse | 9/9 | imagen | Cobertura alta y licencia trazable; relevancia variable |
| Wikimedia Commons | 4/9 | imagen | Menor cobertura, procedencia fuerte |
| DuckDuckGo Images | 9/9 | imagen | Cobertura alta; relevancia y estabilidad variables |
| Cambridge | 9/9 | definición, traducción, ejemplos, IPA | Fuente editorial principal; muy buena calidad |
| Oxford Learner's | 8/9 | definición, ejemplos, colocaciones, IPA, audio | Muy buena calidad pedagógica |
| Longman | 8/9 | definición, ejemplos, colocaciones, IPA, audio | Excelente vocabulario definitorio; se excluyeron audios de ejemplos |
| Dictionary.com | 9/9 | definición, ejemplos, IPA, audio | Reemplazo funcional de Collins; se bloqueó audio de fallback ajeno |
| Merriam-Webster | MV3 2/2 | definición, ejemplos, IPA, audio, etimología | Disponible con HTTP 200; el 403 de Node era un falso negativo de entorno |
| Ozdic | 7/9 | definición, ejemplos, colocaciones | Buena materia prima; contiene frames que deben filtrarse |
| PONS | 9/9 | traducción, ejemplos, colocaciones | Rico pero mezcla glosas, frames y frases; requiere limpieza |
| bab.la | 9/9 | traducción, audio | Traducciones útiles; se impidió audio sin evidencia léxica |
| dict.cc | 7/9 | traducción, colocaciones | Glosas compactas, menor cobertura de MWE |
| Reverso | MV3 1/1 | traducción, ejemplos bilingües | Disponible con HTTP 200; el 403 de Node era un falso negativo de entorno |
| Linguee | MV3 0/1 | — | HTTP 429 real incluso con consulta aislada; cooldown persistente de 6 h activado y conservado |
| PROMT Contexts | MV3 1/1 | ejemplos bilingües | HTTP 200 y pares alineados; intervalo persistente de 3 s y límite de 30/h |
| WordReference | MV3 1/1 | traducción, ejemplos bilingües | Disponible con HTTP 200; el 418 de Node era un falso negativo de entorno |
| SpanishDict | 7/9 | traducción, ejemplos | Buena calidad para palabras comunes, débil en MWE |
| Forvo | MV3 1/1 | audio humano | Disponible con HTTP 200; el 403 de Node era un falso negativo de entorno |
| Unsplash | 0/9 | — | No evaluable sin clave BYOK |
| Pixabay | 0/9 | — | No evaluable sin clave BYOK |

## Hallazgos de la tarjeta

### Aprobado

- Las nueve traducciones primarias son correctas en contexto.
- VIP ya no degrada las glosas locales de `run`, pronombres indefinidos ni
  idioms.
- Los ejemplos principales contienen el token o su forma flexionada y, en VIP,
  predominan pares bilingües.
- `piece of cake` conserva ejemplos idiomáticos antes del ejemplo literal.
- El audio humano se ordena antes de TTS y se limita a dos pistas por fuente.
- El audio erróneo `wisenheimer` de Dictionary.com y los audios de ejemplos de
  Longman fueron eliminados.
- Las definiciones extensas se compactan para la cara de la tarjeta.

### Aún imperfecto

- Sinónimos y antónimos no están ligados a sentidos en el contrato actual de
  `SourcePartial`; la corroboración reduce ruido, pero no puede garantizar
  equivalencia contextual perfecta. Si una frase sólo recibe asociaciones de
  Moby sin corroboración, se omiten en vez de completar el campo con ruido.
- Algunas salidas de Ozdic/PONS/Longman son frames gramaticales más que
  colocaciones léxicas. Se añadieron filtros, pero este campo necesita revisión
  continua con corpus mayor.
- La relevancia de imágenes no puede validarse sólo por HTTP. En abstractos
  (`anything`, `know`, `week`) hubo resultados visuales poco pedagógicos.
- Un idiom puede recibir una imagen literal (`piece of cake`). Puede servir de
  mnemónico, pero no representa el significado figurado.
- `piece of cake` no obtuvo IPA humano en este entorno y cae a TTS.
- El IPA parcial `/breɪk/` de `break up` se omite porque no representa la
  frase completa.
- Las etimologías sin corroboración de The Idioms se omiten; en este corpus
  contradecían fuentes editoriales y presentaban afirmaciones históricas no
  fiables para `break up` y `piece of cake`.
- Linguee sí está limitado por el servidor en la red actual (`429`) y queda
  cubierto por PROMT Contexts mientras dura su cooldown. Britannica es
  intermitente por desafíos de Cloudflare; el circuit breaker evita solicitudes
  repetidas. Merriam-Webster, Reverso, WordReference y Forvo sí funcionan desde
  el service worker MV3 y no deben clasificarse como bloqueados.

## Criterio final

La tarjeta es fuerte en traducción, definición, ejemplos, audio común y
etimología. No debe considerarse completamente resuelta todavía en tres áreas:
relevancia semántica de imágenes, colocaciones estrictas y relaciones léxicas
por sentido. La disponibilidad protegida sólo debe concluirse con auditorías
MV3; Linguee y las respuestas intermitentes de Britannica no se cuentan como
cobertura garantizada, aunque sus fallos ya degradan sin bloquear la tarjeta.
