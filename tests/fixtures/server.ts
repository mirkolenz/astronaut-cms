import type { CmsServerConfig } from "@integration/types";

// Stand-in for the build-time `virtual:astronaut-cms/server` module. Local
// storage, so no provider credential is involved in a test run.
const config: CmsServerConfig = {
  storage: { type: "local", rootDir: process.cwd() },
  media: null,
  ai: null,
  mediaDirectory: "src/assets",
  mediaExtensions: [".png", ".jpg", ".svg", ".pdf"],
  maxFileSize: null,
};

export default config;
