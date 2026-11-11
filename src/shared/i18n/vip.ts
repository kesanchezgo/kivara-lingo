/**
 * i18n area: vip — VIP sources and tiers
 *
 * Split out of the flat dictionary in F0 (docs/REDESIGN-V2.md §3 H6) so the
 * service worker can carry only the strings it emits.
 */
import type { AreaDict } from './types';

export const vip: AreaDict = {
  es: {
    "vipx.err401": "401 · Clave de API no válida o ausente",
    "vipx.err403": "403 · Bloqueado por Cloudflare (reto anti-bot)",
    "vipx.err404": "404 · La fuente ya no existe",
    "vipx.err429": "429 · Límite de peticiones (cuota compartida)",
    "vipx.err5xx": "503 · Servicio no disponible",
    "vipx.errCors": "Sin acceso al sitio",
    "vipx.errNetwork": "Sin conexión con la fuente",
    "vipx.errTimeout": "Sin respuesta en {s} s",
    "vipx.grantAll": "Conceder todo",
    "vipx.healthTitle": "Estado de las fuentes",
    "vipx.justNow": "ahora mismo",
    "vipx.lastChecked": "comprobado {when}",
    "vipx.minAgo": "hace {n} min",
    "vipx.never": "nunca",
    "vipx.permSummary": "{on}/{total} grupos concedidos",
    "vipx.permWhatBody": "Permiso de Chrome para que la extensión contacte con los servidores de esas fuentes. Chrome exige un clic tuyo para concederlo (no puede ser automático); la extensión te lo pide sola al activar una fuente que lo necesita. Aquí puedes revisarlo o revocarlo.",
    "vipx.slow": "Respuesta lenta ({s} s)",
    "vipx.status_degraded": "Degradada",
    "vipx.status_error": "Error",
    "vipx.status_ok": "Funciona",
    "vipx.status_untested": "Sin probar",
    "vipx.testSources": "Probar fuentes",
  },
  en: {
    "vipx.err401": "401 · Invalid or missing API key",
    "vipx.err403": "403 · Blocked by Cloudflare (bot challenge)",
    "vipx.err404": "404 · The source is gone",
    "vipx.err429": "429 · Rate limit reached (shared quota)",
    "vipx.err5xx": "503 · Service unavailable",
    "vipx.errCors": "No access to the site",
    "vipx.errNetwork": "Cannot reach the source",
    "vipx.errTimeout": "No answer within {s}s",
    "vipx.grantAll": "Grant all",
    "vipx.healthTitle": "Source status",
    "vipx.justNow": "just now",
    "vipx.lastChecked": "checked {when}",
    "vipx.minAgo": "{n} min ago",
    "vipx.never": "never",
    "vipx.permSummary": "{on}/{total} groups granted",
    "vipx.permWhatBody": "Chrome permission that lets the extension reach those sources' servers. Chrome requires a click from you to grant it (it can't be automatic); the extension asks by itself when you enable a source that needs it. Review or revoke it here.",
    "vipx.slow": "Slow response ({s} s)",
    "vipx.status_degraded": "Degraded",
    "vipx.status_error": "Error",
    "vipx.status_ok": "Working",
    "vipx.status_untested": "Not tested",
    "vipx.testSources": "Test sources",
  },
};
