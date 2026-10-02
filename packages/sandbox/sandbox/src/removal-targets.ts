/**
 * @file removal-targets
 * @description Shared path normalization for catastrophic-removal checks.
 *
 * Responsibilities:
 * - Collapse absolute removal targets so `..` cannot dodge a protected root
 * - Strip the `\\?\` and `\\.\` prefixes before that comparison
 * - Hold the protected POSIX and Windows roots both sandbox policies compare against
 *
 * Both policies import this module. A second copy of the sets is how Windows
 * directory protection drifted off the PowerShell command that actually runs.
 */

/** POSIX roots whose recursive forced removal is never legitimate (case-sensitive). */
export const PROTECTED_POSIX_ROOTS = new Set([
  "/",
  "/*",
  "~",
  "/root",
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/boot",
  "/dev",
  "/proc",
  "/sys",
  "/var",
  "/home",
]);

/** Windows roots (compared case-insensitively: Windows paths are not). */
export const PROTECTED_WINDOWS_ROOTS = new Set(["c:\\", "c:\\windows", "c:\\windows\\system32"]);

/**
 * Normalizes a removal target for root comparison.
 *
 * Absolute paths collapse `.` and `..` so `/usr/../etc` compares as `/etc`.
 * `\\?\` and `\\.\` are stripped first, so `\\?\C:\Windows` compares as `c:\windows`.
 * Relative targets only lose trailing separators: collapsing them would invent
 * a cwd. A bare drive letter regains its separator so `C:` matches `c:\`.
 */
export function normalizeRemovalTarget(target: string): string {
  const bare = withoutWindowsDevicePrefix(target);
  // Linear trailing-separator trim: `[/\\]+$` backtracking degrades
  // quadratically on a long separator run that is not at the string end, and
  // targets come straight from shell command tokens.
  let end = bare.length;
  while (end > 0 && (bare[end - 1] === "/" || bare[end - 1] === "\\")) end -= 1;
  const stripped = bare.slice(0, end);
  if (stripped === "") return "/";
  if (/^[a-zA-Z]:$/.test(stripped)) return `${stripped.toLowerCase()}\\`;
  const drive = /^([a-zA-Z]):[\\/]/.exec(bare);
  const posixAbsolute = bare.startsWith("/");
  if (drive === null && !posixAbsolute) return stripped;
  const unified = bare.replace(/\\/g, "/");
  const body = drive !== null ? unified.slice(2) : unified;
  const stack: string[] = [];
  for (const segment of body.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  if (drive !== null) {
    const letter = drive[1]!.toLowerCase();
    return stack.length === 0 ? `${letter}:\\` : `${letter}:\\${stack.join("\\")}`.toLowerCase();
  }
  return stack.length === 0 ? "/" : `/${stack.join("/")}`;
}

/**
 * Removes the Win32 device prefix so the drive path underneath can match a
 * protected root. `\\?\UNC\...` becomes a normal UNC path, which is not a
 * drive root. Anything else is returned unchanged.
 */
function withoutWindowsDevicePrefix(target: string): string {
  const slashed = target.replace(/\//g, "\\");
  const lower = slashed.toLowerCase();
  if (lower.startsWith("\\\\?\\unc\\")) return `\\\\${slashed.slice(8)}`;
  if (lower.startsWith("\\\\?\\") || lower.startsWith("\\\\.\\")) return slashed.slice(4);
  return target;
}
