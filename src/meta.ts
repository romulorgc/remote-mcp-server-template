import { readFileSync } from "node:fs";

interface PackageJson {
  name: string;
  version: string;
}

// package.json sits one level above both src/ and dist/, so this path works for
// `tsx src/index.ts` and for `node dist/index.js` alike.
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as PackageJson;

export const SERVER_NAME = pkg.name;
export const SERVER_VERSION = pkg.version;
