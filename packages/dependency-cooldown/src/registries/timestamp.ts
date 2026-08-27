export function parseTimestamp(raw: string, subject: string): Date {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Unreadable publish timestamp "${raw}" for ${subject}.`);
  }
  return parsed;
}
