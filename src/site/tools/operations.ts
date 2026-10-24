import { parse, parseDocument, stringify } from 'yaml';
import {
  parse as parseJson,
  printParseErrorCode,
  format,
  applyEdits,
  type ParseError,
} from 'jsonc-parser';
import { parseCsv } from '../../shared/search-console.js';
import { base64Decode, base64Encode } from '../../shared/tools-crypto.js';
import { toolLimits, type ToolId } from '../../shared/tools-catalog.js';
export type ToolOptions = Record<string, string>;
export type ToolResult = { text: string; bytes?: ArrayBuffer; filename?: string; mime?: string };
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();
export function validateText(source: string) {
  if (encoder.encode(source).length > toolLimits.textBytes)
    throw new Error('Text inputs support up to 1 MiB.');
}
function json(source: string) {
  const errors: ParseError[] = [];
  const value: unknown = parseJson(source, errors, { allowTrailingComma: true });
  if (errors.length) {
    const error = errors[0];
    const before = source.slice(0, error.offset);
    throw new Error(
      `${printParseErrorCode(error.error)} · ${before.split('\n').length}:${before.length - before.lastIndexOf('\n')}`,
    );
  }
  if (value === undefined) throw new Error('Enter valid JSON or JSONC.');
  return value;
}
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
export function csvToJson(source: string) {
  const [headers, ...rows] = parseCsv(source, {
    preserveEmptyRows: true,
    maxFieldLength: toolLimits.textBytes,
  });
  if (!headers || headers.some((h) => !h.trim()) || new Set(headers).size !== headers.length)
    throw new Error('CSV needs unique, nonempty column headers.');
  return rows.map((row) => {
    if (row.length !== headers.length)
      throw new Error('CSV rows must have the same number of fields as the header.');
    return Object.fromEntries(headers.map((key, i) => [key, row[i]]));
  });
}
export function jsonToCsv(source: string) {
  const value = json(source);
  if (
    !Array.isArray(value) ||
    value.length > 10_000 ||
    value.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
  )
    throw new Error('CSV conversion needs an array of objects, up to 10,000 rows.');
  const keys = [...new Set(value.flatMap(Object.keys))];
  if (keys.length > 100) throw new Error('CSV supports up to 100 columns.');
  const cell = (value: unknown) => {
    const text =
      typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
    return !text || /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  return [
    keys.map(cell).join(','),
    ...value.map((row) => keys.map((key) => cell(row[key])).join(',')),
  ].join('\r\n');
}
export function parseColor(source: string): [number, number, number, number] {
  let match: RegExpMatchArray | null;
  if ((match = source.trim().match(/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i))) {
    let hex = match[1];
    if (hex.length < 5) hex = [...hex].map((c) => c + c).join('');
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1,
    ];
  }
  match = source.trim().match(/^(rgba?|hsla?)\(([^)]+)\)$/i);
  if (!match) throw new Error('Use HEX, RGB, RGBA, HSL or HSLA.');
  const parts = match[2].trim().split(/\s*[,/]\s*|\s+/);
  if (
    parts.length < 3 ||
    parts.length > 4 ||
    parts.some((p) => !/^-?(?:\d*\.)?\d+(?:%|deg)?$/.test(p))
  )
    throw new Error('Invalid color components.');
  const number = (i: number, max: number) =>
    parseFloat(parts[i]) * (parts[i].endsWith('%') ? max / 100 : 1);
  const alpha = parts[3] ? number(3, 1) : 1;
  if (
    parts[3]?.endsWith('deg') ||
    (match[1].toLowerCase().startsWith('rgb') &&
      parts.slice(0, 3).some((value) => value.endsWith('deg'))) ||
    (match[1].toLowerCase().startsWith('hsl') && parts[0].endsWith('%'))
  )
    throw new Error('Invalid color components.');
  if (alpha < 0 || alpha > 1) throw new Error('Alpha must be between 0 and 1.');
  if (match[1].toLowerCase().startsWith('rgb')) {
    const values = [0, 1, 2].map((i) => number(i, 255));
    if (values.some((n) => n < 0 || n > 255))
      throw new Error('RGB values must be between 0 and 255.');
    return [Math.round(values[0]), Math.round(values[1]), Math.round(values[2]), alpha];
  }
  if (!parts[1].endsWith('%') || !parts[2].endsWith('%'))
    throw new Error('HSL saturation and lightness need percentages.');
  const h = (((parseFloat(parts[0]) % 360) + 360) % 360) / 360,
    s = number(1, 1),
    l = number(2, 1);
  if (s < 0 || s > 1 || l < 0 || l > 1)
    throw new Error('HSL percentages must be between 0 and 100.');
  const hue = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round((l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  return [hue(0), hue(8), hue(4), alpha];
}
function colorResult(source: string, background: string) {
  const [r, g, b, a] = parseColor(source),
    bg = parseColor(background);
  if (bg[3] !== 1) throw new Error('Choose an opaque comparison background.');
  const max = Math.max(r, g, b) / 255,
    min = Math.min(r, g, b) / 255,
    delta = max - min,
    l = (max + min) / 2;
  const h = !delta
    ? 0
    : 60 *
      (max === r / 255
        ? ((g - b) / 255 / delta + 6) % 6
        : max === g / 255
          ? (b - r) / 255 / delta + 2
          : (r - g) / 255 / delta + 4);
  const s = !delta ? 0 : delta / (1 - Math.abs(2 * l - 1));
  const lum = (rgb: number[]) =>
    rgb
      .slice(0, 3)
      .map((n) => n / 255)
      .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
      .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
  const foreground = [r, g, b].map((n, i) => n * a + bg[i] * (1 - a)),
    first = lum(foreground),
    second = lum(bg);
  const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  return pretty({
    HEX:
      '#' +
      [r, g, b, ...(a < 1 ? [Math.round(a * 255)] : [])]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join(''),
    RGB: `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})`,
    HSL: `hsla(${+h.toFixed(1)}, ${+(s * 100).toFixed(1)}%, ${+(l * 100).toFixed(1)}%, ${+a.toFixed(3)})`,
    contrastRatio: +ratio.toFixed(2),
    AA: ratio >= 4.5,
    AAA: ratio >= 7,
    largeTextAA: ratio >= 3,
  });
}
export async function runTool(
  id: ToolId,
  source: string,
  options: ToolOptions = {},
): Promise<ToolResult> {
  validateText(source);
  const action = options.action || '';
  switch (id) {
    case 'json': {
      const value = json(source);
      return {
        text:
          action === 'minify'
            ? JSON.stringify(value)
            : applyEdits(
                source,
                format(source, undefined, {
                  tabSize: Number(options.indent || 2),
                  insertSpaces: true,
                  eol: '\n',
                }),
              ).trim(),
      };
    }
    case 'yaml': {
      if (action === 'to-yaml') return { text: stringify(json(source)) };
      const document = parseDocument(source, { uniqueKeys: true, schema: 'core', customTags: [] });
      if (document.errors.length) throw new Error(document.errors[0].message);
      if (document.warnings.length) throw new Error(document.warnings[0].message);
      // The core schema never instantiates classes or fetches external resources.
      const value = parse(source, { schema: 'core', maxAliasCount: 100, uniqueKeys: true });
      return { text: pretty(value) };
    }
    case 'csv':
      return { text: action === 'to-csv' ? jsonToCsv(source) : pretty(csvToJson(source)) };
    case 'url': {
      if (action === 'inspect') {
        const url = new URL(source);
        if (!['http:', 'https:'].includes(url.protocol))
          throw new Error('Enter an HTTP or HTTPS URL.');
        return {
          text: pretty({
            origin: url.origin,
            pathname: url.pathname,
            hash: url.hash,
            parameters: [...url.searchParams].map(([name, value]) => ({ name, value })),
          }),
        };
      }
      try {
        return {
          text: action === 'decode' ? decodeURIComponent(source) : encodeURIComponent(source),
        };
      } catch {
        throw new Error('Invalid URL encoding.');
      }
    }
    case 'base64': {
      if (action === 'decode' || action === 'file') {
        const bytes = base64Decode(source, options.urlSafe === 'true');
        if (bytes.length > toolLimits.fileBytes) throw new Error('Files support up to 25 MiB.');
        return action === 'file'
          ? {
              text: String(bytes.length),
              bytes: bytes.buffer,
              filename: 'decoded.bin',
              mime: 'application/octet-stream',
            }
          : { text: decoder.decode(bytes) };
      }
      return { text: base64Encode(encoder.encode(source), options.urlSafe === 'true') };
    }
    case 'jwt': {
      const parts = source.trim().split('.');
      if (parts.length !== 3)
        throw new Error('Enter a three-part JWT. Its signature will not be verified.');
      const header = JSON.parse(decoder.decode(base64Decode(parts[0], true))),
        claims = JSON.parse(decoder.decode(base64Decode(parts[1], true)));
      if (
        !header ||
        typeof header !== 'object' ||
        !claims ||
        typeof claims !== 'object' ||
        Array.isArray(header) ||
        Array.isArray(claims)
      )
        throw new Error('JWT header and claims must be JSON objects.');
      return {
        text: pretty({
          signatureVerified: false,
          header,
          claims,
          ...(typeof claims.exp === 'number'
            ? {
                expiresAt: new Date(claims.exp * 1000).toISOString(),
                expired: Date.now() > claims.exp * 1000,
              }
            : {}),
        }),
      };
    }
    case 'hash': {
      const hash = await crypto.subtle.digest(
        ['SHA-256', 'SHA-384', 'SHA-512'].includes(options.algorithm)
          ? options.algorithm
          : 'SHA-256',
        encoder.encode(source),
      );
      return {
        text: [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, '0')).join(''),
      };
    }
    case 'uuid': {
      const count = Number(source || 1);
      if (!Number.isInteger(count) || count < 1 || count > 1000)
        throw new Error('Choose between 1 and 1,000 UUIDs.');
      return { text: Array.from({ length: count }, () => crypto.randomUUID()).join('\n') };
    }
    case 'time': {
      let date: Date;
      if (/^-?\d+$/.test(source.trim())) {
        const number = Number(source);
        const multiplier =
          action === 'milliseconds' || (!action && Math.abs(number) >= 1e11) ? 1 : 1000;
        date = new Date(number * multiplier);
      } else {
        if (
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(source)
        )
          throw new Error('Use an ISO date with an explicit timezone, or a Unix timestamp.');
        const [year, month, day] = source.slice(0, 10).split('-').map(Number);
        const days = [
          31,
          year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
          31,
          30,
          31,
          30,
          31,
          31,
          30,
          31,
          30,
          31,
        ];
        if (!days[month - 1] || day < 1 || day > days[month - 1])
          throw new Error('Invalid timestamp.');
        date = new Date(source);
      }
      if (!Number.isFinite(date.getTime())) throw new Error('Invalid timestamp.');
      return {
        text: pretty({
          ISO: date.toISOString(),
          seconds: date.getTime() / 1000,
          milliseconds: date.getTime(),
          UTC: date.toUTCString(),
          local: date.toString(),
        }),
      };
    }
    case 'number': {
      const base = Number(options.base || 10),
        negative = source.trim().startsWith('-'),
        digits = source
          .trim()
          .replace(/^-/, '')
          .replace(/^0[xob]/i, '');
      const expressions: Record<number, RegExp> = {
        2: /^[01]+$/,
        8: /^[0-7]+$/,
        10: /^\d+$/,
        16: /^[\da-f]+$/i,
      };
      const prefix = source
        .trim()
        .replace(/^-/, '')
        .match(/^0([xob])/i)?.[1]
        .toLowerCase();
      if (prefix && ({ x: 16, o: 8, b: 2 } as Record<string, number>)[prefix] !== base)
        throw new Error('Enter a valid integer with up to 4,096 digits.');
      if (!expressions[base]?.test(digits) || digits.length > 4096)
        throw new Error('Enter a valid integer with up to 4,096 digits.');
      const number =
        BigInt(({ 2: '0b', 8: '0o', 10: '', 16: '0x' } as Record<number, string>)[base] + digits) *
        (negative ? -1n : 1n);
      return {
        text: pretty({
          binary: number.toString(2),
          octal: number.toString(8),
          decimal: number.toString(),
          hexadecimal: number.toString(16),
        }),
      };
    }
    case 'color':
      return { text: colorResult(source, options.background || '#ffffff') };
    case 'text': {
      const lines = source.split(/\r?\n/);
      const actions: Record<string, () => string> = {
        upper: () => source.toUpperCase(),
        lower: () => source.toLowerCase(),
        trim: () =>
          lines
            .map((line) => line.trim())
            .join('\n')
            .trim(),
        sort: () => lines.sort().join('\n'),
        unique: () => [...new Set(lines)].join('\n'),
        slug: () =>
          source
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, '-')
            .replace(/^-|-$/g, ''),
      };
      return {
        text: actions[action]
          ? actions[action]()
          : pretty({
              characters: [...source].length,
              bytes: encoder.encode(source).length,
              words: [
                ...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(source),
              ].filter((part) => part.isWordLike).length,
              lines: lines.length,
            }),
      };
    }
    case 'regex': {
      const pattern = options.pattern || '',
        flags = options.flags ?? 'g';
      if (pattern.length > 8192) throw new Error('The pattern is too large.');
      const expression = new RegExp(pattern, flags),
        matches = [];
      const global = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
      for (const match of source.matchAll(global)) {
        matches.push({
          index: match.index,
          text: match[0],
          groups: match.groups || match.slice(1),
        });
        if (matches.length === 1000) break;
      }
      return {
        text:
          action === 'replace'
            ? source.replace(expression, options.replacement || '')
            : pretty({ matches, truncated: matches.length === 1000 }),
      };
    }
    default:
      throw new Error('Choose a developer tool.');
  }
}
