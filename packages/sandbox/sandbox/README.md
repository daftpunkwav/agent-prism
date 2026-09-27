# `@agentprism/sandbox`

Shell safety policy: `DenyListSandboxPolicy` denies recursive forced deletion of protected roots, formatting, raw-device writes, root wipes, and fork bombs; everyday commands (echo, git, npm, in-scope deletes, piped installs) all pass. `toBeforeExecute` wires the policy into the registry `beforeExecute` hook (it reviews the shell-carrying tools: `bash`, `run_job`, and `bash_session`).

## Dependencies

- Runtime: `contracts` only.
