export class ResultTooLargeError extends Error {
  public constructor(maxChars: number) {
    super(`The result takes more than ${String(maxChars)} characters, select fewer rows or columns`);
    this.name = "ResultTooLargeError";
  }
}
