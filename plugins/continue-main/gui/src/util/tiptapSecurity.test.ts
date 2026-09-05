import { mergeAttributes } from "@tiptap/core";
import { DOMSerializer, Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

describe("Tiptap attribute security (GHSA-cp6q-959q-f8rh)", () => {
  it("does not turn JSON prototype keys into executable DOM attributes", () => {
    const untrusted = JSON.parse(
      '{"__proto__":{"src":"invalid://fixture","onerror":"fixture()","data-inherited":"unexpected"}}',
    );
    const attrs = mergeAttributes({ "data-safe": "preserved" }, untrusted);
    expect(Object.getPrototypeOf(attrs)).toBe(Object.prototype);
    expect(attrs.onerror).toBeUndefined();
    const schema = new Schema({
      nodes: {
        doc: { content: "image" },
        image: { toDOM: () => ["img", attrs] },
        text: {},
      },
    });
    const doc = schema.node("doc", null, [schema.node("image")]);
    const fragment = DOMSerializer.fromSchema(schema).serializeFragment(
      doc.content,
    );
    const img = fragment.firstChild as HTMLImageElement;
    expect(img.getAttribute("data-safe")).toBe("preserved");
    for (const attribute of ["src", "onerror", "data-inherited"]) {
      expect(img.hasAttribute(attribute)).toBe(false);
    }
  });

  it("continues to merge ordinary classes and styles", () => {
    const attrs = mergeAttributes(
      { class: "input focused", style: "color: red" },
      { class: "focused editable", style: "color: blue" },
    );
    expect(attrs.class).toBe("input focused editable");
    expect(attrs.style).toBe("color: blue");
  });
});
