import type { Scope } from "../lib";
import type { Filters, Settlement, Summary } from "../types";

export interface PageProps {
  summary: Summary;
  settlements: Settlement[] | null;
  filters: Filters;
  scope: Scope;
  select: (next: Partial<Filters>) => void;
  signedIn: boolean;
}
