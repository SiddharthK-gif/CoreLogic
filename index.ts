import * as fs from "fs";
import * as path from "path";
import { fillSchemaFromContext, JsonSchema } from "./ai";
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
  node dist/index.js <template.docx> <schema.json> [output.docx]

Arguments:
  template.docx   Path to the Word document with {{placeholders}}
  schema.json     Path to your JSON schema file with empty values
  output.docx     (optional) Where to write the filled document
                  Defaults to <template>-output.docx in the same folder

Environment:
  NVIDIA_API_KEY   Your NVIDIA API key (required)
                   Get one at https://build.nvidia.com
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 2 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(args.length < 2 ? 1 : 0);
  }

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    console.error("❌ Missing NVIDIA_API_KEY environment variable.");
    console.error('   Set it with: $env:NVIDIA_API_KEY="your-key-here"');
    process.exit(1);
  }

  const [templatePath, schemaPath, outputPath] = args;

  if (!fs.existsSync(path.resolve(templatePath))) {
    console.error(`❌ Template file not found: ${templatePath}`);
    process.exit(1);
  }

  if (!fs.existsSync(path.resolve(schemaPath))) {
    console.error(`❌ Schema file not found: ${schemaPath}`);
    process.exit(1);
  }

  try {
    // Step 1 — read the JSON schema file
    const schema = JSON.parse(fs.readFileSync(path.resolve(schemaPath), "utf-8")) as JsonSchema;

    // Step 2 — pass the schema to ai.ts, get back the filled schema
    const filledSchema = await fillSchemaFromContext(schema, apiKey);
    const data         = flattenObject(filledSchema as JsonObject);

    // Step 3 — read the docx file into a blob
    const blob = fs.readFileSync(path.resolve(templatePath));

    // Step 4 — replace template variables with the filled schema values
    const outBuffer = replaceTemplateVariables(blob, data);

    // Step 5 — write the buffer to disk
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
