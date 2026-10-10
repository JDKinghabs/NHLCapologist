// Shareable links. The path holds the view, the open team and, when it isn't
// the current one, the season: /teams/TOR, /standings, /2027-28/teams/TOR.
// Leaving the current season out keeps /teams/TOR a permanent link.
export const VIEWS = ["dashboard", "standings", "trade", "projections"];
const TEAM_VIEWS = ["dashboard", "standings"];
const VIEW_TITLES = {
  dashboard: "NHL Salary Cap Tracker",
  standings: "NHL Standings and Payrolls",
  trade: "NHL Trade Cap Checker",
  projections: "NHL Salary Cap Projections",
};

// Parts may come in any order; anything unknown (an old season, a typo) falls
// back to the defaults instead of breaking the page. Also reads the old
// "#/2026-27/dashboard/TOR" links.
export function parseRoute(location, { seasons, teams, defaultSeason }) {
  const route = { season: defaultSeason, view: "dashboard", team: null };
  (location || "").replace(/^#?\/?/, "").split("/").filter(Boolean).forEach((raw) => {
    let part;
    try {
      part = decodeURIComponent(raw);
    } catch {
      return;
    }
    const word = part.toLowerCase();
    if (seasons.includes(part)) route.season = part;
    else if (word === "teams") route.view = "dashboard";
    else if (VIEWS.includes(word)) route.view = word;
    else if (teams.includes(part.toUpperCase())) route.team = part.toUpperCase();
  });
  if (!TEAM_VIEWS.includes(route.view)) route.team = null;
  return route;
}

export function routePath({ season, view, team }, defaultSeason) {
  const parts = season && season !== defaultSeason ? [season] : [];
  if (view === "dashboard") {
    if (team) parts.push("teams", team);
  } else {
    parts.push(view);
    if (team && TEAM_VIEWS.includes(view)) parts.push(team);
  }
  return "/" + parts.join("/");
}

export function pageTitle({ season, view }, teamName) {
  return `${teamName ? `${teamName} Salary Cap` : VIEW_TITLES[view]} ${season} · IceCap`;
}
