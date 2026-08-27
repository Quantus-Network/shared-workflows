import { UsageError } from "./errors.js";
import { annotate } from "./github.js";
import { EXIT_USAGE, run } from "./run.js";

// Deliberately not top-level await: the action ships a CommonJS bundle, because
// some bundled dependencies still use require() internally.
run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof UsageError) {
      annotate("error", error.message);
    } else {
      console.error(error);
      annotate(
        "error",
        `Dependency cooldown check could not complete: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    process.exitCode = EXIT_USAGE;
  },
);
