const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_DETAIL_ENRICHMENTS = 60;

const decodeEntities = (value) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');

const toLines = (html) =>
  decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]+>/g, '\n')
  )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

const normalizeUrl = (candidate, baseUrl) => {
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return null;
  }
};

const normalizeSocialUrl = (candidate, baseUrl) => {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  if (/^(x|twitter|github|linkedin)\.com\//i.test(trimmed)) {
    return `https://${trimmed.replace(/^http:\/\//i, '').replace(/^https:\/\//i, '')}`;
  }

  return normalizeUrl(trimmed, baseUrl);
};

const emptySocials = () => ({
  linkedinUrl: '',
  xUrl: '',
  githubUrl: '',
  telegramHandle: '',
});

const mergeSocialProfiles = (profiles = [], baseUrl, currentSocials = emptySocials()) => {
  const socials = { ...emptySocials(), ...currentSocials };

  profiles
    .map((profile) => normalizeSocialUrl(profile, baseUrl))
    .filter(Boolean)
    .forEach((href) => {
      if (!socials.linkedinUrl && href.includes('linkedin.com')) socials.linkedinUrl = href;
      if (!socials.xUrl && (href.includes('x.com') || href.includes('twitter.com'))) socials.xUrl = href;
      if (!socials.githubUrl && href.includes('github.com')) socials.githubUrl = href;
      if (!socials.telegramHandle && href.includes('t.me/')) socials.telegramHandle = href;
    });

  return socials;
};

const buildCandidateKey = (name = '', company = '', role = '') =>
  `${name.trim().toLowerCase()}::${company.trim().toLowerCase()}::${role.trim().toLowerCase()}`;

const createCandidateFromCardSnapshot = (snapshot, sourceUrl) => ({
  sourceKey: buildCandidateKey(snapshot.name, snapshot.company, snapshot.role),
  name: snapshot.name,
  company: snapshot.company,
  role: snapshot.role,
  socials: mergeSocialProfiles(snapshot.links || [], sourceUrl),
  avatarUrl: snapshot.avatarUrl || '',
  detailText: '',
  eventContext: {
    eventName: 'EthCC[9]',
    talkTitle: '',
    track: snapshot.role || '',
    dateLabel: '',
    timeLabel: '',
    stageLabel: '',
    description: '',
  },
  sourceUrl,
});

const fetchTextSnapshot = async (url) => {
  try {
    const response = await fetch(`https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`, {
      headers: { 'User-Agent': 'ProspectMind/1.0', Accept: 'text/plain' },
    });
    if (!response.ok) return '';
    return await response.text();
  } catch {
    return '';
  }
};

