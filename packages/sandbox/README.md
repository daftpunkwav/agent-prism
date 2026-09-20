# sandbox/

Shell-command containment seam: layered static analysis denies catastrophic
shapes, the approval gate can restrict shell tools to known-safe commands, and
`sandbox_mode` selects OS-level write containment for spawned children. The
static layers are a guardrail, not a security boundary; the OS layer enforces
workspace-only writes on Windows. Full model and boundaries:
[docs/architecture/sandbox-layers.md](../../docs/architecture/sandbox-layers.md).

## Subpackages

| Package | Role | Wired at |
|---|---|---|
| [`sandbox/`](sandbox/README.md) | Policy and hook adapter: `LayeredSandboxPolicy` (default), `DenyListSandboxPolicy`, `AllowAllSandboxPolicy`, `toBeforeExecute`; quote-aware `command-analysis`; `ApprovalGate` + `normalizeApprovalMode`; `normalizeSandboxMode` | Assembled by default into the agent execution chain (review chain + config normalization) |

The OS write sandbox itself lives in `packages/environment` (spawn transform +
restricted-token helper); this package owns the review-time decisions.
