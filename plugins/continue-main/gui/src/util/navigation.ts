// Valid config tab names
export type ConfigTab =
  | "overview"
  | "models"
  | "rules"
  | "tools"
  | "configs"
  | "settings";

// TODO: Move all the routes here
export const ROUTES = {
  HOME: "/",
  HOME_INDEX: "/index.html",
  CONFIG: "/config",
  THEME: "/theme",
  STATS: "/stats",
  // EXAMPLE_ROUTE_WITH_PARAMS: (params: ParamsType) => `/route/${params}`,
};

// Helper function to build config URLs with tabs
export const buildConfigRoute = (tab?: ConfigTab): string => {
  return tab ? `${ROUTES.CONFIG}?tab=${tab}` : ROUTES.CONFIG;
};

// Typed config route builders for common tabs
export const CONFIG_ROUTES = {
  OVERVIEW: buildConfigRoute("overview"),
  MODELS: buildConfigRoute("models"),
  RULES: buildConfigRoute("rules"),
  TOOLS: buildConfigRoute("tools"),
  CONFIGS: buildConfigRoute("configs"),
  SETTINGS: buildConfigRoute("settings"),
} as const;
