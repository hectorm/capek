const FORMULA_PATTERN = /^[=+\-@\t\r]/;
const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const TIME_PATTERN = /^(\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2})/;

const collator = new Intl.Collator(undefined, { numeric: true });

export const cellText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
};

type CellKind = "number" | "time" | "text";
type CellComparer = (a: unknown, b: unknown) => number;

const cellKinds: CellKind[] = ["number", "time", "text"];

const cellKind = (value: unknown): CellKind => {
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value !== "string") {
    return "text";
  }
  return NUMBER_PATTERN.test(value) ? "number" : TIME_PATTERN.test(value) ? "time" : "text";
};

const compareTexts: CellComparer = (a, b) => collator.compare(cellText(a), cellText(b));

const compareNumbers: CellComparer = (a, b) => Number(a) - Number(b) || compareTexts(a, b);

const compareTimes: CellComparer = (a, b) => {
  const time = cellText(a);
  const otherTime = cellText(b);
  if (time === otherTime) {
    return 0;
  }
  return time < otherTime ? -1 : 1;
};

const cellComparers: Record<CellKind, CellComparer> = {
  number: compareNumbers,
  time: compareTimes,
  text: compareTexts,
};

export const compareCells: CellComparer = (a, b) => {
  const kind = cellKind(a);
  const otherKind = cellKind(b);
  return kind === otherKind ? cellComparers[kind](a, b) : cellKinds.indexOf(kind) - cellKinds.indexOf(otherKind);
};

const toField = (value: unknown): string => {
  let text = cellText(value);
  if (FORMULA_PATTERN.test(text) && !NUMBER_PATTERN.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const toCsv = (columns: readonly string[], rows: readonly (readonly unknown[])[]): string => {
  const lines = [columns, ...rows].map((row) => row.map(toField).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
};
