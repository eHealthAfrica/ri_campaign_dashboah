import { useMemo } from "react";
import { Filter, X } from "lucide-react";
import { number, type Scope } from "../lib";
import { usePrefs } from "../prefs";
import type { Filters, Settlement, Summary } from "../types";

interface Props {
  summary: Summary;
  settlements: Settlement[] | null;
  filters: Filters;
  select: (next: Partial<Filters>) => void;
  signedIn: boolean;
  scope: Scope;
}

export function FilterBar({ summary, settlements, filters, select, signedIn, scope }: Props) {
  const { t } = usePrefs();
  const wards = useMemo(() => summary.wards.filter((w) => w.lgaCode === filters.lga), [summary, filters.lga]);
  const inWard = useMemo(
    () => (settlements ?? [])
      .filter((s) => (filters.ward && s.wardCode === filters.ward) || (filters.facility && s.facilityKey === filters.facility))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [settlements, filters.ward, filters.facility],
  );
  const narrowed = Boolean(filters.ward || filters.facility);
  const catchments = useMemo(
    () => summary.facilities
      .filter((f) => !filters.lga || f.lgaCodes.includes(filters.lga))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [summary, filters.lga],
  );
  const settlementHint = t(!signedIn ? "Sign in to choose" : narrowed ? "All settlements" : "Pick an area first");

  return (
    <div className="filters">
      <span className="filter-title"><Filter size={16} aria-hidden />{t("Location")}</span>
      <div className="filter">
        <label htmlFor="f-lga">{t("LGA")}</label>
        <select
          id="f-lga"
          value={filters.lga ?? ""}
          onChange={(e) => select({ lga: e.target.value || null, facility: null, ward: null, settlement: null })}
        >
          <option value="">{t("All LGAs")}</option>
          {summary.lgas.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>
      <div className="filter">
        <label htmlFor="f-facility">{t("Facility catchment")}</label>
        <select
          id="f-facility"
          value={filters.facility ?? ""}
          onChange={(e) => select({ facility: e.target.value || null, ward: null, settlement: null })}
        >
          <option value="">{t("All catchments")}</option>
          {catchments.map((f) => <option key={f.key} value={f.key}>{f.name}</option>)}
        </select>
      </div>
      <div className="filter">
        <label htmlFor="f-ward">{t("Ward")}</label>
        <select
          id="f-ward"
          disabled={!filters.lga}
          value={filters.ward ?? ""}
          onChange={(e) => select({ ward: e.target.value || null, facility: null, settlement: null })}
        >
          <option value="">{t(filters.lga ? "All wards" : "Pick an LGA first")}</option>
          {wards.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
        </select>
      </div>
      <div className="filter">
        <label htmlFor="f-settlement">{t("Settlement")}</label>
        <select
          id="f-settlement"
          disabled={!narrowed || !signedIn}
          value={filters.settlement ?? ""}
          onChange={(e) => select({ settlement: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">{settlementHint}</option>
          {inWard.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <button
        className="reset"
        disabled={!filters.lga && !filters.facility}
        onClick={() => select({ lga: null, facility: null, ward: null, settlement: null })}
      >
        <X size={15} aria-hidden />{t("Reset")}
      </button>
      <span className="filter-count">{t(filters.lga || filters.facility ? "{n} settlements" : "All {n} settlements", { n: number(scope.counts.settlements) })}</span>
    </div>
  );
}
