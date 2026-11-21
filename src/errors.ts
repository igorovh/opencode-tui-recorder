/** A check that did not hold, such as text that never showed: the behaviour is missing. Exits with 1. */
export class CheckFailed extends Error {}

// 0 the behaviour is there, 1 a check failed, 2 the recorder itself broke. tidy's review extras read these.
export const exitCode = (error: unknown) => (error === undefined ? 0 : error instanceof CheckFailed ? 1 : 2)
