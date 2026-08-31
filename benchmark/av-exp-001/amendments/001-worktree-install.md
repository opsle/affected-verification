# AV-EXP-001 benchmark amendment 001

Status: harness-only amendment before comparative scenario execution

The first baseline attempt after preregistration commit
`0544362d7659093b7f0b4f89ee8f68023fd269c3` stopped before any scenario.
All three clean repetitions were incomplete because the runner symlinked the
prepared clone's `node_modules` into Git worktrees. pnpm correctly detected that
the modules directory belonged to a different workspace and attempted a
modules-dir repair. In the non-interactive session it refused that repair with
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`.

This is a harness materialization defect. It does not change the target,
catalog, native selector, scenarios, patches, oracle, arms, metrics, analysis
rules, or stop conditions frozen in preregistration v1. No native selection,
AV plan, scenario full run, oracle, or comparative result was produced.

Amendment:

1. each disposable worktree performs
   `corepack pnpm install --frozen-lockfile --offline` against the already
   populated content-addressed pnpm store;
2. `CI=true` is set for non-interactive command execution;
3. no `node_modules` symlink is created;
4. the failed baseline artifacts are retained under
   `attempts/harness-defect-001/`;
5. baseline stability is rerun from three new clean worktrees before any
   scenario.

Result bundles bind this amendment's content identity in addition to the
original preregistration commit.

Amendment identity:
`sha256:80a04b99ad73e86ecb2e7c85dda3a11ddbe99cdf200ca38e2c1effe498184357`
