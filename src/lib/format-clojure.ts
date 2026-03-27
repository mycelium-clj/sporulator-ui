import { parenMode } from "parinfer";

/**
 * Formats Clojure/EDN code using parinfer's paren mode.
 * Given code with correct parens, produces properly indented output.
 * Returns the original text if formatting fails.
 */
export function formatClojure(text: string): string {
  if (!text || text.trim() === "") return text;
  const result = parenMode(text.trim());
  return result.success ? result.text : text.trim();
}
