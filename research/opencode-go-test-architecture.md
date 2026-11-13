# opencode Go Test Architecture — Survey (Facts Only)

Survey date: 2026-11-14. Survey method: read-only inspection (find/grep/wc/Read) of source tarballs; no build, no dependency install, no test execution.

**Primary snapshot:** tag `v1.0.0` of `sst/opencode` (local copy: `~/Downloads/opencode-survey/v1.0.0/`). This is the last tag containing Go code.
**Secondary snapshot:** default branch `dev` (local copy: `~/Downloads/opencode-survey/`), used to verify the current state and the TS-side test setup.

## Critical finding: the Go TUI is historical, not current

- The repo moved FROM Go TO TypeScript, not the other way. The premise "opencode recently migrated TUI core to Go" is factually inverted.
- Current `dev` branch (12,551 tracked paths checked via GitHub tree API): **zero** `.go` files, zero `go.mod` files.
- Tags containing Go TUI code (`packages/tui` with Bubble Tea): v0.1.0 (62 .go files), v0.2.0 (92), v0.3.0 (126), v0.4.0 (98), v1.0.0 (156). Tags v1.1.0 onward: 0 .go files. The Go TUI was removed in the v1.1.0+ rewrite (TypeScript/SolidJS "opentui").
- GitHub repo note: `sst/opencode` 301-redirects to `anomalyco/opencode`; default branch is `dev`.

## Repo layout at v1.0.0 (Go modules)

| Module | Path | Content |
|---|---|---|
| `github.com/sst/opencode` | `packages/tui/` | Bubble Tea v2 TUI app (`go.mod`, Bubble Tea/Lipgloss v2 betas, glamour) |
| `github.com/charmbracelet/x/input` | `packages/tui/input/` | Forked terminal input module (own go.mod; wired in via `replace github.com/charmbracelet/x/input => ./input` in `packages/tui/go.mod`) |
| `github.com/sst/opencode-sdk-go` | `packages/sdk/go/` | Go SDK, header comment: "File generated from our OpenAPI spec by Stainless"; internals `apijson`, `apiquery`, `apiform`, `testutil` |

Everything else in the current repo is TypeScript/Bun (`packages/core`, `packages/tui` (TS/SolidJS), `packages/server`, etc.).

## Test inventory (v1.0.0, exact counts)

- Total: **31 `*_test.go` files**, **97 `func Test*`**, **4 benchmarks**, **1 fuzz target**.
- Lines of test code: TUI 2,817; SDK not aggregated (13 files in SDK root + 5 in internal packages).
- Distribution:

| Area | Files | Notable files |
|---|---|---|
| `packages/sdk/go/` (root) | 13 | `session_test.go` (552 L, 18 tests), `client_test.go` (336 L, 10), `tui_test.go` (235 L, 9) |
| `packages/sdk/go/internal/apijson` | 3 | `json_test.go` (617 L), `port_test.go` (257 L) |
| `packages/sdk/go/internal/apiquery` / `apiform` | 1 + 1 | `query_test.go` (335 L), `form_test.go` (440 L) |
| `packages/tui/input/` | 6 | `key_test.go` (880 L), `mouse_test.go` (481 L), `driver_windows_test.go` (271 L) |
| `packages/tui/internal/components/{list,textarea,status}` | 3 | `list_test.go` (249 L, 6 tests) |
| `packages/tui/internal/{app,theme,decoders,util}` | 4 | `app_test.go` (304 L), `decoder_test.go` (194 L) |

- Coverage shape: `packages/tui/internal/` has 20,793 lines of non-test Go but only 13 test files in TUI total — most of the TUI (chat, dialog, diff, modal, toast, etc.) had no tests at all.

## Styles & patterns

- **Standard library only.** Zero occurrences of testify/gomega anywhere in Go code. Assertions are raw `t.Errorf`/`t.Fatalf`.
- **Table-driven:** exactly 3 files use the `cases := []struct{...}` pattern — `packages/tui/input/mouse_test.go`, `packages/tui/input/driver_windows_test.go`, `packages/tui/internal/app/app_test.go`. `key_test.go` uses subtests (`t.Run` per key name) instead of tables. The rest are sequential-assertion tests.
- **No golden/snapshot files in Go.** No `testdata/` dir, no `*.golden`, no snapshot library. The only snapshot artifact in the repo is TypeScript (vitest `__snapshots__`).
- **Skip-heavy SDK tests:** 43 `t.Skip` lines in `packages/sdk/go/*_test.go`. All Stainless-generated contract tests are `t.Skip("Prism tests are disabled")` — the Prism mock-server suite is disabled wholesale.
- **Environment-dependent skips:** `packages/tui/internal/components/status/status_test.go` skips at runtime when not inside a git repo (`t.Skip("Not in a git repository, skipping test")`).

## TUI testing approach (Bubble Tea)

