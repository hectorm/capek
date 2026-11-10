export class AbortError extends Error {
  public constructor(message = "The operation was aborted") {
    super(message);
    this.name = "AbortError";
  }
}

export class TimeoutError extends Error {
  public constructor(message = "The operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export class MaxIterationsError extends Error {
  public constructor(message = "The operation reached maximum iterations") {
    super(message);
    this.name = "MaxIterationsError";
  }
}

export class ConcurrentExecutionError extends Error {
  public constructor(message = "An execution is already in progress for this session") {
    super(message);
    this.name = "ConcurrentExecutionError";
  }
}
