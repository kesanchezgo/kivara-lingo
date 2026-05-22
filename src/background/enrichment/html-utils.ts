/**
 * Service-worker-safe HTML extraction helpers.
 *
 * The MV3 service worker doesn't expose `DOMParser` in every Chrome
 * build. Sources that need to parse HTML use these regex-based helpers
 * instead. They're not a full DOM — but they're enough for the targeted
 * extraction patterns the dictionary scrapes need (single attribute,
 * inner text of a class, all matching elements).
 *
 * Each helper is forgiving on edge cases (malformed HTML, missing
 * attributes, nested same-tag elements) and never throws.
 */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&hellip;': '…',
  '&mdash;': '—',
  '&ndash;': '–',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&rdquo;': '”',
  '&ldquo;': '“',
};

/** Strip HTML tags and decode common entities. Best-effort, never throws. */
export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&[a-z][a-z0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find every element with `class="x"` (whitespace-flexible) and return
 * their inner HTML. Use `stripHtml` on the result to get plain text.
 *
 * Notes on scope:
 *   - Matches both `class="x"` and `class="a x b"` (whole-word).
 *   - Falls through nested same-tag elements; the regex tracks balance
 *     by counting opens/closes on the same tag name.
 */
export function extractByClass(
  html: string,
  className: string,
  /** Optional tag name filter, e.g. 'span', 'div'. */
  tag = '[a-z][a-z0-9]*',
): string[] {
  if (!html || !className) return [];
  const out: string[] = [];
  const escaped = className.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  // Match: `<tag ... class="... ${className} ..." ...>` then inner HTML
  // then `</tag>`. We grab the inner non-greedy and then balance with
  // a counter pass below.
  const re = new RegExp(
    `<(${tag})\\b[^>]*\\bclass\\s*=\\s*("|')(?:[^"']*\\s)?${escaped}(?:\\s[^"']*)?\\2[^>]*>`,
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tagName = m[1].toLowerCase();
    const start = m.index + m[0].length;
    const inner = sliceBalanced(html, tagName, start);
    if (inner !== null) out.push(inner);
  }
  return out;
}

/**
 * Slice the HTML between `start` and the matching `</tag>`, accounting
 * for nested same-tag opens/closes.
 */
function sliceBalanced(html: string, tag: string, start: number): string | null {
  const openRe = new RegExp(`<${tag}\\b`, 'gi');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 1;
  let i = start;
  // Cap iterations so a malformed page can't make us loop forever.
  let iterations = 0;
  while (depth > 0 && i < html.length && iterations < 10000) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const open = openRe.exec(html);
    const close = closeRe.exec(html);
    if (!close) return null;
    if (open && open.index < close.index) {
      depth += 1;
      i = open.index + open[0].length;
    } else {
      depth -= 1;
      if (depth === 0) return html.slice(start, close.index);
      i = close.index + close[0].length;
    }
    iterations += 1;
  }
  return null;
}

/**
 * Extract values of `attr` from every tag matching the class filter.
 * E.g. `<source class="audio" src="…">` → `selectAttrByClass(html, 'audio', 'src')`.
 */
export function extractAttrByClass(
  html: string,
  className: string,
  attr: string,
  tag = '[a-z][a-z0-9]*',
): string[] {
  if (!html) return [];
  const out: string[] = [];
  const escClass = className.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const escAttr = attr.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp(
    `<${tag}\\b[^>]*\\bclass\\s*=\\s*("|')(?:[^"']*\\s)?${escClass}(?:\\s[^"']*)?\\1[^>]*\\b${escAttr}\\s*=\\s*("|')([^"']*)\\2`,
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[3]) out.push(m[3]);
  }
  // Also try the reverse order (attr appears before class in the tag).
  const re2 = new RegExp(
    `<${tag}\\b[^>]*\\b${escAttr}\\s*=\\s*("|')([^"']*)\\1[^>]*\\bclass\\s*=\\s*("|')(?:[^"']*\\s)?${escClass}(?:\\s[^"']*)?\\3`,
    'gi',
  );
  while ((m = re2.exec(html))) {
    if (m[2]) out.push(m[2]);
  }
  return Array.from(new Set(out));
}

/**
 * Pull the value of `attr` from a single tag identified by an arbitrary
 * `tag[attr*="needle"]` style key — used when sources put the data we
 * want in `<meta property="og:image" content="…">`-style nodes.
 */
export function extractMeta(
  html: string,
  property: string,
): string | null {
  if (!html) return null;
  const escProp = property.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  // <meta property="..." content="...">
  let m = new RegExp(
    `<meta[^>]*\\b(?:property|name)\\s*=\\s*("|')${escProp}\\1[^>]*\\bcontent\\s*=\\s*("|')([^"']*)\\2`,
    'i',
  ).exec(html);
  if (m) return m[3];
  // <meta content="..." property="...">
  m = new RegExp(
    `<meta[^>]*\\bcontent\\s*=\\s*("|')([^"']*)\\1[^>]*\\b(?:property|name)\\s*=\\s*("|')${escProp}\\3`,
    'i',
  ).exec(html);
  return m ? m[2] : null;
}

/**
 * Extract every `href` from `<a class="cl" href="...">…</a>` and return
 * `{ href, text }` pairs. Used by Cambridge/Reverso to grab "more like
 * this" links and synonyms lists.
 */
export function extractAnchorsByClass(
  html: string,
  className: string,
): Array<{ href: string; text: string }> {
  if (!html) return [];
  const out: Array<{ href: string; text: string }> = [];
  const esc = className.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp(
    `<a\\b[^>]*\\bclass\\s*=\\s*("|')(?:[^"']*\\s)?${esc}(?:\\s[^"']*)?\\1[^>]*\\bhref\\s*=\\s*("|')([^"']*)\\2[^>]*>([\\s\\S]*?)<\\/a>`,
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out.push({ href: m[3], text: stripHtml(m[4]) });
  }
  return out;
}

/**
 * `decodeEntities` exposed standalone for sources that already extracted
 * raw text (e.g. JSON-LD bodies) and just need the entities resolved.
 */
export function decodeEntities(s: string): string {
  if (!s) return '';
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&[a-z][a-z0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);
}
