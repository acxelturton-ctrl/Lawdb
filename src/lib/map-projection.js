// One projection for the home page map: the drawing (scripts/build-ca-map.mjs) and the pins (src/routes/map.js) both use it, so a firm's logo lands on its city.
// A Lambert conformal conic (the projection Canada's own maps use: parallels 49 and 77, centred on 96 degrees west), fitted to the whole country from the Yukon to
// Newfoundland, with the bottom edge just below the southern tip of Ontario and the far north running off the top of the drawing (it is shown up to about 72 degrees
// north). The scale and translation are what d3's fitExtent gives for that (see the header of scripts/build-ca-map.mjs); they are written down here so the Worker
// does not fit anything.
import { geoConicConformal } from 'd3-geo';

export const W = 1000, H = 620; // the drawing in images/ca-map.svg
export const projection = () => geoConicConformal().parallels([49, 77]).rotate([96, 0]).center([0, 63]).scale(1170.16).translate([427.74, 197.43]);
