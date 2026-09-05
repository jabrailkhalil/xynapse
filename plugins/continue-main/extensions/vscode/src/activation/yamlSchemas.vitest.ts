import { describe, expect, it } from "vitest";
import { mergeXynapseYamlSchema } from "./yamlSchemas";
const old =
  "file:///extensions/xynapse.xynapse-assistant-1.0.1/config-yaml-schema.json";
const current =
  "file:///extensions/xynapse.xynapse-assistant-1.0.2/config-yaml-schema.json";
describe("YAML schema registration", () => {
  it("preserves user mappings, including custom uses of old schemas", () => {
    const input = {
      "https://example.test/k8s.json": ["deploy/*.yaml"],
      [old]: [".xynapse/**/*.yaml", "special.yaml"],
      "file:///custom/config-yaml-schema.json": [".xynapse/**/*.yaml"],
      "%bad-uri": ["keep.yaml"],
    };
    const result = mergeXynapseYamlSchema(input, current);
    expect(result[old]).toEqual(["special.yaml"]);
    expect(result["https://example.test/k8s.json"]).toEqual(["deploy/*.yaml"]);
    expect(result["file:///custom/config-yaml-schema.json"]).toEqual([
      ".xynapse/**/*.yaml",
    ]);
    expect(result["%bad-uri"]).toEqual(["keep.yaml"]);
    expect(input[old]).toHaveLength(2);
  });
  it("removes only obsolete owned entries and is idempotent", () => {
    const result = mergeXynapseYamlSchema(
      { [old]: [".xynapse/**/*.yaml"] },
      current,
    );
    expect(result[old]).toBeUndefined();
    expect(result[current]).toEqual([".xynapse/**/*.yaml"]);
    expect(mergeXynapseYamlSchema(result, current)).toEqual(result);
  });
});
