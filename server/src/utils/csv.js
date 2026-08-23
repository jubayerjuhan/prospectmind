/**
 * Writing CSV, for exports.
 *
 * (The *parser* lives on the client, in lib/csv.js — imports are mapped in the
 * browser so the user can confirm the columns before anything is sent. Exports
 * go the other way: only the server has the prospect's contact fields and the
 * generated messages together, so the file is built here.)
 */

/**
 * Quote a single field.
 *
 * Message bodies are the reason this has to be careful: they contain commas,
 * newlines and quotation marks as a matter of course, and an unquoted newline
 * silently turns one row into two — a corruption the user only discovers in
 * whatever tool they open the file with.
 */
const escapeField = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Excel/Sheets interpret a leading =, +, - or @ as a formula. A body that
  // starts with "-" is ordinary prose, not something to evaluate.
  const guarded = /^[=+\-@]/.test(str) ? `'${str}` : str;
  return `"${guarded.replace(/"/g, '""')}"`;
};

/**
 * @param {Array<{key: String, header: String}>} columns
 * @param {Array<Object>} rows
 * @returns {String} CSV text, CRLF-delimited per RFC 4180, with a UTF-8 BOM so
 *   Excel renders accented names correctly instead of mojibake.
 */
export const toCsv = (columns, rows) => {
  const head = columns.map((column) => escapeField(column.header)).join(',');
  const body = rows.map((row) => columns.map((column) => escapeField(row[column.key])).join(','));
  return `﻿${[head, ...body].join('\r\n')}\r\n`;
};

/** A filename that survives every OS and Content-Disposition header. */
export const safeFilename = (name, extension = 'csv') => {
  const base = String(name || 'export')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60) || 'export';
  return `${base}.${extension}`;
};
