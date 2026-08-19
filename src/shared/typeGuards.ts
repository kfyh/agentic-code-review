export function isError(err: unknown): err is Error {
  return err instanceof Error;
}

export function isErrorWithMessage(
  err: unknown
): err is { message: string; stderr?: string; code?: string | number } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as Record<string, unknown>).message === 'string'
  );
}
