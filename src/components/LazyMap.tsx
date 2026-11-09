import { lazy, Suspense, type ComponentProps } from "react";
import { usePrefs } from "../prefs";

// The map library is by far the largest download, so it loads only once a map is on screen.
const Inner = lazy(() => import("./MapView").then((m) => ({ default: m.MapView })));

export function MapView(props: Omit<ComponentProps<typeof Inner>, "dark">) {
  const { dark } = usePrefs();
  // A different basemap means rebuilding the map, and a new key does exactly that.
  return (
    <Suspense fallback={<div className="map-loading">Loading map…</div>}>
      <Inner key={dark ? "dark" : "light"} {...props} dark={dark} />
    </Suspense>
  );
}
