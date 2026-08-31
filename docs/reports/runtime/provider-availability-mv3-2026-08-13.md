# Disponibilidad real de proveedores protegidos — MV3 — 2026-08-13

## Método

Las consultas se ejecutaron desde el `service worker` real de la extensión en
Chromium, usando el puerto `kvl-resolve-word`. Cada proveedor se aisló junto con
`bundled`; la selección activa quedó registrada en cada JSON.

Protecciones del auditor:

- perfil de Chromium aislado y persistente en `.audit/mv3-profile`;
- caché normal habilitada;
- ninguna llamada a `chrome.storage.*.clear()`;
- respaldo y restauración exacta de `kivara-lingo-state`;
- conservación deliberada de cooldowns y contadores locales;
- una consulta por proveedor y esperas secuenciales;
- Linguee no se vuelve a consultar durante su cooldown.

## Resultados de disponibilidad

| Proveedor | Resultado MV3 | Campos observados | Conclusión |
|---|---|---|---|
| Dictionary.com | 200 | IPA, audio, definiciones, ejemplos | Disponible; reemplazo operativo de Collins |
| Merriam-Webster | 200 | IPA, audio, definiciones, ejemplos, etimología | Disponible; el 403 de Node era falso negativo |
| Reverso | 200 | traducciones, ejemplos bilingües | Disponible; el 403 de Node era falso negativo |
| WordReference | 200 | traducciones, ejemplos bilingües | Disponible; el 418 de Node era falso negativo |
| Forvo | 200 | audio humano | Disponible; el 403 de Node era falso negativo |
| PROMT Contexts | 200 | ejemplos bilingües alineados | Disponible; fallback operativo de Linguee |
| Britannica | 403 challenge y 200 en ejecuciones separadas | audio, definiciones y ejemplos cuando responde | Intermitente; no debe contarse como cobertura garantizada |
| Linguee | 429 | — | Limitación real por IP/servidor; cooldown persistente de 6 h activo |

## Robustez aplicada

### Britannica

Cuando la respuesta incluye `cf-mitigated: challenge`, se abre un circuit
breaker persistente de 10 minutos. Un `429` abre el circuito durante una hora.
Mientras está abierto no se vuelve a contactar al sitio por cada palabra; el
orquestador continúa con Cambridge, Oxford, Longman, Dictionary.com,
Merriam-Webster y las fuentes locales.

El circuito es corto porque Britannica también respondió `200` desde el mismo
runtime en otra ejecución. No se intenta resolver ni evadir el desafío de
Cloudflare.

### Linguee

La primera consulta aislada del perfil recibió `429` y activó correctamente el
cooldown persistente de seis horas. Una ejecución posterior fue clasificada
como `local-cooldown` y no produjo ninguna solicitud HTTP. PROMT Contexts cubre
los ejemplos bilingües durante ese periodo con intervalo mínimo de 3 segundos,
límite de 30 consultas por hora y cooldown propio tras `429`.

## Evidencia

- `mv3-enrichment-audit-2026-08-13T04-25-32-033Z.json`
- `mv3-enrichment-audit-2026-08-13T04-26-09-989Z.json`
- `mv3-enrichment-audit-2026-08-13T04-28-27-880Z.json`
- `mv3-enrichment-audit-2026-08-13T04-29-18-325Z.json`
- `mv3-enrichment-audit-2026-08-13T04-29-55-424Z.json`

## Estado de la auditoría de calidad

Esta fase valida disponibilidad y degradación, no aprueba todavía la calidad
semántica completa. La observabilidad nueva conserva en `entrySample.vip` los
candidatos, su campo y su fuente para la siguiente revisión proveedor por
proveedor.

Hallazgo inicial que debe entrar en esa revisión: Britannica devolvió varios
sentidos válidos de `support`, incluido “to agree with or approve of”, pero para
“Her family supported the decision” la tarjeta conservó primero la definición
local física “To help keep from falling”. Esto demuestra por qué presencia de
campo no equivale a calidad contextual y debe evaluarse separadamente en el
corpus final.
