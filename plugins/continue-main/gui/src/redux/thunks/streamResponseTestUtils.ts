/**
 * Symbol extraction is intentionally dispatched without blocking token
 * streaming. Its fulfilled Redux action can therefore race with the first
 * synchronous stream actions. Tests compare the semantic sequence after
 * placing that one completion at the stable checkpoint used by the fixtures.
 */
export function stabilizeSymbolUpdateActionOrder<T extends { type: string }>(
  actions: T[],
): T[] {
  const completed = actions.filter(
    (action) => action.type === "symbols/updateFromContextItems/fulfilled",
  );
  if (completed.length === 0) return actions;

  const stable = actions.filter(
    (action) => action.type !== "symbols/updateFromContextItems/fulfilled",
  );
  const checkpoint = stable.findIndex(
    (action) => action.type === "session/setContextPercentage",
  );
  const terminalStreamAction = stable.findIndex(
    (action) =>
      action.type === "chat/streamNormalInput/fulfilled" ||
      action.type === "chat/streamNormalInput/rejected",
  );
  const insertionIndex =
    checkpoint >= 0
      ? checkpoint + 1
      : terminalStreamAction >= 0
        ? terminalStreamAction
        : stable.length;
  stable.splice(insertionIndex, 0, ...completed);
  return stable;
}

const ERROR_SAVE_ACTIONS = new Set([
  "session/saveCurrent/pending",
  "session/update/pending",
  "session/updateSessionMetadata",
  "session/refreshMetadata/pending",
  "session/setIsSessionMetadataLoading",
  "session/setAllSessionMetadata",
  "session/refreshMetadata/fulfilled",
  "session/update/fulfilled",
  "session/saveCurrent/fulfilled",
]);

/** Save-on-error is background durability work and is covered by session tests. */
export function withoutBackgroundErrorSave<T extends { type: string }>(
  actions: T[],
): T[] {
  return actions.filter((action) => !ERROR_SAVE_ACTIONS.has(action.type));
}
