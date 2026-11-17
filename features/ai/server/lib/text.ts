// The value with its strings cleaned of the characters that the database rejects
export const sanitize = <T>(value: T): T => {
  if (typeof value === "string") {
    return value.toWellFormed().replaceAll("\0", "\uFFFD") as T;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => sanitize(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)])) as T;
  }
  return value;
};
