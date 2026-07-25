// Formats an ISO date string for display, returning "--" for empty or invalid input.
export function formatDate(iso: string): string {
  if (!iso) {
    return "--";
  }
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? "--" : value.toLocaleDateString();
}
