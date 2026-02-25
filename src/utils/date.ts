/**
 * Formats a Date object or timestamp to a consistent local string format.
 * Format: "YYYY/MM/DD HH:MM:SS" (based on system locale)
 */
export function formatDate(date: Date | number = new Date()): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  return d.toLocaleString();
}

/**
 * Returns the current local time string.
 */
export function getCurrentTime(): string {
  return formatDate(new Date());
}
