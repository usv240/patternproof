import { readFile } from "node:fs/promises";
import { buildPilotReport, parsePilotRecords } from "../lib/pilot-metrics";

const sourcePath = process.argv[2];
if (!sourcePath) throw new TypeError("Usage: npm run pilot:report -- <de-identified-pilot.json>");
const source = JSON.parse(await readFile(sourcePath, "utf8")) as unknown;
process.stdout.write(JSON.stringify(buildPilotReport(parsePilotRecords(source)), null, 2) + "\n");
