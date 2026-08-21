/**
 * Shared CSV helpers.
 *
 * Extracted from CampaignCsvImportModal so the newsletter importer reuses the
 * same parser rather than growing a third one. (There is an older, naive
 * split(',') parser in BulkUploadModal — that one is not the reference.)
 *
 * Parsing stays on the client in both importers: the server receives already
 * structured JSON, never a file upload, which is what lets the user confirm the
 * column mapping before anything is sent.
 */

/** RFC4180-ish CSV parser: handles quoted fields, embedded commas, "" escapes, and CRLF. */
export const parseCsvText = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else if (c === '\r') {
      // swallow, \n handles the row break
    } else {
      field += c;
    }
  }
  if (field.length || row.length) pushRow();

  return rows.filter((r) => r.some((v) => v.trim() !== ''));
};

/** Normalize a header for keyword matching: lowercase, alphanumerics only. */
export const normHeader = (value = '') => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export const splitName = (name = '') => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
};
