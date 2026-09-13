# Affected Verification capability for Opsle Tasks

`@opsle/affected-verification-tasks-capability` **0.2.0** is an independently
versioned, dependency-free capability owned and released by the public Affected
Verification repository. AV remains the verification planning authority. Tasks
owns operator grants, command execution, observed results, repair, and release.
The package neither runs catalog commands nor authorizes deployment. AV remains
`OBSERVE_SHADOW`: its proposal is not execution authority, and full verification
must remain authoritative.

The executable ESM entry point implements the generic
`opsle.capability-manifest.v1` / `opsle.capability-result.v1` contract. Both
`verification.plan`, `verification.shadow`, and `verification.capture` are
**required deterministic authorities**. The shadow hook validates the complete
authoritative result, uses AV's native classifier, and returns a bound receipt.
`default_enabled` is **false**. No AV identity branches, new central
Tasks dependencies, private Tasks imports, sibling checkouts, Graphify dependency,
or structural-evidence contract are needed.

## Build and install

Build from an AV checkout with Node 20+ and npm:

```sh
npm run pack:tasks-capability
sha256sum opsle-affected-verification-tasks-capability-0.2.0.tgz
```

`npm pack` builds the adapter, includes the current AV core, runtime helpers,
JSON schemas, and licenses. Only the build reads AV source outside this package.
The installed artifact contains everything it needs. No install scripts or
network dependencies are required. Review the artifact hash and provenance
before an operator installs it outside repositories and agent-writable paths:

```sh
npm install --prefix /srv/opsle-capabilities/av-0.2.0 \
  --ignore-scripts --no-audit --no-fund \
  ./opsle-affected-verification-tasks-capability-0.2.0.tgz
```

Set the operator-owned `OPSLE_CAPABILITY_PATH` to the installed directory:
`/srv/opsle-capabilities/av-0.2.0/node_modules/@opsle/affected-verification-tasks-capability`.
Tasks also accepts the generic `capabilityRoots` configuration. Multiple roots
use the platform path delimiter. Include the individually installed roots for
other required authorities and observers. **Replace** the bundled AV discovery
root; do not also discover Tasks' entire bundled `capabilities/` directory, which
would discover the same AV identity twice and correctly fail.

This is operator configuration, not a central runtime code change. Discovery
checks the manifest and executable path; it does not activate this package.
Grant the project capability using Task 15's operator project-grant mechanism:

```json
{"schema":"opsle.capability-grants.v1","allow":["opsle.affected-verification"]}
```

Persist this in the project's `capability_grants` / `capability_grants_json`
through the existing operator interface. Repository `.opsle/capabilities.json`
cannot enable or disable an authority, change its executable, or grant it trust.
An absent required authority blocks verification, including after a revoke.

## Compatibility and schemas

The real generic runtime compatibility target is Opsle Tasks revision
`b76d6253b405469b79d30b260f7ad09827052a4a` (Node 24+ for its complete regression
suite). Its `src/capabilities.js` SHA-256 is
`62dca002d729c82ca00a66fdb6edcbac692eca770ca6f771dea0c7e68ffd3408`.
Tests import that unmodified runtime only as a compatibility test dependency;
the installed capability never imports Tasks source. Execution metadata comes
from generic `services.executionConfig`; project/task/attempt/execution bindings
come from the generic invocation services. All executable configuration remains
operator-owned.

| Hook | Request | Response |
| --- | --- | --- |
| `verification.plan` | `opsle.execution.verification-request.v1` | `opsle.execution.verification-analysis.v1` |
| `verification.shadow` | `opsle.execution.verification-shadow-request.v1` | `opsle.execution.verification-shadow-result.v1` |
| `verification.capture` | `opsle.execution.change-capture-request.v1` | `opsle.execution.change-set.v1` |

All JSON Schemas are in `schemas/`. They include the immutable task manifest,
task request, task plan, plan v2, and retained evidence v1. Their existing schema
identities are preserved. `opsle.affected-verification.tasks-config.v2` explicitly
removes v1's configurable `repository` executable path: the resolved configuration
is empty. The generic repository configuration envelope may include only its
v2 schema identifier. Unsupported schemas, hooks, and extra request fields fail.
Structural validation supplements AV's native cross-field semantic validation;
it cannot establish completeness or provenance by itself.

