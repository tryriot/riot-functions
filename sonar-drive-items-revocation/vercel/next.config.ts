import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The app imports ../lib, so the build root is the function folder rather than this one.
const functionRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const config: NextConfig = {
  turbopack: { root: functionRoot },
  outputFileTracingRoot: functionRoot,
};

export default config;
