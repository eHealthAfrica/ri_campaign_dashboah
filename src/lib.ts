import type { BBox, CatchmentFacility, Counts, Filters, Lga, Settlement, Summary, Ward } from "./types";

export const number = (n: number) => n.toLocaleString("en-NG");
export const percent = (part: number, whole: number, digits = 1) =>
  whole === 0 ? "–" : `${((100 * part) / whole).toFixed(digits)}%`;
export const share = (part: number, whole: number) => (whole === 0 ? 0 : (100 * part) / whole);
export const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

export interface Scope {
  label: string;
  counts: Counts;
  bbox: BBox | null;
  lga: Lga | null;
  ward: Ward | null;
  catchment: CatchmentFacility | null;
  settlement: Settlement | null;
}

/** Each catchment facility organizes one team of this many people for areas fixed posts cannot cover. */
export const TEAM_SIZE = 3;

export function teamsFor(summary: Summary, scope: Scope) {
  const rows = scope.catchment
    ? [scope.catchment]
    : scope.ward
      ? summary.facilities.filter((f) => f.wardCodes.includes(scope.ward!.code))
      : scope.lga
        ? summary.facilities.filter((f) => f.lgaCodes.includes(scope.lga!.code))
        : summary.facilities;
  const areas = scope.counts.outreach + scope.counts.unreached;
  return {
    teams: rows.length,
    members: rows.length * TEAM_SIZE,
    areas,
    // Below LGA level this counts a whole catchment's work, unless the selection itself has none.
    withAreas: areas === 0 ? 0 : rows.filter((f) => f.outreach + f.unreached > 0).length,
  };
}

export const km = (value: number | null) => (value === null ? "–" : `${value.toFixed(1)} km`);

/** Settlements inside the selected LGA, and catchment or ward. */
export const inFilters = (s: Settlement, f: Filters) =>
  (!f.lga || s.lgaCode === f.lga) && (!f.ward || s.wardCode === f.ward) && (!f.facility || s.facilityKey === f.facility);

/** Resolves the filters to the row whose roll-up the page should show. */
export function resolveScope(summary: Summary, filters: Filters, settlements: Settlement[] | null): Scope {
  const lga = summary.lgas.find((l) => l.code === filters.lga) ?? null;
  const ward = summary.wards.find((w) => w.code === filters.ward) ?? null;
  const settlement = settlements?.find((s) => s.id === filters.settlement) ?? null;
  const catchment = summary.facilities.find((f) => f.key === filters.facility) ?? null;
  if (catchment) {
    return { label: `${catchment.name} catchment`, counts: catchment, bbox: settlement?.bbox ?? catchment.bbox, lga, ward: null, catchment, settlement };
  }
  if (ward) {
    return { label: `${ward.name} ward, ${ward.lgaName}`, counts: ward, bbox: settlement?.bbox ?? ward.bbox, lga, ward, catchment: null, settlement };
  }
  if (lga) return { label: `${lga.name} LGA`, counts: lga, bbox: lga.bbox, lga, ward: null, catchment: null, settlement: null };
  return {
    label: `${summary.totals.lgas} implementing LGAs, ${summary.meta.state}`,
    counts: summary.totals,
    bbox: null,
    lga: null,
    ward: null,
    catchment: null,
    settlement: null,
  };
}

export function downloadCsv(filename: string, header: string[], rows: (string | number | boolean | null)[][]) {
  const cell = (value: string | number | boolean | null) => {
    let text = value === null ? "" : String(value);
    // A leading = + - @ would run as a formula when the file is opened in a spreadsheet.
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
