import { describe, expect, it } from "vitest";
import { getForm, openForm, redo, setField, undo } from "@/client/stores/form-store";

describe("form history", () => {
  it("undoes typing into one field as one step, back to the stored values", async () => {
    const saved = { title: "a" };

    openForm("posts/a", { values: saved, saved, shape: {}, label: "a" });
    setField("posts/a", "title", "ab");
    setField("posts/a", "title", "abc");
    setField("posts/a", "tags", ["x"]);

    // The editor holding the values commits an undo right after.
    const settle = () => new Promise((resolve) => setTimeout(resolve));

    undo();
    await settle();
    expect(getForm("posts/a")?.values).toEqual({ title: "abc" });

    undo();
    await settle();
    expect(getForm("posts/a")?.values).toBe(saved);

    redo();
    await settle();
    expect(getForm("posts/a")?.values).toEqual({ title: "abc" });
  });
});
