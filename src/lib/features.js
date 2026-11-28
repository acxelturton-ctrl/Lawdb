// Switches for things the site has built but does not show right now.
//
// LAWDB_RATINGS: LawDB member ratings (the stars box under a firm's map, the "Rate this firm on LawDB" link beside the Google rating, "Your ratings" in a member's profile).
// Hidden for now (the owner's decision, November 2026). Nothing was removed: the ratings, comments and the admin's review screen are all still stored and working behind it.
// To show them again set this to true, and set RATINGS_VISIBLE to true in account/account.js (a browser script, so it keeps its own copy; scripts/test-ratings-hidden.mjs fails if the two differ).
export const LAWDB_RATINGS = false;
