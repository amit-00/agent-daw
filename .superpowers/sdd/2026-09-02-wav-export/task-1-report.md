# Task 1 report: PCM encoder and file naming

## Implementation

- Added `src/audio/exporter.ts` with native RIFF/WAVE PCM encoding for 44.1 kHz stereo `AudioBuffer` inputs.
- Encoded samples are clamped to `[-1, 1]`, scaled asymmetrically to signed 16-bit PCM, and interleaved left/right.
- Unsupported channel counts and sample rates raise an actionable `RangeError`.
- Added safe project-name sanitization with `agentdaw.wav` fallback.
- Re-exported both functions from `src/audio/index.ts`.

## TDD evidence

RED command:

```text
node --disable-warning=ExperimentalWarning --test test/audio-exporter.test.ts
```

Result: failed as expected before implementation with `SyntaxError: The requested module '../src/audio/index.ts' does not provide an export named 'encodeWav'`.

GREEN command:

```text
node --disable-warning=ExperimentalWarning --test test/audio-exporter.test.ts
```

Result: passed, 2 tests, 0 failures.

## Verification

```text
node --disable-warning=ExperimentalWarning --test test/*.test.ts
```

Passed: 134 tests, 0 failures.

```text
pnpm run typecheck
```

Passed: `tsc --noEmit && tsc --project tsconfig.project.json`.

```text
pnpm run lint
```

Could not run: `eslint: command not found` because dependencies are not installed in this worktree.

```text
git diff --check
```

Passed with no whitespace errors.

## Files changed

- `src/audio/exporter.ts`
- `src/audio/index.ts`
- `test/audio-exporter.test.ts`

## Self-review

The implementation follows the brief directly, uses only platform APIs, validates the export contract at the encoder boundary, and keeps the diff limited to the requested files. Tests cover RIFF metadata, stereo interleaving, clamping/scaling, unsafe-name replacement, and fallback naming.

## Concerns

Lint remains unverified solely because the worktree lacks installed dependencies; no dependency installation was performed per instruction.
