// Shared search utility. This helper is not a separate OOP pillar.
export function normalizeSearch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}
