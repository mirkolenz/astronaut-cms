import { config } from "zod";

// Zod probes for `eval` as its first object schema is built, to compile faster
// parsers, which the admin's CSP refuses with a violation report.
// The config is global, so set before any schema exists it also covers the
// site's own copy of Zod.
config({ jitless: true });
