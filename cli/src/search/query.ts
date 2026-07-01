import { closeSharedDbs, openSharedDbRead } from "../db/shared.js";

export function openSharedDb(): ReturnType<typeof openSharedDbRead> {
  return openSharedDbRead();
}

export function closeSearchDb(): void {
  closeSharedDbs();
}

/** Port of src-tauri/src/db/search.rs `fts_query_terms`. */
export function ftsQueryTerms(raw: string): string {
  return raw
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .map((w) => {
      const cleaned = [...w]
        .filter((c) => /[a-zA-Z0-9_]/.test(c))
        .join("");
      return cleaned.length > 0 ? `"${cleaned}"` : "";
    })
    .filter((s) => s.length > 0)
    .join(" OR ");
}
