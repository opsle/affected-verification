# Candidate evaluation

Evaluation occurred from public source and workflow metadata before any
comparative change-corpus execution.

## Required criteria

The target had to be public, permissively licensed, exactly pinnable,
lockfile/toolchain identified, credential- and paid-service-free for the local
catalog, locally bounded, explicitly enumerable, large enough for test-file
selection, inspectable for source-to-test relationships, and equipped with a
native affected-test mechanism.

## Selected: pmndrs/zustand

- URL: `https://github.com/pmndrs/zustand.git`
- revision: `b57db4f86ef179285da216eeb291266da82c361c`
- license: MIT
- toolchain: Node LTS workflow, pnpm `11.3.0`, `pnpm-lock.yaml`, Vitest `4.1.10`
- primary CI catalog: format, TypeScript, ESLint, Vitest specs, and build
- collection: 13 Vitest files and 224 test cases without executing tests
- native arm: Vitest `related` using the frozen changed paths

Zustand was selected because its primary CI workflow gives a clear, bounded
five-class verification catalog and its native selector operates on the same
test framework. This criterion does not encode or anticipate a favorable
reduction result.

## Rejected alternate: reduxjs/redux

Inspected revision `71606661ac515bdd64c199a6bb508401c7cf736f`. MIT source,
Yarn `4.4.1`, Vitest, and 12 runtime test files were suitable, but the
authoritative workflow also spans multiple Node and TypeScript-version
matrices plus package artifact checks. That makes a defensible first local
catalog boundary less compact than Zustand's.

## Rejected alternate: immerjs/immer

Inspected revision `061c2425e1c9dff89e4e4189d42af1b7839dfe0a`. MIT source,
Yarn lockfile, and Vitest were suitable, but the full test entrypoint couples
source tests, built-artifact tests, and Flow, while a separate workflow runs a
performance suite. The toolchain and catalog boundary are therefore less
direct for the first bounded calibration.
