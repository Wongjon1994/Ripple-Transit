/**
 * Dining safety layer (Phase 15 addendum §2a).
 *
 * NEA's Licensed Eating Establishments list (36k rows, address-only CSV)
 * can't power discovery, but it carries real inspection data: hygiene grade,
 * demerit points, suspension dates. We index it by postal code and join it
 * onto dining results via a confident name match — grade badges only when the
 * match is solid, suspension = hard exclusion, no match = no claim.
 */
import { fetchDatasetText, parseCsv, dailyCache } from "./datagov.js";

const DATASET_ID = "d_227473e811b09731e64725f140b77697";

export interface SafetyRecord {
  name: string;
  grade?: string;
  demerits?: number;
  suspendedFrom?: Date;
  suspendedTo?: Date;
}

export function extractPostal(address: string | undefined): string | null {
  if (!address) return null;
  const m = /SINGAPORE\s+(\d{6})/i.exec(address) ?? /\b(\d{6})\s*$/.exec(address);
  return m ? m[1] : null;
}

/** NEA dates arrive as "na", DD/MM/YYYY or YYYY-MM-DD. */
export function parseNeaDate(s: string | undefined): Date | undefined {
  if (!s || /^na$/i.test(s.trim())) return undefined;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (dmy) return new Date(+dmy[3], +dmy[2] - 1, +dmy[1]);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  return undefined;
}

export function isSuspended(rec: SafetyRecord, now = new Date()): boolean {
  if (!rec.suspendedFrom) return false;
  if (now < rec.suspendedFrom) return false;
  return rec.suspendedTo ? now <= rec.suspendedTo : true;
}

// ── Name matching ─────────────────────────────────────────────
// Licensee names are corporate ("REPUBLIC HOTELS & RESORTS LIMITED") while
// map names are storefronts — only claim a match on real token overlap.

const NOISE =
  /\b(pte|ltd|llp|limited|private|singapore|s|the|and|of|co|company)\b/g;

export function nameTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(NOISE, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

export function nameMatch(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  const smaller = Math.min(ta.size, tb.size);
  return overlap / smaller >= 0.5;
}

// ── Index ─────────────────────────────────────────────────────

const loadIndex = dailyCache(
  async (): Promise<Map<string, SafetyRecord[]>> => {
    const rows = parseCsv(await fetchDatasetText(DATASET_ID));
    const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
    const col = (name: string) => header.indexOf(name);
    const iName = col("licensee_name");
    const iAddr = col("premises_address");
    const iGrade = col("grade");
    const iDem = col("demerit_points");
    const iFrom = col("suspension_start_date");
    const iTo = col("suspension_end_date");
    if (iName < 0 || iAddr < 0) throw new Error("NEA CSV: unexpected header");

    const index = new Map<string, SafetyRecord[]>();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const postal = extractPostal(r[iAddr]);
      if (!postal) continue;
      const grade = r[iGrade]?.trim();
      const rec: SafetyRecord = {
        name: r[iName]?.trim() ?? "",
        grade: grade && !/^na$/i.test(grade) ? grade.toUpperCase() : undefined,
        demerits: /^\d+$/.test(r[iDem]?.trim() ?? "")
          ? Number(r[iDem])
          : undefined,
        suspendedFrom: parseNeaDate(r[iFrom]),
        suspendedTo: parseNeaDate(r[iTo]),
      };
      const arr = index.get(postal);
      if (arr) arr.push(rec);
      else index.set(postal, [rec]);
    }
    if (index.size === 0) throw new Error("NEA CSV parsed to 0 records");
    return index;
  },
);

/**
 * Inspection data for a dining result, joined by postal + confident name
 * match. Returns null when nothing can honestly be claimed.
 */
export async function safetyFor(
  name: string,
  address: string | undefined,
): Promise<{ grade?: string; suspended: boolean } | null> {
  const postal = extractPostal(address);
  if (!postal) return null;
  let index: Map<string, SafetyRecord[]>;
  try {
    index = await loadIndex();
  } catch {
    return null; // dataset unavailable — no claims, no blocking
  }
  const candidates = index.get(postal);
  if (!candidates) return null;
  const match = candidates.find((rec) => nameMatch(name, rec.name));
  if (!match) return null;
  return { grade: match.grade, suspended: isSuspended(match) };
}
