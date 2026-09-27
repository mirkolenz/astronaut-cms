import { afterEach, describe, expect, it, vi } from "vitest";
import { S3Store } from "@/media/s3-store";

const credentials = { accessKeyId: "key", secretAccessKey: "secret" };
const target = {
  endpoint: "https://objects.example.com/gateway",
  bucket: "media",
  pathStyle: true,
  region: "auto",
};

afterEach(() => vi.restoreAllMocks());

describe("S3Store", () => {
  it("preserves the endpoint path and reads XML keys", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `<ListBucketResult xmlns="urn:s3"><Contents><Key><![CDATA[image<one>.png]]></Key><Size>7</Size><ETag>"abc"</ETag></Contents><IsTruncated>false</IsTruncated></ListBucketResult>`,
      ),
    );

    const objects = await new S3Store(target, credentials).list("");
    const request = fetcher.mock.calls[0]?.[0];

    expect(request).toBeInstanceOf(Request);
    expect(new URL((request as Request).url).pathname).toBe("/gateway/media");
    expect(objects).toEqual([{ key: "image<one>.png", size: 7, version: "abc" }]);
  });

  it("preserves the endpoint path with virtual host addressing", async () => {
    const store = new S3Store({ ...target, pathStyle: false }, credentials);
    const upload = await store.presignUpload("photo.png", {
      length: 7,
      contentType: "image/png",
      attachment: false,
      ifAbsent: true,
    });
    const url = new URL(upload?.url ?? "");

    expect(url.hostname).toBe("media.objects.example.com");
    expect(url.pathname).toBe("/gateway/photo.png");
  });

  it("rejects an XML error within a successful copy response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`<s3:Error xmlns:s3="urn:s3"><s3:Code>InternalError</s3:Code></s3:Error>`),
    );

    await expect(new S3Store(target, credentials).copy("from.png", "to.png")).rejects.toThrow(
      "S3 copy of from.png to to.png failed",
    );
  });

  // An active type is served as a download, so the disposition is a term the
  // upload cannot drop without breaking the signature.
  it("signs the disposition of an active type into the upload", async () => {
    const { url, headers } = await new S3Store(target, credentials).presignUpload("icon.svg", {
      length: 3,
      contentType: "image/svg+xml",
      attachment: true,
      ifAbsent: true,
    });

    expect(headers).toMatchObject({ "content-disposition": "attachment", "if-none-match": "*" });
    expect(new URL(url).searchParams.get("X-Amz-SignedHeaders")).toContain("content-disposition");
  });

  it("infers the signing region from the endpoint when none is set", async () => {
    const { region: _, ...regionless } = target;
    const store = new S3Store({ ...regionless, endpoint: "https://s3.eu-central-1.amazonaws.com" }, credentials);
    const { url } = await store.presignUpload("photo.png", {
      length: 7,
      contentType: "image/png",
      attachment: false,
      ifAbsent: false,
    });

    expect(new URL(url).searchParams.get("X-Amz-Credential")).toMatch(/\/eu-central-1\/s3\/aws4_request$/);
  });
});
