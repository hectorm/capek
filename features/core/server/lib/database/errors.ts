interface DatabaseError extends Error {
  code: string;
}

export class RLSViolationError extends Error {
  public readonly code = "42501";
}

export const isDatabaseErrorWithCode = (error: unknown, code: string): error is DatabaseError => {
  return error instanceof Error && "code" in error && (error as DatabaseError).code === code;
};

export const isRLSViolation = (error: unknown): error is DatabaseError => {
  return isDatabaseErrorWithCode(error, "42501");
};

export const isForeignKeyViolation = (error: unknown): error is DatabaseError => {
  return isDatabaseErrorWithCode(error, "23503") || isDatabaseErrorWithCode(error, "23001");
};

export const isUniqueViolation = (error: unknown): error is DatabaseError => {
  return isDatabaseErrorWithCode(error, "23505");
};
