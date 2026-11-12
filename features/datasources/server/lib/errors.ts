export class ResultTooLargeError extends Error {
  public constructor(maxBytes: number) {
    super(`The result takes more than ${String(maxBytes)} bytes, select fewer rows or columns`);
    this.name = "ResultTooLargeError";
  }
}
