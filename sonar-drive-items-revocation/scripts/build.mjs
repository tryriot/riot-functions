// Bundles the receiver into one self-contained file per platform: node scripts/build.mjs [aws|azure|gcp]...
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const common = { bundle: true, platform: "node", target: "node22", legalComments: "none", logLevel: "warning" };

const targets = {
  async aws() {
    await build({
      ...common,
      entryPoints: [join(root, "aws/index.ts")],
      outfile: join(dist, "aws/index.mjs"),
      format: "esm",
      // The Lambda Node.js runtime ships the AWS SDK v3.
      external: ["@aws-sdk/*"],
    });
  },
  async azure() {
    const out = join(dist, "azure");
    await build({
      ...common,
      entryPoints: [join(root, "azure/index.ts")],
      outfile: join(out, "index.js"),
      format: "cjs",
      // Provided by the Functions host at runtime, never installed from npm.
      external: ["@azure/functions-core"],
    });
    cpSync(join(root, "azure/host.json"), join(out, "host.json"));
    writeFileSync(join(out, "package.json"), JSON.stringify({ name: "sonar-drive-items-revocation", main: "index.js" }, null, 2));
  },
  async gcp() {
    await build({ ...common, entryPoints: [join(root, "gcp/main.ts")], outfile: join(dist, "gcp/server.mjs"), format: "esm" });
  },
};

const requested = process.argv.slice(2);
for (const name of requested.length ? requested : Object.keys(targets)) {
  if (!targets[name]) throw new Error(`unknown target ${name}`);
  rmSync(join(dist, name), { recursive: true, force: true });
  mkdirSync(join(dist, name), { recursive: true });
  await targets[name]();
  console.log(`built dist/${name}`);
}
