# RI Campaign Dashboard

Monitoring dashboard for the routine immunization campaign in Lagos: which settlements were
visited, how much target population remains unvisited, and where the data sources disagree.

## Run it

Requires Node 22+ and Python 3 with `geopandas`, `pyogrio` and `shapely`.

```bash
npm install
python3 scripts/build_catchment.py        # facility catchments and session types
npm run data -- ../Lagos_Unicef_ta.gpkg   # generate data/ from the geopackage
npm run add-user -- yourname              # create a login (prompts for a password)
npm run build
npm start                                 # http://localhost:8787
```

Use `npm run dev` for development with hot reload, and `npm test` for the server tests.

## Look and language

The theme and language menus are in the top bar, and each browser remembers its choice. Themes are the
token blocks at the top of `src/styles.css`, and the map switches between light and dark basemaps with them.
Hausa, Yorùbá and Igbo text is in `src/i18n.ts`. It covers navigation, labels and headings; longer notes
stay in English. It has not been reviewed by native speakers, so have that done before sharing it widely.

## Accounts

`npm run add-user -- <username>` creates an account and requires at least 10 characters. A local `demo`
account with a short password exists in `server/users.json` for trying the dashboard. Remove it before
hosting the dashboard anywhere other people can reach.

## How it fits together

| Path | Purpose |
|---|---|
| `scripts/build_catchment.py` | Extracts the four-LGA RI facilities, locates catchment facilities, and assigns session types using the Lagos road network. |
| `scripts/build_data.py` | Turns the geopackage, MLoS results and facilities into JSON and GeoJSON. Stops if totals do not reconcile. |
| `server/app.mjs` | Serves the app and data, and handles sign-in. Uses Node built-ins only. |
| `src/` | React app. `components/MapView.tsx` holds the map; `pages/` holds one file per page. |

## Data sources

Kept in the parent folder, outside the repository: `Lagos_Unicef_ta.gpkg` (settlements, visits, grids),
`lagosmlos_Valid.xlsx` (master settlement list, under-5 target, catchment distances) and
`Lagos HF Comprehensive List.xlsx` (RI facilities). `health_facility.sqlite` (`--national`) supplies two
catchment facilities missing from that list. `Lagos Road/Lagos State Road.shp` is the road network. The MLoS decides which settlements count. Staff names and
contact details in the facility list are not extracted. The road file carries OpenStreetMap IDs: © OpenStreetMap contributors.

## Access

- **Public view:** LGA and ward totals only, from `data/public/`.
- **Signed in:** adds settlements and grid cells, from `data/restricted/`. The server enforces this.

`data/` and `server/users.json` are gitignored. Settlement-level data never goes into the
repository, so generate `data/` on each machine or server.

## Deploying

Set `NODE_ENV=production` so session cookies are HTTPS-only, and run behind HTTPS. Set
`RI_SESSION_SECRET` to a long random value, and `PORT`, `RI_DATA_DIR` and `RI_USERS_FILE` as needed.
The login lockout is held in memory, so it assumes a single server process.

## Metric definitions

| Metric | Definition |
|---|---|
| Settlements visited | `Settlement.visitation_status = 'V'`, except unreached settlements, which always count as not visited (programme decision). The recorded value stays in the settlement download as `visit_recorded_in_mlos`. |
| Reported in eTally | `Settlement.etally_visitation = 'V'` |
| Target under-5 population | Sum of `set_target`. |
| Under-5s in visited settlements | `set_target` where visited. Children living there, not children vaccinated. |
| Session type | 0–5 km along the road network is a fixed post; above 5 km is outreach or mobile. Unreached means no connected road route, or no located facility. |
| Facility teams | One team of 3 per catchment facility named in the MLoS, for areas fixed posts cannot cover: outreach, mobile and unreached settlements. Calculated, not reported. |
| Road distance | MLoS `distance_meters`. Where blank (392 settlements), the route to the settlement's own catchment facility on the Lagos road network. With no connected route, or no located facility, the settlement is "Unreached". |
| Facility catchment | Settlements sharing a catchment facility in the MLoS, with spelling variants merged. |
| Grid completeness | `Lagos_Lga.com_percent` and `Lagos_Ward.Visit_Percent`, as published. Cannot be recalculated. |

The Quality Checks page lists the known problems in the source file.
