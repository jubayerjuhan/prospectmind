/**
 * Live job-board (ATS) lookup.
 *
 * Hiring signals used to be inferred from Google snippets, which is unreliable
 * in a specific and embarrassing way: search engines keep filled roles, closed
 * postings and old "we're hiring!" posts indexed for months, and a careers page
 * says "see our job openings" whether or not any exist. So a company with zero
 * vacancies reads as actively hiring.
 *
 * Every major ATS publishes its live board over an unauthenticated JSON
 * endpoint. One HTTP GET gives the real answer, so we ask the source instead of
 * inferring from descriptions of the source.
 *
 * Returns an open-role COUNT that is trustworthy in both directions — 0 means
 * genuinely not hiring, which is the half that search can never establish.
 */

const TIMEOUT_MS = 8000;

const getJson = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'ProspectMind/1.0' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Supported providers. `match` pulls the board slug out of any URL; `fetch`
 * normalizes that provider's payload to { title, location }.
 */
const PROVIDERS = [
  {
    name: 'ashby',
    match: /jobs\.ashbyhq\.com\/([A-Za-z0-9._-]+)/i,
    boardUrl: (s) => `https://jobs.ashbyhq.com/${s}`,
    fetch: async (slug) => {
      const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`);
      if (!d?.jobs) return null;
      return d.jobs.map((j) => ({ title: str(j.title), location: str(j.location) }));
    },
  },
  {
    name: 'greenhouse',
    match: /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9._-]+)/i,
    boardUrl: (s) => `https://boards.greenhouse.io/${s}`,
    fetch: async (slug) => {
      const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`);
      if (!d?.jobs) return null;
      return d.jobs.map((j) => ({ title: str(j.title), location: str(j.location?.name) }));
    },
  },
  {
    name: 'lever',
    match: /jobs\.lever\.co\/([A-Za-z0-9._-]+)/i,
    boardUrl: (s) => `https://jobs.lever.co/${s}`,
    fetch: async (slug) => {
      const d = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
      if (!Array.isArray(d)) return null;
      return d.map((j) => ({ title: str(j.text), location: str(j.categories?.location) }));
    },
  },
  {
    name: 'smartrecruiters',
    match: /careers\.smartrecruiters\.com\/([A-Za-z0-9._-]+)/i,
    boardUrl: (s) => `https://careers.smartrecruiters.com/${s}`,
    fetch: async (slug) => {
      const d = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings`);
      if (!d?.content) return null;
      return d.content.map((j) => ({ title: str(j.name), location: str(j.location?.city) }));
    },
  },
  {
    name: 'recruitee',
    match: /([A-Za-z0-9-]+)\.recruitee\.com/i,
    boardUrl: (s) => `https://${s}.recruitee.com`,
    fetch: async (slug) => {
      const d = await getJson(`https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`);
      if (!d?.offers) return null;
      return d.offers.map((j) => ({ title: str(j.title), location: str(j.location) }));
    },
  },
  {
    name: 'workable',
    match: /apply\.workable\.com\/([A-Za-z0-9._-]+)/i,
    boardUrl: (s) => `https://apply.workable.com/${s}`,
    fetch: async (slug) => {
      const d = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=true`);
      if (!d?.jobs) return null;
      return d.jobs.map((j) => ({ title: str(j.title), location: str(j.location?.city || j.country) }));
    },
  },
];

/** Slugs that are a provider's own marketing pages, not a customer board. */
const SLUG_BLOCKLIST = new Set(['www', 'api', 'app', 'help', 'support', 'blog', 'about', 'jobs', 'careers', 'embed', 'search', 'company']);

/**
 * Find a job board in a set of URLs (search result links, the careers page,
 * anything we already hold).
 * @returns {{provider: String, slug: String, url: String}|null}
 */
export const detectBoardFromUrls = (urls = []) => {
  for (const raw of urls) {
    const url = String(raw || '');
    if (!url) continue;
    for (const provider of PROVIDERS) {
      const slug = url.match(provider.match)?.[1];
      if (slug && !SLUG_BLOCKLIST.has(slug.toLowerCase())) {
        return { provider: provider.name, slug, url: provider.boardUrl(slug) };
      }
    }
  }
  return null;
};

/**
 * Fetch the live open roles for a detected board.
 *
 * @returns {Promise<{provider, slug, url, openRoles: Number, roles: Array, fetchedAt: Date}|null>}
 *   null means the board could not be read — which is NOT the same as zero open
 *   roles, and callers must not treat it as "not hiring".
 */
export const fetchBoardOpenRoles = async ({ provider, slug, url } = {}) => {
  const impl = PROVIDERS.find((p) => p.name === provider);
  if (!impl || !slug) return null;

  const roles = await impl.fetch(slug);
  if (!roles) {
    console.warn(`[atsBoards] Could not read ${provider} board "${slug}"`);
    return null;
  }

  const cleaned = roles.filter((r) => r.title);
  console.log(`[atsBoards] ${provider}/${slug} → ${cleaned.length} open role(s)`);
  return {
    provider, slug, url: url || impl.boardUrl(slug),
    openRoles: cleaned.length,
    roles: cleaned.slice(0, 25),
    fetchedAt: new Date(),
  };
};

/** Detect from URLs and fetch in one step. */
export const resolveBoardFromUrls = async (urls = []) => {
  const board = detectBoardFromUrls(urls);
  return board ? fetchBoardOpenRoles(board) : null;
};

/**
 * The prompt block. Written to be decisive: an empty board is the answer, not a
 * hint, because stale snippets will otherwise always argue the other way.
 */
export const formatBoardBlock = (board) => {
  if (!board) return '';
  const list = board.roles.length
    ? `\nOpen roles:\n${board.roles.map((r) => `- ${r.title}${r.location ? ` (${r.location})` : ''}`).join('\n')}`
    : '';

  return `=== LIVE JOB BOARD — AUTHORITATIVE, FETCHED JUST NOW ===
Provider: ${board.provider} · ${board.url}
Open positions at this moment: ${board.openRoles}${list}

This is the company's own applicant tracking system, read live seconds ago. It
is the ground truth for whether they are hiring, and it overrides everything
below. Search snippets routinely surface roles that have since been filled or
closed, old "we're hiring" posts with no date, and careers-page boilerplate that
mentions openings regardless of whether any exist.
${board.openRoles === 0
    ? 'Open positions is 0, so this company is NOT currently hiring. Say so plainly, however many snippets suggest otherwise, and set a high confidence on that negative finding.'
    : 'Base any hiring claim on the roles listed above, not on roles named only in snippets.'}`;
};
