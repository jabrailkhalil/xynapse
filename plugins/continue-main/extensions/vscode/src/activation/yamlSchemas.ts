/** Remove only obsolete Xynapse schema registrations, retaining user mappings. */
export function mergeXynapseYamlSchema(
  schemas: Record<string, unknown> | undefined,
  schemaUri: string,
): Record<string, unknown> {
  const result = { ...schemas };
  for (const [uri, patterns] of Object.entries(result)) {
    let normalized: string;
    try {
      normalized = decodeURI(uri).replace(/\\/g, "/");
    } catch {
      continue;
    }
    const owned =
      /\/(?:xynapse\.xynapse-assistant(?:-[^/]+)?|xynapse-assistant)\/config-yaml-schema\.json$/i.test(
        normalized,
      );
    if (owned && uri !== schemaUri && Array.isArray(patterns)) {
      const remaining = patterns.filter(
        (pattern) => pattern !== ".xynapse/**/*.yaml",
      );
      if (remaining.length) result[uri] = remaining;
      else delete result[uri];
    }
  }
  const existing = result[schemaUri];
  result[schemaUri] = [
    ...new Set([
      ...(Array.isArray(existing) ? existing : []),
      ".xynapse/**/*.yaml",
    ]),
  ];
  return result;
}
