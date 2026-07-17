// Generates client/src/data/mrtNetwork.json — the full operational Singapore
// MRT/LRT network (stations + line orderings) for the faded map overlay.
// Source: OneMap keyless elastic search (authoritative coords + station codes
// parsed from titles like "JURONG EAST MRT STATION (EW24 / NS1)"). Re-run with
// `node scripts/build-mrt-network.mjs` if the network changes.
import { writeFileSync } from "fs";

const BASE = "https://www.onemap.gov.sg";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(q, page) {
  const url = new URL(`${BASE}/api/common/elastic/search`);
  url.searchParams.set("searchVal", q);
  url.searchParams.set("returnGeom", "Y");
  url.searchParams.set("getAddrDetails", "Y");
  url.searchParams.set("pageNum", String(page));
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (r.ok) return r.json();
    } catch {}
    await sleep(500);
  }
  return { results: [] };
}
async function harvestAll(q) {
  const first = await search(q, 1);
  const pages = first.totalNumPages ?? 1;
  const all = [...(first.results ?? [])];
  for (let p = 2; p <= pages; p++) all.push(...((await search(q, p)).results ?? []));
  return all;
}

// Operational heavy-rail + LRT line prefixes only (excludes future JRL/CRL).
const OPERATIONAL = new Set(["NS","EW","CG","NE","CC","CE","DT","TE","BP","SE","SW","PE","PW"]);

// Operational stations that only surface under an interchange partner in the bulk
// search — filled by a targeted name lookup (coords still come from OneMap).
const FILL = {
  EW2: "Tampines MRT", EW11: "Lavender MRT", EW17: "Tiong Bahru MRT",
  NS27: "Marina South Pier MRT",
  NE8: "Farrer Park MRT", NE9: "Boon Keng MRT", NE13: "Kovan MRT",
  CC12: "Bartley MRT", CC17: "Caldecott MRT", CC19: "Botanic Gardens MRT",
  DT3: "Hillview MRT", DT27: "Marina Bay MRT",
  TE11: "Stevens MRT", TE20: "Marina Bay MRT",
};

function parseStation(r) {
  const t = r.SEARCHVAL;
  if (/EXIT|DEPOT/i.test(t)) return null;
  const paren = t.match(/\(([^)]*\d[^)]*)\)/);
  if (!paren) return null;
  const codes = [...paren[1].matchAll(/\b([A-Z]{2}\d+)\b/g)].map((m) => m[1]);
  if (!codes.length) return null;
  const name = t.replace(/\s*\(.*$/, "").replace(/\s+(MRT|LRT)\s+STATION.*/i, "").trim();
  return { name, lat: Number(r.LATITUDE), lng: Number(r.LONGITUDE), codes };
}

const raw = [...(await harvestAll("MRT STATION")), ...(await harvestAll("LRT STATION"))];
const byCode = new Map();
const nameByCode = new Map();
for (const r of raw) {
  const s = parseStation(r);
  if (!s) continue;
  for (const c of s.codes) {
    if (!byCode.has(c)) { byCode.set(c, { code: c, name: s.name, lat: s.lat, lng: s.lng }); nameByCode.set(c, s.name); }
  }
}
// Fill gaps.
for (const [code, q] of Object.entries(FILL)) {
  if (byCode.has(code)) continue;
  const d = await search(q, 1);
  for (const r of d.results ?? []) {
    const s = parseStation(r);
    if (s && s.codes.includes(code)) { byCode.set(code, { code, name: s.name, lat: s.lat, lng: s.lng }); break; }
  }
  if (!byCode.has(code)) console.warn("could not fill", code, q);
}

const lines = {};
for (const s of byCode.values()) {
  const pre = s.code.match(/^[A-Z]{2}/)[0];
  if (!OPERATIONAL.has(pre)) continue;
  (lines[pre] ??= []).push(s);
}
for (const k of Object.keys(lines)) lines[k].sort((a, b) => Number(a.code.slice(2)) - Number(b.code.slice(2)));

// Merge Circle Line + its extension into one ordered chain (CE1,CE2 follow CC29→ via Marina Bay).
// Keep separate prefixes; the overlay colours CE as Circle too.
const out = { generatedAt: new Date().toISOString().slice(0, 10), lines };
writeFileSync("client/src/data/mrtNetwork.json", JSON.stringify(out));
let n = 0;
for (const k of Object.keys(lines).sort()) { n += lines[k].length; console.log(k.padEnd(3), lines[k].length, lines[k].map((s) => s.code).join(",")); }
console.log("TOTAL", n, "stations across", Object.keys(lines).length, "line-prefixes");
