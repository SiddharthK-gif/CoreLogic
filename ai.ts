import * as readline from "readline";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

// ─── Types ────────────────────────────────────────────────────────────────────

export type JsonSchema = { [key: string]: string | JsonSchema | JsonSchema[] };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function askQuestion(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * Takes a JSON schema with empty values, asks the user for context,
 * uses NVIDIA AI via LangChain to fill the schema with values from
 * the context, and returns the filled schema.
 */
export async function fillSchemaFromContext(
  schema: JsonSchema,
  apiKey: string
): Promise<JsonSchema> {
  // Step 1 — ask the user for context
  const context = await askQuestion("Enter a description: ");
  if (!context) throw new Error("Description cannot be empty.");

  console.log("\n🤖 Filling schema from your description...");

  // Step 2 — set up the LangChain NVIDIA model
  const model = new ChatOpenAI({
    model:       "meta/llama-3.1-8b-instruct",
    apiKey,
    configuration: {
      baseURL: "https://integrate.api.nvidia.com/v1",
    },
  });

  // Step 3 — define the prompt template
  const prompt = ChatPromptTemplate.fromTemplate(`
You are a data extractor. The user has described a document in plain English.
You are given a JSON schema with empty values. Fill in each field using the values
from the user's description.

JSON schema to fill:
{schema}

User description: {context}

Rules:
- Return ONLY the filled JSON object, no markdown, no explanation, no code fences
- Keep the exact same structure and key names as the schema
- For nested objects, fill each nested field individually
- For array fields, create 2-3 objects with realistic values
- For boolean fields, use true or false
- If a value is not mentioned in the description, make a sensible default based on context
  `);

  // Step 4 — build the chain: prompt → model → string output
  const chain = prompt.pipe(model).pipe(new StringOutputParser());

  // Step 5 — run the chain with the schema and context
  const result = await chain.invoke({
    schema:  JSON.stringify(schema, null, 2),
    context,
  });

  // Step 6 — strip any markdown code fences and parse the JSON
  const clean = result
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(clean) as JsonSchema;
  } catch {
    throw new Error(`AI returned invalid JSON:\n${result}`);
  }
}
