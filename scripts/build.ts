import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// Builds the React client into dist/public (app.js + index.html + styles.css).
// Run with: bun run build

const root = join(import.meta.dir, "..");
const outdir = join(root, "dist", "public");

if (existsSync(join(root, "dist"))) rmSync(join(root, "dist"), { recursive: true });
mkdirSync(outdir, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(root, "src", "client", "main.tsx")],
  outdir,
  target: "browser",
  minify: true,
  sourcemap: "none",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

cpSync(join(root, "src", "client", "index.html"), join(outdir, "index.html"));
cpSync(join(root, "src", "client", "styles.css"), join(outdir, "styles.css"));

console.log(`Client built -> ${outdir}`);
