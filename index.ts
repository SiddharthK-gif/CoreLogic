import * as fs from "fs";
import * as path from "path";
import { replaceTemplateVariables } from "./replacer";

// ─── Types ────────────────────────────────────────────────────────────────────

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
interface JsonObject { [key: string]: JsonValue }
type JsonArray = JsonValue[];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flattenObject(obj: JsonObject, prefix = "", result: JsonObject = {}): JsonObject {
  for (const [key, value] of Object.entries(obj)) {
    const flatKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[flatKey] = value;
      flattenObject(value as JsonObject, flatKey, result);
    } else {
      result[flatKey] = value;
    }
    if (!prefix) result[key] = value;
  }
  return result;
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
Usage:
  ts-node src/index.ts <template.docx> <data.json> [output.docx]

Arguments:
  template.docx   Path to the Word document with {{placeholders}}
  data.json       Path to the JSON file with replacement values
  output.docx     (optional) Where to write the filled document
                  Defaults to <template>-output.docx in the same folder
`);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 2 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(args.length < 2 ? 1 : 0);
  }

  const [templatePath, dataPath, outputPath] = args;

  try {
    // Step 1 — read the docx file into a blob
    const blob = fs.readFileSync(path.resolve(templatePath));

    // Step 2 — read, parse, and flatten the JSON data
    const rawData = JSON.parse(fs.readFileSync(path.resolve(dataPath), "utf-8")) as JsonObject;
    const data    = flattenObject(rawData);

    // Step 3 — replace template variables, get back the output buffer directly
    const outBuffer = replaceTemplateVariables(blob, data);

    // Step 4 — write the buffer to disk
    const absTemplate = path.resolve(templatePath);
    const resolvedOutput =
      outputPath ??
      path.join(
        path.dirname(absTemplate),
        path.basename(absTemplate, ".docx") + "-output.docx"
      );
    fs.writeFileSync(resolvedOutput, outBuffer);

    console.log(`✅ Done! Output written to:\n   ${path.resolve(resolvedOutput)}`);
  } catch (err) {
    console.error(`❌ Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
