/**
 * Low-memory Chrome launch flags.
 *
 * Only applied when LOW_MEMORY=true, which is set on the 512 MB Render
 * deployment and nowhere else. Chrome's default multi-process model costs a
 * renderer process (~150 MB) on top of the browser process; collapsing them
 * is the difference between finishing a scrape and being OOM-killed.
 *
 * Deliberately excluded: anything that changes what the page *sees*, such as
 * --blink-settings=imagesEnabled=false. A browser that fetches no images is a
 * cheap fingerprint, and the LinkedIn path is built to look ordinary
 * (see linkedinBrowserIdentity.js). Memory is worth saving; the disguise isn't.
 *
 * Pass any flags the caller already sets as `existing` so they are not
 * repeated — two of the scrapers set --single-process unconditionally.
 *
 * --single-process is incompatible with a headful launch, but the only headful
 * path is Live LinkedIn Login, which needs an X display this deployment does
 * not have — so the combination never arises in practice.
 */
export const lowMemoryArgs = (existing = []) =>
  process.env.LOW_MEMORY !== 'true'
    ? []
    : [
        '--single-process',
        '--no-zygote',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-networking',
        // Chrome's own JS heap, separate from Node's --max-old-space-size.
        '--js-flags=--max-old-space-size=128',
      ].filter((flag) => !existing.includes(flag));
