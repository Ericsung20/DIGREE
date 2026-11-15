import type {CSSProperties} from 'react';

const cache = new Map<string, CSSProperties>();

/**
 * Turns a CSS declaration string into a React style object.
 * The screens keep the design file's inline styles as written, so the two can be compared line by line.
 */
export function s(text: string): CSSProperties {
  const hit = cache.get(text);
  if (hit) return hit;
  const style: Record<string, string> = {};
  let depth = 0;
  let start = 0;
  const take = (end: number) => {
    const declaration = text.slice(start, end);
    const colon = declaration.indexOf(':');
    if (colon < 0) return;
    const property = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    if (!property || !value) return;
    style[property.startsWith('--') ? property : property.replace(/^-/, '').replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()).replace(/^webkit/, 'Webkit')] = value;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ';' && depth === 0) {
      take(i);
      start = i + 1;
    }
  }
  take(text.length);
  cache.set(text, style as CSSProperties);
  return style as CSSProperties;
}
