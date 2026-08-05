/* Seed the Firestore `videos` collection from data/videos.json.
 *
 *   node scripts/seed-videos.mjs          # create/update every video
 *   node scripts/seed-videos.mjs --dry    # print what would be written
 *
 * Uses the same REST API + web API key as the app, so it needs the `videos`
 * collection to be writable while it runs. Recommended: keep the collection
 * public-read / no-write in production rules, and temporarily allow writes
 * (or run this from the Firebase console's rules playground disabled state)
 * only while seeding.
 *
 * Documents are keyed by the `id` field in videos.json, so re-running updates
 * existing entries in place rather than creating duplicates.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const cfgSrc = await readFile(join(root, "js/config.js"), "utf8");
const apiKey = (cfgSrc.match(/apiKey:\s*"([^"]+)"/) || [])[1];
const projectId = (cfgSrc.match(/projectId:\s*"([^"]+)"/) || [])[1];
if (!apiKey || !projectId) {
  console.error("Could not read firebase apiKey/projectId from js/config.js");
  process.exit(1);
}

const { videos } = JSON.parse(await readFile(join(root, "data/videos.json"), "utf8"));
const dry = process.argv.includes("--dry");
const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

const enc = (v) =>
  typeof v === "number"
    ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
    : { stringValue: String(v) };

let ok = 0;
let failed = 0;

for (const v of videos) {
  const fields = {
    title: enc(v.title),
    youtubeId: enc(v.youtubeId),
    category: enc(v.category),
    order: enc(v.order),
  };
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join("&");
  const url = `${base}/videos/${encodeURIComponent(v.id)}?key=${apiKey}&${mask}`;

  if (dry) {
    console.log(`would write videos/${v.id}  [${v.order}] ${v.category} — ${v.title}`);
    continue;
  }

  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (res.ok) {
    ok++;
    console.log(`ok   videos/${v.id}`);
  } else {
    failed++;
    console.error(`FAIL videos/${v.id} — ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

if (!dry) {
  console.log(`\n${ok} written, ${failed} failed, ${videos.length} total`);
  if (failed) process.exit(1);
}
