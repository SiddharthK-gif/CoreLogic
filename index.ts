import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import PizZip from "pizzip";
import OpenAI from "openai";
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

function extractPlaceholders(templatePath: string): string[] {
  const blob    = fs.readFileSync(path.resolve(templatePath));
  const zip     = new PizZip(blob);
  const xml     = zip.files["word/document.xml"].asText();
  const text    = xml.replace(/<[^>]+>/g, "");
  const matches = text.match(/\{\{[^}]+\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/^\{\{|\}\}$/g, "")))]
    .filter((n) => !n.startsWith("#") && !n.startsWith("/") && !n.startsWith("^"));
}

function askQuestion(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function generateDataFromDescription(
  description: string,
  placeholders: string[],
  apiKey: string
): Promise<JsonObject> {
  const client = new OpenAI({
    apiKey,
    baseURL: "https://integrate.api.nvidia.com/v1",
  });

  const prompt = `
You are a data extractor. The user has described a document in plain English.
Extract the relevant values from their description and map them to EXACTLY these key names:

${placeholders.map((p) => `- ${p}`).join("\n")}

User description: ${description}

Rules:
- Return ONLY a valid JSON object, no markdown, no explanation, no code fences
- You MUST use the exact key names listed above, do not rename or invent keys
- For dot-notation keys like "address.city", create a nested object: { "address": { "city": "..." } }
- For array keys like "benefits" or "items", create an array of objects with realistic values
- For boolean keys like "isRemote", use true or false
- If a value is not mentioned in the description, make a sensible default based on context
`.trim();

  const response = await client.chat.completions.create({
    model:    "meta/llama-3.1-8b-instruct",
    messages: [{ role: "user", content: prompt }],
  });

  const text  = response.choices[0]?.message?.content?.trim() ?? "";
  const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

  try {
    return JSON.parse(clean) as JsonObject;
  } catch {
    throw new Error(`AI returned invalid JSON:\n${text}`);
  }
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
Usage:
  node dist/index.js <template.docx> [output.docx]

Arguments:
  template.docx   Path to the Word document with {{placeholders}}
  output.docx     (optional) Where to write the filled document
                  Defaults to <template>-output.docx in the same folder

Environment:
  NVIDIA_API_KEY   Your NVIDIA API key (required)
                   Get one at https://build.nvidia.com
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 1 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(args.length < 1 ? 1 : 0);
  }

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    console.error("❌ Missing NVIDIA_API_KEY environment variable.");
    console.error('   Set it with: $env:NVIDIA_API_KEY="your-key-here"');
    process.exit(1);
  }

  const [templatePath, outputPath] = args;

  if (!fs.existsSync(path.resolve(templatePath))) {
    console.error(`❌ Template file not found: ${templatePath}`);
    process.exit(1);
  }

  try {
    // Step 1 — silently scan the template for placeholder key names
    const placeholders = extractPlaceholders(templatePath);

    // Step 2 — ask the user for a description
    const description = await askQuestion("Enter a description: ");
    if (!description) {
      console.error("❌ Description cannot be empty.");
      process.exit(1);
    }

    // Step 3 — send description + placeholder names to NVIDIA AI
    console.log("\n🤖 Generating data from your description...");
    const rawData = await generateDataFromDescription(description, placeholders, apiKey);
    const data    = flattenObject(rawData);

    // Step 4 — read the docx file into a blob
    const blob = fs.readFileSync(path.resolve(templatePath));

    // Step 5 — replace template variables, get back the output buffer
    const outBuffer = replaceTemplateVariables(blob, data);

    // Step 6 — write the buffer to disk
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
