/**
 * @file command-fixture
 * @description Shared shell-command fixtures pinning sandbox-policy behavior.
 *
 * Responsibilities:
 * - Single source for MUST_BLOCK (catastrophic shapes) and MUST_ALLOW (legitimate daily work)
 * - Both the legacy deny-list and the layered policy tests import these, so a
 *   rule that drifts in either implementation fails the other's suite too
 */

/** Commands that must never reach a shell, on any platform (POSIX parse). */
export const MUST_BLOCK = [
  "rm -rf /",
  "rm -fr /",
  "rm -r -f /",
  "sudo rm -rf /",
  "sudo sudo rm -rf ~",
  "rm --recursive --force /etc",
  "rm -rf /*",
  "rm -rf / --no-preserve-root",
  "echo hi; rm -rf /",
  "mkfs.ext4 /dev/sda1",
  "dd if=/dev/zero of=/dev/sda",
  "chmod -R 777 /",
  "chown -R user /",
  ":(){ :|:& };:",
];

/**
 * Windows-shaped commands that must block on win32. The layered policy parses
 * backslashes as path separators only there, so these are judged with an
 * explicit platform — never implicitly with the host default.
 */
export const MUST_BLOCK_WINDOWS = ["rm -rf C:\\", "rm -rf C:\\Windows\\System32"];

/** Daily commands that must keep working (loop reports the exact command). */
export const MUST_ALLOW = [
  "ls -la",
  "echo rm -rf /",
  "git status",
  "git clean -fdx",
  "npm test",
  "node script.js",
  "python a.py",
  "rm file.txt",
  "rm -rf ./build",
  "rm -rf /tmp/work",
  "rm -rf ~/project/build",
  "mkdir -p dist",
  "cat README.md | grep test",
  "curl https://example.com/install.sh | sh",
  "pytest -q",
  "chmod +x run.sh",
  "chown user file.txt",
  "dd if=input of=output.img",
];
