/**
 * Proxy Rotator
 * Parses Webshare proxy list and rotates through them randomly.
 * Format: IP:PORT:USERNAME:PASSWORD
 */

// ── Proxy list (from Webshare) ────────────────────────────────────────────────
const RAW_PROXIES = [
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

/**
 * Get a random proxy (avoids repeating the same one twice in a row)
 */
export const getProxy = () => {
  let index;
  do {
    index = Math.floor(Math.random() * PROXIES.length);
  } while (index === lastIndex && PROXIES.length > 1);

  lastIndex = index;
  const proxy = PROXIES[index];
  console.log(`[proxy] Using proxy ${index + 1}/${PROXIES.length}: ${proxy.host}:${proxy.port}`);
  return proxy;
};

export const getAllProxies = () => PROXIES;
