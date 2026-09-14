import { ProjectError } from "../project/errors.js";

/** Normalize only errors from ZIP parser calls; keep internal bugs out of verdicts. */
export async function zipOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof ProjectError) throw error;
    throw new ProjectError("E_ARCHIVE_INVALID", "The archive is not a supported, well-formed ZIP package.");
  }
}