const isLikelyPersonName = (value = '') =>
  /^[A-Z0-9][A-Za-z0-9.'’`-]+(?: [A-Z0-9][A-Za-z0-9.'’`-]+){0,4}$/.test(value.trim());

const extractSocials = (html, baseUrl, speakerName) => {
  const escapedName = speakerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameWindow = html.match(new RegExp(`.{0,2500}${escapedName}.{0,5000}`, 'i'))?.[0] || html;
  const hrefMatches = [...nameWindow.matchAll(/href="([^"]+)"/gi)].map((match) => normalizeUrl(match[1], baseUrl)).filter(Boolean);
  const socials = emptySocials();

  hrefMatches.forEach((href) => {
    if (!socials.linkedinUrl && href.includes('linkedin.com')) socials.linkedinUrl = href;
    if (!socials.xUrl && (href.includes('x.com') || href.includes('twitter.com'))) socials.xUrl = href;
    if (!socials.githubUrl && href.includes('github.com')) socials.githubUrl = href;
    if (!socials.telegramHandle && href.includes('t.me/')) socials.telegramHandle = href;
  });

  return socials;
};

const parseDetailText = (detailText = '') => {
  const lines = detailText
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const metadata = {
    eventName: '',
    talkTitle: '',
    track: '',
    dateLabel: '',
    timeLabel: '',
    stageLabel: '',
    description: '',
  };

  if (!lines.length) return metadata;

  metadata.eventName = lines.find((line) => /^ethcc/i.test(line)) || '';
  metadata.track = lines.find((line) =>
    ['defi', 'security', 'research', 'privacy', 'tokenisation', 'protocol', 'breakout', 'ai', 'the unexpected'].some((token) =>
      line.toLowerCase().includes(token)
    )
  ) || '';

  const talkIndex = lines.findIndex((line) =>
    /talk|panel|fireside|workshop/i.test(line) || line.includes(':') || line.length > 24
  );
  if (talkIndex >= 0) metadata.talkTitle = lines[talkIndex];

  metadata.dateLabel = lines.find((line) => /monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(line)) || '';
  metadata.timeLabel = lines.find((line) => /\b\d{1,2}:\d{2}\b/.test(line)) || '';
  metadata.stageLabel = lines.find((line) => /stage/i.test(line)) || '';

  const descriptionIndex = lines.findIndex((line) => /^description$/i.test(line));
  if (descriptionIndex >= 0) {
    metadata.description = lines.slice(descriptionIndex + 1).join(' ').slice(0, 1200);
  } else {
    metadata.description = lines.slice(-4).join(' ').slice(0, 1200);
  }

  return metadata;
};

const extractCandidatesFromLines = (html, url) => {
  const lines = toLines(html);
  const speakersIndex = lines.findIndex((line) => /^speakers$/i.test(line));
  const footerIndex = lines.findIndex((line) => /^essential info$/i.test(line));
  const scope = lines.slice(speakersIndex >= 0 ? speakersIndex : 0, footerIndex >= 0 ? footerIndex : undefined);
  const candidates = [];

  for (let i = 0; i < scope.length; i += 1) {
    const line = scope[i];
    const photoMatch = line.match(/^profile photo of (.+)$/i);
    if (!photoMatch) continue;

    const name = scope[i + 1] || photoMatch[1];
    const company = scope[i + 2] || '';
    const role = scope[i + 3] || '';

    if (!name || name.length < 2) continue;
    if (['menu', 'speakers', 'all tracks'].includes(name.toLowerCase())) continue;

    const socials = extractSocials(html, url, name);
    candidates.push({
      sourceKey: buildCandidateKey(name, company, role),
      name,
      company,
      role,
      socials,
      detailText: '',
      eventContext: {
        eventName: '',
        talkTitle: '',
        track: role,
        dateLabel: '',
        timeLabel: '',
        stageLabel: '',
        description: '',
      },
      sourceUrl: url,
    });
  }

  return candidates;
};

const extractCandidatesFromSnapshot = (snapshot, url) => {
  const lines = snapshot
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const candidates = [];
  for (let i = 0; i < lines.length; i += 1) {
    const heading = lines[i].match(/^#{1,6}\s+(.+)$/);
    if (!heading) continue;
    const name = heading[1].trim();
    const company = lines[i + 1] || '';
    const role = lines[i + 2] || '';
    if (!name || name.toLowerCase() === 'speakers') continue;
    if (company.length > 120 || role.length > 120) continue;
    candidates.push({
      sourceKey: buildCandidateKey(name, company, role),
      name,
      company,
      role,
      socials: emptySocials(),
      detailText: '',
      eventContext: {
        eventName: '',
        talkTitle: '',
        track: role,
        dateLabel: '',
        timeLabel: '',
        stageLabel: '',
        description: '',
      },
      sourceUrl: url,
    });
  }

  return candidates;
};

const extractEthccCandidatesFromSnapshot = (snapshot, url) => {
  const lines = snapshot
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const start = lines.findIndex((line) => /^# Speakers$/i.test(line) || /^Speakers$/i.test(line));
  const end = lines.findIndex((line) => /^Home$/i.test(line) || /^GET THE LATEST ETHCC UPDATES$/i.test(line));
  const scope = lines.slice(start >= 0 ? start + 1 : 0, end >= 0 ? end : undefined);
  const candidates = [];

  for (let i = 0; i < scope.length; i += 1) {
    const headingMatch = scope[i].match(/^#{1,6}\s+(.+)$/);
    const rawName = headingMatch ? headingMatch[1].trim() : '';
    if (!rawName || !isLikelyPersonName(rawName)) continue;

    const company = scope[i + 1] || '';
    const track = scope[i + 2] || '';
    if (!company || !track) continue;
    if (company.length > 120 || track.length > 120) continue;

    candidates.push({
      sourceKey: buildCandidateKey(rawName, company, track),
      name: rawName,
      company,
      role: track,
      socials: emptySocials(),
      detailText: '',
      eventContext: {
        eventName: 'EthCC[9]',
        talkTitle: '',
        track,
        dateLabel: '',
        timeLabel: '',
        stageLabel: '',
        description: '',
      },
      sourceUrl: url,
    });
  }

  return candidates;
};

const extractEthccCandidatesFromPayload = (html, url) => {
  const matches = [...html.matchAll(/"displayName":"([^"]+)","organization":"([^"]*)","trackSlug":"([^"]*)","socialProfiles":\[(.*?)\],"pfp":"([^"]*)"/g)];
  const trackMap = {
    unknown: 'The Unexpected',
    'cypherpunk-privacy': 'Cypherpunk & Privacy',
    'rwa-tokenisation': 'RWA Tokenisation',
    'product-marketers': 'Product & Marketers',
    'regulation-compliance': 'Regulation & Compliance',
    'core-protocol': 'Core Protocol',
    'breakout-sessions': 'Breakout Sessions',
    'built-on-ethereum': 'Built on Ethereum',
    stablecoins: 'Stablecoins',
    research: 'Research',
    security: 'Security',
    defi: 'DeFi',
    'defi-day': 'DeFi Day',
    terse: 'TERSE',
    'if-you-know-you-know': 'If you know you know',
  };

  return matches.map((match) => {
    const [, rawName, rawCompany, rawTrackSlug, rawProfiles, rawAvatarUrl] = match;
    const name = decodeEntities(rawName.replace(/\\"/g, '"')).trim();
    const company = decodeEntities(rawCompany.replace(/\\"/g, '"')).trim();
    const trackSlug = decodeEntities(rawTrackSlug.replace(/\\"/g, '"')).trim();
    const role = trackMap[trackSlug] || trackSlug.replace(/-/g, ' ').trim();
    const profiles = [...rawProfiles.matchAll(/"([^"]+)"/g)].map((profileMatch) =>
      decodeEntities(profileMatch[1].replace(/\\"/g, '"'))
    );

    return {
      sourceKey: buildCandidateKey(name, company, role),
      name,
      company,
      role,
      socials: mergeSocialProfiles(profiles, url),
      avatarUrl: decodeEntities(rawAvatarUrl.replace(/\\"/g, '"')).trim(),
      detailText: '',
      eventContext: {
        eventName: 'EthCC[9]',
        talkTitle: '',
        track: role,
        dateLabel: '',
        timeLabel: '',
        stageLabel: '',
        description: '',
      },
      sourceUrl: url,
    };
  });
};

const enrichFromBrowser = async (url, candidates) => {
  let puppeteer;
  try {
    ({ default: puppeteer } = await import('puppeteer'));
  } catch {
    return candidates;
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });

    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1440, height: 1600 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await page.evaluate(async () => {
      let previousHeight = 0;
      let stableCount = 0;

      for (let i = 0; i < 40; i += 1) {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise((resolve) => setTimeout(resolve, 250));

        const currentHeight = document.body.scrollHeight;
        if (currentHeight === previousHeight) {
          stableCount += 1;
          if (stableCount >= 3) break;
        } else {
          stableCount = 0;
          previousHeight = currentHeight;
        }
      }

      window.scrollTo(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    const cardSnapshots = await page.evaluate(() => {
      const seen = new Set();
      return [...document.querySelectorAll('img[alt^="Profile photo of "]')]
        .map((image) => {
          const rawName = image.getAttribute('alt')?.replace(/^Profile photo of /, '').trim() || '';
          if (!rawName) return null;

          const card =
            image.closest('.aspect-square') ||
            image.parentElement?.parentElement ||
            image.parentElement;
          if (!card) return null;

          const labels = [...card.querySelectorAll('h1,h2,h3,h4,p,span')]
            .map((el) => el.textContent?.trim())
            .filter(Boolean);
          const company = labels[labels.length - 1] || '';
          const track = card.querySelector('span[title]')?.getAttribute('title')?.trim() || '';
          const links = [...card.querySelectorAll('a[href]')].map((link) => link.href).filter(Boolean);
          const avatarUrl = image.currentSrc || image.src || '';
          const key = `${rawName.toLowerCase()}::${company.toLowerCase()}::${track.toLowerCase()}`;

          if (seen.has(key)) return null;
          seen.add(key);

          return {
            name: rawName,
            company,
            role: track,
            links,
            avatarUrl,
          };
        })
        .filter(Boolean);
    });

    const cardSnapshotMap = new Map(
      cardSnapshots.map((snapshot) => [
        buildCandidateKey(snapshot.name, snapshot.company, snapshot.role),
        snapshot,
      ])
    );

    const candidateMap = new Map(
      candidates.map((candidate) => [
        candidate.sourceKey || buildCandidateKey(candidate.name, candidate.company, candidate.role),
        candidate,
      ])
    );

    for (const snapshot of cardSnapshots) {
      const key = buildCandidateKey(snapshot.name, snapshot.company, snapshot.role);
      if (!candidateMap.has(key)) {
        candidateMap.set(key, createCandidateFromCardSnapshot(snapshot, url));
      }
    }

    const enriched = [];
    const allowDetailEnrichment = !url.includes('ethcc.io/');
    let detailEnrichmentCount = 0;

    for (const candidate of candidateMap.values()) {
      const snapshot =
        cardSnapshotMap.get(buildCandidateKey(candidate.name, candidate.company, candidate.role)) ||
        [...cardSnapshotMap.values()].find((entry) => entry.name === candidate.name && entry.company === candidate.company) ||
        null;

      const baseCandidate = {
        ...candidate,
        socials: snapshot?.links?.length
          ? mergeSocialProfiles(snapshot.links, url, candidate.socials)
          : candidate.socials,
        avatarUrl: candidate.avatarUrl || snapshot?.avatarUrl || '',
        role: candidate.role || snapshot?.role || '',
      };

      if (!allowDetailEnrichment || detailEnrichmentCount >= MAX_DETAIL_ENRICHMENTS) {
        enriched.push(baseCandidate);
        continue;
      }

      let detail = null;
      try {
        await page.evaluate(async (name) => {
          const label = [...document.querySelectorAll('h1,h2,h3,h4,p,span,div')]
            .find((el) => el.textContent?.trim() === name);
          if (!label) return;
          label.scrollIntoView({ block: 'center', behavior: 'instant' });
          await new Promise((resolve) => setTimeout(resolve, 150));
        }, candidate.name);

        detail = await page.evaluate(async (name) => {
          const findClickTarget = () => {
            const candidates = [...document.querySelectorAll('h1,h2,h3,h4,p,span,div')];
            const label = candidates.find((el) => el.textContent?.trim() === name);
            if (!label) return null;

            let current = label;
            while (current && current !== document.body) {
              const style = window.getComputedStyle(current);
              if (
                current.tagName === 'BUTTON' ||
                current.tagName === 'A' ||
                current.getAttribute('role') === 'button' ||
                style.cursor === 'pointer'
              ) {
                return current;
              }
              current = current.parentElement;
            }
            return label.parentElement || label;
          };

          const target = findClickTarget();
          if (!target) return null;

          target.click();
          await new Promise((resolve) => setTimeout(resolve, 700));

          const panelCandidates = [...document.querySelectorAll('aside,section,div')].filter((el) => {
            const rect = el.getBoundingClientRect();
            const text = el.innerText?.trim() || '';
            return rect.width > 280 && rect.left > window.innerWidth * 0.55 && text.length > 120;
          });

          const panel = panelCandidates.sort((a, b) => b.innerText.length - a.innerText.length)[0];
          if (!panel) return null;

          const links = [...panel.querySelectorAll('a[href]')].map((link) => link.href).filter(Boolean);
          const avatar = panel.querySelector('img')?.src || '';
          const text = panel.innerText || '';
          const headings = [...panel.querySelectorAll('h1,h2,h3,h4')].map((el) => el.textContent?.trim()).filter(Boolean);

          const closeButton =
            [...document.querySelectorAll('button,[role="button"],svg')]
              .find((el) =>
                (el.getAttribute?.('aria-label') || '').toLowerCase().includes('close')
                  || el.textContent?.trim() === '×'
              );
          closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 200));

          return {
            text,
            links,
            avatarUrl: avatar,
            headings,
          };
        }, candidate.name);
      } catch {
        detail = null;
      }

      if (!detail) {
        enriched.push(baseCandidate);
        continue;
      }
      detailEnrichmentCount += 1;

      const socials = mergeSocialProfiles(
        [...(snapshot?.links || []), ...(detail.links || [])],
        url,
        baseCandidate.socials
      );

      enriched.push({
        ...baseCandidate,
        socials,
        avatarUrl: detail.avatarUrl || snapshot?.avatarUrl || '',
        detailText: detail.text || '',
        eventContext: {
          ...parseDetailText(detail.text || ''),
          track: candidate.eventContext?.track || snapshot?.role || '',
        },
      });
    }

    return enriched;
  } catch {
    return candidates;
  } finally {
    await browser?.close().catch(() => {});
  }
};

const uniqueCandidates = (candidates) => {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate?.name) return false;
    const key = candidate.sourceKey || `${candidate.name.toLowerCase()}::${(candidate.company || '').toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const previewSpeakerImport = async (url) => {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Failed to fetch page (${response.status}).`);
  }

  const html = await response.text();
  let initialCandidates = extractCandidatesFromLines(html, url);
  if (url.includes('ethcc.io/')) {
    const payloadCandidates = extractEthccCandidatesFromPayload(html, url);
    if (payloadCandidates.length) {
      const merged = new Map();
      [...initialCandidates, ...payloadCandidates].forEach((candidate) => {
        const key = candidate.sourceKey || buildCandidateKey(candidate.name, candidate.company, candidate.role);
        const existing = merged.get(key);
        merged.set(key, existing
          ? {
              ...existing,
              ...candidate,
              socials: mergeSocialProfiles([], url, { ...existing.socials, ...candidate.socials }),
              avatarUrl: existing.avatarUrl || candidate.avatarUrl || '',
            }
          : candidate);
      });
      initialCandidates = [...merged.values()];
    }
  }
  if (!initialCandidates.length && url.includes('ethcc.io/')) {
    const snapshot = await fetchTextSnapshot(url);
    if (snapshot) {
      initialCandidates = extractEthccCandidatesFromSnapshot(snapshot, url);
    }
  }
  if (!initialCandidates.length) {
    const snapshot = await fetchTextSnapshot(url);
    if (snapshot) {
      initialCandidates = extractCandidatesFromSnapshot(snapshot, url);
    }
  }
  if (!initialCandidates.length) {
    return { candidates: [], metadata: { sourceUrl: url, strategy: 'html-lines' } };
  }

  const enrichedCandidates = await enrichFromBrowser(url, initialCandidates);
  const strategy = enrichedCandidates.some((candidate) => candidate.detailText)
    ? 'browser-detail'
    : url.includes('ethcc.io/') && enrichedCandidates.some((candidate) =>
      candidate.socials?.linkedinUrl || candidate.socials?.xUrl || candidate.socials?.githubUrl
    )
      ? 'browser-cards'
      : 'html-lines';
  return {
    candidates: uniqueCandidates(enrichedCandidates),
    metadata: {
      sourceUrl: url,
      strategy,
      totalFound: uniqueCandidates(enrichedCandidates).length,
    },
  };
};
