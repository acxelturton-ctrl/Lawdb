// One projection for the home page map: the drawing (scripts/build-ca-map.mjs) and the pins (src/routes/map.js) both use it, so a firm's logo lands on its city.
// A Lambert conformal conic (the projection Canada's own maps use: parallels 49 and 77, centred on 96 degrees west), fitted to southern Canada: from Vancouver Island
// to Newfoundland and from Windsor north to about 60 degrees, with the Arctic left to run off the top of the drawing. The scale and translation are what
// d3's fitWidth gives for that frame (see the header of scripts/build-ca-map.mjs); they are written down here so the Worker does not fit anything.
import { geoConicConformal } from 'd3-geo';

export const W = 1000, H = 443; // the drawing in images/ca-map.svg
export const projection = () => geoConicConformal().parallels([49, 77]).rotate([96, 0]).center([0, 56]).scale(947.72).translate([469.23, 192.04]);
