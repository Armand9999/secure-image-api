type LogContext = Record<string, unknown>;

export function logInfo(
  message: string,
  context: LogContext = {}
): void {
  console.info(message, context);
}

export function logWarn(
  message: string,
  context: LogContext = {}
): void {
  console.warn(message, context);
}

export function logError(
  message: string,
  error: unknown,
  context: LogContext = {}
): void {
  if (error instanceof Error) {
    console.error(message, {
      ...context,
      errorType: error.name,
      errorMessage: error.message
    });

    return;
  }

  console.error(message, {
    ...context,
    error
  });
}