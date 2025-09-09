
function shouldCardize(text) {
  if (!text) return false;
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length < 5) return false; // Lower threshold for smaller documents

  const urlRx = /\bhttps?:\/\/[^\s)]+/i;
  const ipRx  = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/;
  const nameRx = /^[A-Za-z][A-Za-z0-9() /_.-]{2,80}$/;

  const urls = (text.match(new RegExp(urlRx, 'gi')) || []).length;
  const ips  = (text.match(new RegExp(ipRx, 'g')) || []).length;
  const shortRatio = lines.filter(l => l.length <= 35).length / lines.length;

  // Quick windowed pair count
  let pairs = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!nameRx.test(lines[i])) continue;
    for (let j = 1; j <= 5 && i + j < lines.length; j++) {
      if (urlRx.test(lines[i+j]) || ipRx.test(lines[i+j])) { 
        pairs++; 
        break; 
      }
    }
  }

  // Heuristics for cardization:
  // 1. Dense endpoints: urls + ips >= 3
  // 2. List-y structure: ≥ 30% short lines + many name-attribute pairs
  // 3. Nearby pairs: name followed by URL/IP/hostname ≥ 3 times
  return (urls + ips >= 3) || (shortRatio >= 0.3 && pairs >= 3);
}

module.exports = { shouldCardize };
