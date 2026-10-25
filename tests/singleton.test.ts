import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ContentValidationError } from "@/shared/diagnostics";
import {
  singletonEntry,
  type CollectionManifest,
  type CollectionManifestEntry,
} from "@/shared/types";
import { createCmsTools } from "@/shared/tools/catalog";
import { contentModel } from "@/shared/tools/content-model";
import { missingSingletons } from "@/integration/check-content";
import { client } from "virtual:astronaut-cms/server";
import { TreeStorage, storageOptions } from "./fixtures/storage";

const firma: CollectionManifestEntry = {
  name: "firma",
  type: "data",
  loaderType: "glob",
  loaderPattern: "firma.yml",
  loaderBase: "src/content",
  loaderFileName: null,
  sort: "id",
  schema: { type: "object", shape: { name: { type: "string" } } },
  label: "Company",
  description: "Master data of the company.",
};

const collections: CollectionManifest = { firma };

describe("singleton collections", () => {
  it("are the glob collections naming one literal file", () => {
    expect(singletonEntry(firma)).toEqual({
      id: "firma",
      format: "yml",
      path: "src/content/firma.yml",
    });
    expect(
      singletonEntry({ loaderType: "glob", loaderPattern: ["./site/About Us.md"], loaderBase: "" }),
    ).toEqual({
      id: "site/about-us",
      format: "md",
      path: "site/About Us.md",
    });
    expect(
      singletonEntry({ loaderType: "glob", loaderPattern: "team\\[2026\\].json", loaderBase: "" }),
    ).toEqual({
      id: "team2026",
      format: "json",
      path: "team[2026].json",
    });

    for (const loaderPattern of ["**/*.md", "firma.{yml,json}", ["firma.yml", "!x.yml"], null]) {
      expect(singletonEntry({ loaderType: "glob", loaderPattern, loaderBase: "" })).toBeNull();
    }

    expect(
      singletonEntry({ loaderType: "file", loaderPattern: null, loaderBase: null }),
    ).toBeNull();
  });

  it("list, write and delete only their one entry", async () => {
    const store = new TreeStorage(storageOptions(collections));
    const entry = { data: { name: "Wolf" }, body: "", format: "yml" as const };

    // The singleton's base holds other collections' files too.
    store.tree = ["src/content/firma.yml", "src/content/pages/home.mdx"];

    expect(await store.listEntries("firma")).toEqual([
      { id: "firma", collection: "firma", format: "yml", path: "src/content/firma.yml" },
    ]);

    await store.saveEntry("firma", "firma", entry);
    expect(store.written).toEqual(["src/content/firma.yml"]);

    await expect(store.saveEntry("firma", "other", entry)).rejects.toThrow(ContentValidationError);
    await expect(store.saveEntry("firma", "firma", { ...entry, format: "json" })).rejects.toThrow(
      ContentValidationError,
    );
    await expect(store.deleteEntry("firma", "firma")).rejects.toThrow(ContentValidationError);
  });

  it("offer agents their one id, and say what they are for", () => {
    const config = { media: client.media, contentI18n: null, collections, components: {} };
    const tool = createCmsTools({ call: () => Promise.reject(new Error("unreachable")), config });
    const schema = z.toJSONSchema(tool.writeEntry_firma!.inputSchema, { io: "input" });

    expect(schema).toMatchObject({ properties: { id: { const: "firma" } } });
    expect(contentModel(config).collections.firma).toMatchObject({
      label: "Company",
      description: "Master data of the company.",
      singleton: "firma",
    });
  });

  it("fail the build without their file", () => {
    expect(missingSingletons(collections, [])).toEqual([
      'src/content/firma.yml: the singleton collection "firma" needs this file, its only entry.',
    ]);
  });
});
