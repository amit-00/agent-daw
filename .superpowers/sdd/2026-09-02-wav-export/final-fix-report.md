# WAV export final-fix report

## Scope

- Preserved the missing pattern ID when every arrangement clip references a missing pattern.
- Extended existing exporter coverage for PCM header fields/input validation, mixer routing, and the duration boundary.
- No dependencies or new abstractions added.

## RED / GREEN evidence

RED command:

```sh
node --disable-warning=ExperimentalWarning --test test/audio-exporter.test.ts
```

RED output (before the production change):

```text
✖ renderProjectToWav names a missing pattern when no arrangement steps can expand
AssertionError [ERR_ASSERTION]: The validation function is expected to return "true". Received false
Caught error:
WavExportError: Cannot export because the arrangement references a missing pattern
ℹ tests 12
ℹ pass 11
ℹ fail 1
```

GREEN command:

```sh
node --disable-warning=ExperimentalWarning --test test/audio-exporter.test.ts
```

GREEN output (after the production change and final test additions):

```text
✔ encodeWav writes a stereo 16-bit RIFF file with clamped samples
✔ encodeWav rejects buffers outside the fixed stereo 44.1 kHz format
✔ wavFileName keeps a readable safe name and has a fallback
✔ renderProjectToWav schedules the full shared mixer graph with a release tail
✔ renderProjectToWav names a missing pattern when no arrangement steps can expand
✔ renderProjectToWav permits ten minutes but rejects longer projects before allocation
✔ renderProjectToWav rejects invalid projects before downloading partial audio
✔ renderProjectToWav distinguishes sample loading and rendering failures
✔ renderProjectToWav reports a decoded sample that is unavailable
ℹ tests 14
ℹ pass 14
ℹ fail 0
```

## Verification

```sh
node --disable-warning=ExperimentalWarning --test test/audio-*.test.ts
```

```text
ℹ tests 64
ℹ pass 64
ℹ fail 0
```

```sh
pnpm run typecheck
```

```text
> agent-daw@0.1.0 typecheck /Users/amit/Documents/repos/agent-daw/.worktrees/wav-export
> tsc --noEmit && tsc --project tsconfig.project.json
```

```sh
git diff --check
```

```text
(no output; exit 0)
```

Attempted lint command:

```sh
pnpm run lint
```

```text
> eslint .
sh: eslint: command not found
ELIFECYCLE Command failed.
```

Lint was not run because this worktree lacks the installed `eslint` binary. No dependency installation was performed.

## Files changed

- `src/audio/exporter.ts`
- `test/audio-exporter.test.ts`
- `.superpowers/sdd/2026-09-02-wav-export/final-fix-report.md`

## Self-review

- The only production change makes the existing timeline expansion use a one-step valid window when the calculated end is zero; this lets its existing missing-reference diagnostic retain the pattern ID while preserving the zero-end rejection.
- Mixer tests assert master gain, non-zero stereo pan, solo muting of non-solo tracks, and mute overriding solo; the graph under test is the real exporter graph using existing fakes.
- The 600-second test throws from `createContext` before any buffer/context allocation, and the 606-second case verifies the duration error occurs before `createContext`.
- Encoder tests now assert PCM format code, byte rate, block alignment, and format validation. `git diff --check` is clean.