The compatibility analysis envelope retains `change`, `decision`, `error`,
`evidencePath`, `inputPath`, `receiptPath`, and `record`. Planning does not create
a value receipt: one exists only after exact full-catalog results are validated
and shadow-classified. The shadow response returns it through the ordinary
`receipts` array and retains the matching private sidecar. An `ok` capability envelope
means analysis completed, **not that verification passed**. A failed analysis has
`decision: null`, an explicit error, and `ANALYSIS_FAILED` evidence. The Tasks
consumer must use full configured verification or stop. Missing manifests use
only the operator's configured full command. Empty catalogs return an explicit
analysis error, so the compatible Tasks runtime cannot enter its legacy
`NO_AUTOMATED_VERIFICATION` completion path: it must run the full configured
command or stop. Capture/transport failures throw and block the required
hook. Unsupported/unsafe requests throw before staging or writing evidence.

Planning stages the retained worktree and binds binary diff, exact base commit,
and staged Git tree identities. The manifest is read from the immutable base,
not agent-modified content. Every action must match the exact immutable catalog
partition and command. The adapter validates canonical decision identity and
recomputes the AV decision to check provenance/completeness. Unknown, incomplete,
or opaque evidence cannot justify an unexplained skip. Tasks must execute the
full catalog, pass its exact results to the shadow hook, and compare the
post-verification capture tree with the planned tree before accepting changes.
Unknown trust state, stale execution identity, source drift, incomplete results,
and invalid receipts fail closed; the package never decides that command
execution passed.

SSH target validation, argv quoting, strict host-key checking, connection and
remote process deadlines, bounded Git output, and private evidence are retained
from the compatibility adapter. Local project execution exists only under
`NODE_ENV=test`; production requires the configured SSH target. Runtime and schema
hashes are embedded in the entry point and checked before loading and before each
invocation, extending the generic runtime's manifest/entry-point byte checks to
all packaged files that affect planning. Operator-protected installation roots
remain the trust boundary; hashes do not make writable installations trustworthy.

OBSERVE/SHADOW observations and historical benchmarks retain their existing
limits. Proposed skips are proposals, not savings or avoided executions. No
observation is promoted to execution authority or production trust.
External structural evidence is not accepted by this interface and cannot narrow
verification; only AV's own provenance and completeness decision can justify
selection. The core remains separately usable without Tasks.

## Revoke, remove, reinstall, and upgrade

Remove this identity from the operator project grant to disable it for subsequent
execution runtimes. Quiesce/drain active executions and restart Tasks when changing
grants or installations: a runtime holds an execution-scoped grant snapshot.
Repository selection cannot revoke authority. Keep retained logs and capability
events outside the installation; never delete historical evidence on uninstall.

After revocation and draining, remove this package's discovery root and uninstall
its npm package. Missing required authority blocks new verification. To reinstall,
install a reviewed artifact in a fresh version directory, restore its discovery
root, restart, and explicitly regrant the project. Installation alone does not
restore a revoked grant.

For a compatible upgrade, build/review the new independently versioned artifact,
install into a new version directory, drain executions, atomically replace the
operator discovery-root configuration, and restart. Never discover both versions
with the same identity. Never mutate an active installation in place. Grants for
the same identity persist until explicitly revoked. Review compatibility before
retaining them. Rollback uses the previous reviewed artifact and the same restart
procedure. An incompatible contract requires a new explicit schema version.

## Verification and release

Public AV CI runs `npm run verify`, including standalone package/schema conformance
and negative tests, and the existing pinned gitleaks secret-scan job. Core sources
and historical benchmark artifacts are not rewritten by packaging.

The operator release pipeline must provision the trusted Tasks checkout at the
recorded revision, then run:

```sh
npm run verify
OPSLE_TASKS_RUNTIME_ROOT=/path/to/pinned/opsle-tasks npm run verify:tasks-capability
npm run pack:tasks-capability
sha256sum opsle-affected-verification-tasks-capability-0.2.0.tgz
```

The second command is mandatory for release: it refuses to skip if Tasks is
unavailable or at an unreviewed revision. It exercises isolated npm installation,
discovery without activation, grant, both hooks, repository authority protection,
revoke/disable, duplicate identities, byte mutation, removal with retained history,
reinstall/regrant, and compatible patch replacement/restart. It also runs Tasks'
existing capability, adapter, history, and AV regressions. The standalone suite
reports an explicit skip for the external lifecycle check when no Tasks checkout
is provisioned; that is not release evidence.

Keep pipeline output recording package version, artifact SHA-256/npm integrity,
Tasks revision/runtime hash, unchanged central source, conformance results, and
secret-scan results with the release. Increment this package's `package.json` and
`opsle-capability.json` together; AV core and capability versions have independent
release schedules. Update the pinned compatibility revision only after contract
review and passing tests. Publish only the reviewed npm tarball after these gates;
this task does not publish or deploy it.
