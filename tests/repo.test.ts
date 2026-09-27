import { expect, it } from "vitest";
import { parseRepo } from "@/shared/repo";

it("requires exactly one owner and repository segment", () => {
  expect(parseRepo("owner/repo")).toEqual({ owner: "owner", repo: "repo" });
  expect(() => parseRepo("owner/repo/extra")).toThrow(/Invalid GitHub repo/);
});
