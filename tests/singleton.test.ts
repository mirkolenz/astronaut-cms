import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ContentValidationError } from "@/shared/diagnostics";
import {
  findSingleton,
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
  singleton: {
    main: { id: "firma", format: "yml", path: "src/content/firma.yml" },
    translations: [],
  },
  schema: { type: "object", shape: { name: { type: "string" } } },
  label: "Company",
  description: "Master data of the company.",
};

const collections: CollectionManifest = { firma };

const i18n = { locales: ["en", "de"], defaultLocale: "de" };
const textsSource = {
  loaderType: "glob",
  loaderPattern: "*/site.yaml",
  loaderBase: "src/content/texts",
} as const;

describe("singleton collections", () => {
  it("are the glob collections naming one literal file", () => {
    const main = (loaderPattern: string | string[] | null) =>
      findSingleton({ loaderType: "glob", loaderPattern, loaderBase: "" }, null)?.main ?? null;

    expect(findSingleton(firma, null)).toEqual(firma.singleton);
    expect(main(["./site/About Us.md"])).toEqual({
      id: "site/about-us",
      format: "md",
      path: "site/About Us.md",
    });
    expect(main("team\\[2026\\].json")).toEqual({
      id: "team2026",
      format: "json",
      path: "team[2026].json",
    });

    for (const loaderPattern of ["**/*.md", "firma.{yml,json}", ["firma.yml", "!x.yml"], null]) {
      expect(main(loaderPattern)).toBeNull();
    }

    expect(
      findSingleton({ loaderType: "file", loaderPattern: null, loaderBase: null }, null),
    ).toBeNull();
  });

  it("are localized with one file per language, the default language's the main one", () => {
    expect(findSingleton(textsSource, i18n)).toEqual({
      main: { id: "de/site", format: "yaml", path: "src/content/texts/de/site.yaml" },
      translations: [{ id: "en/site", format: "yaml", path: "src/content/texts/en/site.yaml" }],
    });
    expect(
      findSingleton({ ...textsSource, loaderPattern: "{de,en}/site.yaml" }, i18n),
    ).not.toBeNull();
    expect(findSingleton({ ...textsSource, loaderPattern: "*/*.yaml" }, i18n)).toBeNull();
    expect(findSingleton(textsSource, null)).toBeNull();
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

    expect(schema).toMatchObject({ properties: { id: { enum: ["firma"] } } });
    expect(contentModel(config).collections.firma).toMatchObject({
      label: "Company",
      description: "Master data of the company.",
      singleton: ["firma"],
    });
  });

  it("of one file per language take only their languages, and need the default one", async () => {
    const texts: CollectionManifestEntry = {
      ...firma,
      ...textsSource,
      name: "texts",
      singleton: findSingleton(textsSource, i18n),
    };
    const store = new TreeStorage(storageOptions({ texts }));
    const entry = { data: { name: "Wolf" }, body: "", format: "yaml" as const };

    await store.saveEntry("texts", "en/site", entry);
    await expect(store.saveEntry("texts", "fr/site", entry)).rejects.toThrow(
      ContentValidationError,
    );
    await expect(store.deleteEntry("texts", "de/site")).rejects.toThrow(ContentValidationError);
    expect(missingSingletons({ texts }, [])).toEqual({
      required: [
        'src/content/texts/de/site.yaml: the singleton collection "texts" needs this file.',
      ],
      translations: [
        'src/content/texts/en/site.yaml: the singleton collection "texts" needs this file.',
      ],
    });
  });

  it("fail the build without their file", () => {
    expect(missingSingletons(collections, [])).toEqual({
      required: ['src/content/firma.yml: the singleton collection "firma" needs this file.'],
      translations: [],
    });
  });
});
