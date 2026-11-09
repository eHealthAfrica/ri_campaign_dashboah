export type BBox = [number, number, number, number];

export interface Counts {
  fixedPost: number;
  outreach: number;
  unreached: number;
  outreachVisited: number;
  unreachedVisited: number;
  fixedVisited: number;
  targetOutreach: number;
  estimated: number;
  distanceBands: number[];
  medianKm: number | null;
  settlements: number;
  visited: number;
  notVisited: number;
  etally: number;
  both: number;
  trackedOnly: number;
  etallyOnly: number;
  neither: number;
  target: number;
  targetVisited: number;
  population: number;
  grids: number;
  buildings: number;
  noGrid: number;
}

export interface Lga extends Counts {
  code: string;
  name: string;
  wards: number;
  completenessPublished: number | null;
  visitPublished: number | null;
  bbox: BBox;
}

export interface Ward extends Counts {
  code: string;
  name: string;
  lgaCode: string;
  lgaName: string;
  visitPublished: number | null;
  bbox: BBox;
}

export interface Settlement {
  id: number;
  name: string;
  wardCode: string;
  wardName: string;
  lgaCode: string;
  lgaName: string;
  facility: string;
  facilityKey: string;
  nearestFacility: string;
  nearestFacilityKm: number | null;
  unreachedReason: string | null;
  visited: boolean;
  /** What the MLoS recorded. Unreached settlements count as not visited even when this is true. */
  visitRecorded: boolean;
  etally: boolean;
  target: number;
  population: number;
  grids: number;
  buildings: number;
  distanceKm: number | null;
  distanceSource: string;
  session: "Fixed post" | "Outreach or mobile" | "Unreached";
  plannedSession: string | null;
  bbox: BBox;
}

export interface CatchmentFacility extends Counts {
  key: string;
  name: string;
  lgaName: string;
  lgaCodes: string[];
  wardCodes: string[];
  method: string;
  listFacility: string | null;
  bbox: BBox;
}

export interface Summary {
  meta: { state: string; asOf: string; source: string };
  totals: Counts & { wards: number; lgas: number };
  lgas: Lga[];
  wards: Ward[];
  facilities: CatchmentFacility[];
  qc: {
    sourceSettlements: number;
    droppedByMlos: number;
    droppedGridCells: number;
    catchment: {
      roadKm: number;
      mainNetworkPct: number;
      settlementsOffMain: number;
      facilities: number;
      mlosDistances: number;
      blank: number;
      blankLocated: number;
      blankNoRoute: number;
      blankOver5: number;
      blankWithin5: number;
      blankNotLocated: number;
      knownLocated: number;
      knownNoRoute: number;
      blankTakeoffDiffers: number;
      outreachWithinOtherFacility: number;
      unreachedWithin5OfListed: number;
      unreachedUnder5: number;
      catchments: number;
      mlosNames: number;
      spellingMerged: number;
      methods: Record<string, number>;
      settlementsByMethod: Record<string, number>;
      notLocated: string[];
      fromNational: string[];
      confirmedSettlements: number;
      confirmedMedianDiffM: number;
      confirmedWithin250Pct: number;
      spearman: number;
      knownAssignedOver5: number;
    };
    plannedSessions: { planned: string; fixedPost: number; outreach: number; unreached: number }[];
    plannedBlank: number;
    facilityOwners: { public: number; total: number };
    gridVisited: number;
    gridTotal: number;
    emptyFields: { Visit_Grid: number; comp_percent: number };
    duplicateCodes: { code: string; id: number; ward: string }[];
    visitedNoGrid: number;
    intersectNo: number;
    flaggedWardsNoSettlements: { code: string; name: string; lga: string }[];
    teamFields: { lga: string; planned: number | null; active: number | null }[];
  };
}

export interface Filters {
  lga: string | null;
  facility: string | null;
  ward: string | null;
  settlement: number | null;
}

export type Page = "overview" | "map" | "analysis" | "quality" | "downloads";
