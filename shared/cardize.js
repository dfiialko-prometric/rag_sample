
function cardize(text) {
  const lines = String(text).split(/\r?\n/).map(s => s.trim());
  const urlRx = /\bhttps?:\/\/[^\s)]+/i;
  const ipRx  = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/;
  const hostRx= /\b[a-z0-9.-]+\.[a-z]{2,}\b/i; // vm-iis1-..., foo.prod.example
  const nameRx= /^[A-Za-z][A-Za-z0-9() /_.-]{2,80}$/;

  // Try to capture coarse section headers
  let section = null;
  const isSection = (s) => /^(customer facing|internal applications|services\/console|application list)$/i.test(s);
  const setSection = (s) => s && (section = s);

  const cards = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (isSection(L)) setSection(L);

    if (!nameRx.test(L)) continue;

    let url = null, ip = null, host = null;
    for (let j = 1; j <= 5 && i + j < lines.length; j++) {
      const t = lines[i + j];
      if (!url  && urlRx.test(t))  url  = t.match(urlRx)[0];
      if (!ip   && ipRx.test(t))   ip   = t.match(ipRx)[0];
      if (!host && hostRx.test(t)) host = t.match(hostRx)[0];
      if (url || ip || host) break;
      if (nameRx.test(t)) break; // Next item starts
    }
    if (url || ip || host) cards.push({ name: L, url, ip, host, section });
  }

  // Dedupe by creating a unique key
  const seen = new Set();
  return cards.filter(c => {
    const key = [c.name, c.url||'', c.ip||'', c.host||''].join('|').toLowerCase();
    if (seen.has(key)) return false; 
    seen.add(key); 
    return true;
  });
}

module.exports = { cardize };