No `teatest`, no terminal emulation, no rendered-output assertions anywhere. Two concrete techniques:

1. **Direct model driving (component level).** Construct the component with its functional options, push `tea.KeyPressMsg` events into `Update()`, assert on internal state (not rendered string). `packages/tui/internal/components/list/list_test.go`:

```go
downKey := tea.KeyPressMsg{Code: tea.KeyDown}
updatedModel, _ := list.Update(downKey)
list = updatedModel.(*listComponent[testItem])
_, idx := list.GetSelectedItem()
if idx != 1 {
    t.Errorf("Expected selected index 1 after down arrow, got %d", idx)
}
```

Same pattern in `textarea_test.go` (mutate model, assert `Value()`/`CursorColumn()`) and `TestEmptyList` (send keys to an empty list, assert it does not crash).

2. **Pure-function extraction.** `app_test.go` tests only extracted helper functions (`findModelByFullID`, model-selection priority) — the app component itself is untested.

Other TUI-adjacent testing:
- `internal/decoders/decoder_test.go`: SSE decoder fed via `io.NopCloser(strings.NewReader(...))`, includes a 50 MB event boundary test.
- `internal/theme/loader_test.go`: loads real JSON theme files, asserts theme names and a few color fields exist.
- `packages/tui/input/` (the charmbracelet fork): table tests decoding raw ANSI byte sequences into `Event` structs; `driver_windows_test.go` builds synthetic Windows `InputRecord`s and asserts decoded key events (Windows-specific, build-tag limited).

## Test utilities

- Only one shared helper in the whole Go tree: `packages/sdk/go/internal/testutil/testutil.go` — `CheckTestServer()` probes `http://localhost:4010` (Prism mock server generated from the OpenAPI spec), honors a `SKIP_MOCK_TESTS` env var, else `t.Skip`.
- Per-file inline fakes instead of a shared harness: `client_test.go` defines its own `closureTransport` (`http.RoundTripper` stub) and `readerFunc` for streaming/context tests; `list_test.go` defines a `testItem` implementing the `ListItem` interface plus a `createTestList()` factory.
- No `internal/testutil` under `packages/tui/`.

## Integration / e2e

- None in Go. `grep os/exec` across all 31 test files: 0 hits. No process-level tests, no real-terminal (pty) tests, no binary launch tests. The closest thing is the file-watcher test in `status_test.go` that runs against `t.TempDir()` and skips outside a git repo.

## CI

Workflows present at v1.0.0 (`/.github/workflows/`): `deploy.yml`, `duplicate-issues.yml`, `format.yml`, `guidelines-check.yml`, `notify-discord.yml`, `opencode.yml`, `publish-github-action.yml`, `publish-vscode.yml`, `publish.yml`, `snapshot.yml`, `stats.yml`, `test.yml`, `typecheck.yml`.

- `test.yml` (runs on every push and PR): single `ubuntu-latest` job, Bun setup action, then `bun turbo typecheck` followed by `bun turbo test`. **No Go.**
- `typecheck.yml` (PR gate on `dev`): `bun typecheck` only.
- **No workflow at any surveyed tag (v0.4.0, v0.3.0, v1.0.0) ever ran `go test`.** `actions/setup-go` (go-version `>=1.24.0`, `cache: true`, `cache-dependency-path: go.sum`) appears only in `publish.yml` and `snapshot.yml`, for building/publishing binaries — not testing.
- Consequently: no Go test matrix, no Go coverage gate, no flake/retry configuration anywhere (the only retry-ish knob is Bun's `--only-failures` flag in the current TS `package.json` test script: `bun test --timeout 30000 --only-failures`).
- Effective gate order for PRs: bun typecheck → bun test. Go code merged with tests that CI never executed.

## Benchmarks / property / fuzz tests

All concentrated in the keyboard-input hot path (`packages/tui/input/`) plus one decoder benchmark:

- Fuzzing (native `go test -fuzz`): `packages/tui/input/key_test.go` `FuzzParseSequence` — seeds every known escape sequence plus OSC 52 / OSC 11 / DCS / APC examples; invariant: any non-empty input must parse to non-zero width.
- Benchmarks: `BenchmarkDriver` (`driver_test.go`), `BenchmarkParseSequence` (`parse_test.go`), `BenchmarkDetectSequenceMap` (`key_test.go`, uses a seeded PRNG generating 10,000 random bytes — the only randomized-input test), `BenchmarkUnboundedDecoder_LargeEvent` (`decoder_test.go`).
- No property-based testing library, no `Example` functions.

## Current-state context (dev branch, for contrast)

- TS tests: 1,605 `*.test.ts(x)` files; biggest concentrations: `packages/core/test` (185), `packages/ai/test/provider` (116), `packages/app/test-browser` (58), `packages/tui/test` (55) plus `test/cli/tui` (35) and `test/mini` (26). The TS TUI ecosystem is where test investment moved after the rewrite.
