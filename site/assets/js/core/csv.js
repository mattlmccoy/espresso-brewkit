// RFC 4180 CSV parsing and serialization, plus legacy-format migration.

import { COLUMNS, LEGACY_MAP, LEGACY_DEFAULT_FLAGS, GRIND_MICRONS, NUMERIC } from './schema.js';

/** Parse CSV text into an array of row objects. Handles quotes and embedded newlines. */
export function parse(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return { header: [], rows: [] };

  const header = rows[0].map((h) => h.trim());
  const out = rows.slice(1)
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { header, rows: out };
}

const needsQuote = (s) => /[",\n]/.test(s);
const esc = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return needsQuote(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function serialize(records, columns = COLUMNS) {
  const lines = [columns.join(',')];
  for (const r of records) {
    lines.push(columns.map((c) => esc(fmt(r[c]))).join(','));
  }
  return lines.join('\n') + '\n';
}

function fmt(v) {
  if (typeof v !== 'number') return v ?? '';
  if (!Number.isFinite(v)) return '';
  // Trim float noise without losing real precision.
  return String(Math.round(v * 1e6) / 1e6);
}

const num = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** True if this looks like a one-shot-per-file CSV from the Python version. */
export const isLegacy = (header) => header.includes('Dry Coffee Mass (g)') || header.includes('Beverage Mass (g)');

/** Convert one legacy row to the canonical schema. */
export function fromLegacy(row, index = 0) {
  const out = { shot_id: `legacy-${String(index + 1).padStart(3, '0')}` };

  for (const [legacyKey, key] of Object.entries(LEGACY_MAP)) {
    if (!(legacyKey in row)) continue;
    out[key] = NUMERIC.includes(key) ? num(row[legacyKey]) : row[legacyKey];
  }

  const flags = Object.entries(LEGACY_DEFAULT_FLAGS)
    .filter(([legacyKey]) => String(row[legacyKey] ?? '').toLowerCase() === 'true')
    .map(([, key]) => key);
  out.defaulted = flags.join(';');

  if (out.grind_label) {
    out.grind_label = String(out.grind_label).toLowerCase();
    out.grind_setting = GRIND_MICRONS[out.grind_label] ?? null;
  }

  // Legacy stored TDS as a fraction (0.11475 meaning 11.475%).
  const legacyTds = num(row['TDS']);
  if (legacyTds !== null) out.tds_pct = legacyTds * 100;

  return out;
}

/** Read any supported CSV into canonical records. */
export function read(text) {
  const { header, rows } = parse(text);
  if (!rows.length) return { records: [], legacy: false };
  const legacy = isLegacy(header);
  if (legacy) return { records: rows.map(fromLegacy), legacy: true };

  const records = rows.map((r) => {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = NUMERIC.includes(k) ? num(v) : v;
    }
    return out;
  });
  return { records, legacy: false };
}

export function download(filename, text, type = 'text/csv') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
