// Shareable links. The hash holds the season, the view and, on the views that
// show a cap sheet, the open team: #/2026-27/dashboard/TOR.
export const VIEWS = ["dashboard", "standings", "trade", "projections"];
const TEAM_VIEWS = ["dashboard", "standings"];

// Parts may come in any order; anything unknown (an old season, a typo) falls
// back to the defaults instead of breaking the page.
export function parseRoute(hash, { seasons, teams, defaultSeason }) {
  const route = { season: defaultSeason, view: "dashboard", team: null };
  (hash || "").replace(/^#\/?/, "").split("/").filter(Boolean).forEach((raw) => {
    let part;
    try {
      part = decodeURIComponent(raw);
    } catch {
      return;
    }
    if (seasons.includes(part)) route.season = part;
    else if (VIEWS.includes(part.toLowerCase())) route.view = part.toLowerCase();
    else if (teams.includes(part.toUpperCase())) route.team = part.toUpperCase();
  });
  if (!TEAM_VIEWS.includes(route.view)) route.team = null;
  return route;
}

export function routeHash({ season, view, team }) {
  return "#/" + [season, view, TEAM_VIEWS.includes(view) ? team : null].filter(Boolean).join("/");
}
