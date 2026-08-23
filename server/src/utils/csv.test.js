import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, safeFilename } from './csv.js';

const columns = [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }];

test('every field is quoted, so commas and newlines cannot split a row', () => {
  // A generated message body routinely contains both.
  const csv = toCsv(columns, [{ a: 'Hi Jane,\n\nSaw your post', b: 'x' }]);
  const [, dataRow] = csv.split('\r\n');
  assert.equal(dataRow, '"Hi Jane,\n\nSaw your post","x"');
});

test('embedded quotes are doubled', () => {
  const csv = toCsv(columns, [{ a: 'He said "hello"', b: '' }]);
  assert.ok(csv.includes('"He said ""hello"""'));
});

test('a leading =, +, - or @ is neutralised', () => {
  // Otherwise Excel treats the cell as a formula.
  for (const value of ['=SUM(A1)', '+1', '-Hi there', '@name']) {
    assert.ok(toCsv(columns, [{ a: value, b: '' }]).includes(`"'${value}"`), value);
  }
});

test('null and undefined become empty cells, not the strings "null"/"undefined"', () => {
  const csv = toCsv(columns, [{ a: null, b: undefined }]);
  const [, dataRow] = csv.split('\r\n');
  assert.equal(dataRow, ',');            // two empty fields, unquoted — valid CSV
  assert.ok(!/null|undefined/.test(csv));
});

test('the file starts with a BOM so Excel reads it as UTF-8', () => {
  assert.ok(toCsv(columns, [{ a: 'Gagnieux', b: '' }]).startsWith('﻿'));
});

test('filenames survive punctuation, spaces and emptiness', () => {
  assert.equal(safeFilename('Demo Campaign 2'), 'demo-campaign-2.csv');
  assert.equal(safeFilename('Q4 / EMEA: "push"'), 'q4-emea-push.csv');
  assert.equal(safeFilename(''), 'export.csv');
});
