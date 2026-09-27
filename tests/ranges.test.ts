import { expect, it } from "vitest";
import { fetchRange } from "@/server/ranges";

it("rejects partial upstream bytes without a content range", async () => {
  const send = () => Promise.resolve(new Response("partial", { status: 206 }));

  await expect(fetchRange(send, { start: 0, end: 2 })).rejects.toMatchObject({ status: 502 });
});
