import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

export function replaceTemplateVariables(
  blob: Buffer,
  data: Record<string, unknown>
): Buffer {
  const zip = new PizZip(blob);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks:    true,
    delimiters:    { start: "{{", end: "}}" },
  });

  try {
    doc.render(data);
  } catch (err: unknown) {
    const e = err as { properties?: { errors?: Array<{ message?: string }> } };
    if (e?.properties?.errors?.length) {
      const details = e.properties.errors.map((x) => x.message).join("\n  ");
      throw new Error(`Template rendering failed:\n  ${details}`);
    }
    throw err;
  }

  return doc.getZip().generate({ type: "nodebuffer" });
}
