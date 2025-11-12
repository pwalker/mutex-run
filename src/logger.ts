import * as colors from "yoctocolors";

// Logger helper to simplify verbose output
export function createLogger(verbose: boolean, useColor: boolean) {
  // Create identity function for no-color mode
  const identity = (str: any) => String(str);

  // Use colors or identity functions based on useColor flag
  const c = useColor
    ? colors
    : {
        dim: identity,
        cyan: identity,
        green: identity,
        red: identity,
        yellow: identity,
      };

  return {
    verbose: (...args: any[]) => {
      if (verbose) {
        console.error(c.dim("[mutex-run]"), ...args);
      }
    },
    info: (...args: any[]) => {
      console.error(c.cyan("[mutex-run]"), ...args);
    },
    success: (...args: any[]) => {
      console.error(c.green("[mutex-run]"), ...args);
    },
    error: (...args: any[]) => {
      console.error(c.red("[mutex-run]"), ...args);
    },
    colors: c,
  };
}
