export function readProcessVar(name: string): string {
  return process.env[name]?.trim() || "";
}
