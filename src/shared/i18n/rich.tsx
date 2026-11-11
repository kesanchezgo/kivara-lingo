import React from 'react';

/**
 * One translatable sentence with `{name}` holes for the formatted parts
 * (bold, code, paths): `richText(t(key), { url: <code>…</code> })`.
 * Never split sentences into fragments — word order changes between languages.
 */
export function richText(text: string, parts: Record<string, React.ReactNode>): React.ReactNode[] {
  return text.split(/(\{\w+\})/).map((piece, i) => {
    const m = /^\{(\w+)\}$/.exec(piece);
    return <React.Fragment key={i}>{m && m[1] in parts ? parts[m[1]] : piece}</React.Fragment>;
  });
}
