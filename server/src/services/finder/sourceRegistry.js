/**
 * Company Finder source registry — maps a source key to its adapter.
 * Adding a new scrape source later is just registering another adapter here;
 * nothing in the controller or frontend needs to change shape.
 */

import cryptojobslist from './sources/cryptojobslist.js';

const SOURCES = {
  [cryptojobslist.key]: cryptojobslist,
};

export const getSource = (key) => SOURCES[key] || null;

export const listSources = () =>
  Object.values(SOURCES).map(({ key, label, sortOptions }) => ({ key, label, sortOptions }));

export default SOURCES;
