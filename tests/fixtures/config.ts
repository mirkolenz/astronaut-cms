import type { CmsClientConfig } from "@integration/types";

// Minimal stand-in for the build-time `virtual:astronaut-cms/config` module.
// Only fields read at import time matter; the rest stay undefined.
const config: CmsClientConfig = {
  mountPoint: "/admin",
  storageType: "local",
  trailingSlash: "ignore",
  mediaDirectory: "src/assets",
  mediaExtensions: [".png", ".jpg", ".svg", ".pdf"],
  locale: "en",
  contentI18n: { locales: ["en", "de"], defaultLocale: "en" },
};

export default config;
