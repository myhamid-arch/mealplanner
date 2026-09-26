// Assertion collector: every check is printed; the PASSED marker is printed only if none failed.

export class Report {
  /** @param {string} label e.g. "leaf-1.1.1 G1" */
  constructor(label) {
    this.label = label;
    /** @type {string[]} */
    this.failures = [];
  }

  /**
   * @param {boolean} condition
   * @param {string} description
   * @param {string} [detail] printed only on failure
   */
  check(condition, description, detail = "") {
    if (condition) {
      console.log(`ok   - ${description}`);
    } else {
      this.failures.push(description);
      console.log(`FAIL - ${description}${detail ? `\n${indent(detail)}` : ""}`);
    }
    return condition;
  }

  /** Prints the verdict and returns the process exit code. */
  finish() {
    if (this.failures.length === 0) {
      console.log(`VERIFY ${this.label} PASSED`);
      return 0;
    }
    console.log(
      `VERIFY ${this.label} FAILED (${String(this.failures.length)} failed assertion(s))`,
    );
    return 1;
  }
}

/** @param {string} text */
function indent(text) {
  return text
    .split("\n")
    .map((line) => `       ${line}`)
    .join("\n");
}
