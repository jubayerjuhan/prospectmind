/**
 * Proxy Rotator
 * Parses Webshare proxy list and rotates through them randomly.
 * Format: IP:PORT:USERNAME:PASSWORD
 */
import net from 'net';

// ── Proxy list (from Webshare) ────────────────────────────────────────────────
// Configure via WEBSHARE_PROXIES in .env — comma-separated "host:port:user:pass"
// entries — so proxies can be added/rotated/removed without touching source or
// redeploying. Falls back to this hardcoded list (today's known-working set)
// when the env var isn't set, so nothing breaks with zero config changes.
const DEFAULT_RAW_PROXIES = [
  '38.154.203.95:5863:olfnrjae:c91tmxlgy03y',
  '198.105.121.200:6462:olfnrjae:c91tmxlgy03y',
  '64.137.96.74:6641:olfnrjae:c91tmxlgy03y',
  '209.127.138.10:5784:olfnrjae:c91tmxlgy03y',
  '38.154.185.97:6370:olfnrjae:c91tmxlgy03y',
  '84.247.60.125:6095:olfnrjae:c91tmxlgy03y',
  '142.111.67.146:5611:olfnrjae:c91tmxlgy03y',
  '191.96.254.138:6185:olfnrjae:c91tmxlgy03y',
  '31.58.9.4:6077:olfnrjae:c91tmxlgy03y',
  '64.137.10.153:5803:olfnrjae:c91tmxlgy03y',
];

const RAW_PROXIES = process.env.WEBSHARE_PROXIES
  ? process.env.WEBSHARE_PROXIES.split(',').map((p) => p.trim()).filter(Boolean)
  : DEFAULT_RAW_PROXIES;

// Parse into structured objects
const PROXIES = RAW_PROXIES.map((line) => {
  const [host, port, username, password] = line.trim().split(':');
  return {
    host,
    port: parseInt(port),
    username,
    password,
    url: `http://${username}:${password}@${host}:${port}`,
  };
});

let lastIndex = -1;

// ── Health check ───────────────────────────────────────────────────────────
// Webshare proxies in this list rot over time (measured 4/10 dead in practice).
// A plain random pick would hand back a dead one ~40% of the time and silently
// break that scrape. Do a cheap one-time TCP-reachability check per process
// lifetime and only rotate through proxies that actually accept a connection.
const HEALTH_CHECK_TIMEOUT_MS = 3000;

const isReachable = (host, port) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: HEALTH_CHECK_TIMEOUT_MS });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });

let healthyProxiesPromise = null;

const getHealthyProxies = () => {
  if (!healthyProxiesPromise) {
    healthyProxiesPromise = (async () => {
      const results = await Promise.all(
        PROXIES.map(async (proxy) => ({ proxy, ok: await isReachable(proxy.host, proxy.port) }))
      );
      const healthy = results.filter((r) => r.ok).map((r) => r.proxy);
      console.log(`[proxy] Health check: ${healthy.length}/${PROXIES.length} proxies reachable`);
      // Never return an empty list — fall back to the raw list rather than
      // disabling proxy use entirely if the health check itself is unreliable.
      return healthy.length > 0 ? healthy : PROXIES;
    })();
  }
  return healthyProxiesPromise;
};

/**
 * Get a random healthy proxy (avoids repeating the same one twice in a row).
 * Async because the first call runs the one-time health check.
 */
export const getProxy = async () => {
  const proxies = await getHealthyProxies();
  let index;
  do {
    index = Math.floor(Math.random() * proxies.length);
  } while (index === lastIndex && proxies.length > 1);

  lastIndex = index;
  const proxy = proxies[index];
  console.log(`[proxy] Using proxy ${index + 1}/${proxies.length}: ${proxy.host}:${proxy.port}`);
  return proxy;
};

export const getAllProxies = () => PROXIES;
