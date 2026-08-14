# Agent Note: dsh becomes the single native CLI

Status: implemented

English | [中文](2026-08-14-dsh-single-native-cli.zh.md)

## Problem

The native distributions shipped a second command, `deepseek-harness`, a one-shot wrapper over `dsh --profile headless`. It duplicated the launcher's job and held the only OpenAI GPT surface (`login`, `model`, `status`, `logout`), so those commands lived outside `dsh` and the installed command was not the product's terminal client. macOS and Linux only; Windows had no CLI distribution.

## Decision

`dsh` is now the single installed command on every platform. The `deepseek-harness` wrapper (`apps/desktop-runtime/cli-entry.mjs`) and `desktop/cli.cordis.patch.yml` are deleted; the distribution launcher execs `@deepseek-ai/dsh/lib/bin.js` directly with `DSH_HOME` set, so bare `dsh` opens the full-screen Ink client. The OpenAI GPT `login`/`model`/`status`/`logout` commands move into `dsh` (`apps/cli/src/openai.ts` and `src/model.ts`), writing the credential to `$DSH_HOME/pi-ai-auth.json` and the default model to `$DSH_HOME/settings.yaml` — the same documents the `llm-pi-ai` provider route reads. The GPT provider config moves out of the per-surface patches into a shared home-level `desktop/cordis.patch.yml`, which the installer writes to `$DSH_HOME/cordis.patch.yml` so every profile (tui, web, headless) applies it. A Windows CLI distribution joins macOS and Linux: `scripts/build-windows-cli.ts`, a `.cmd` launcher, `scripts/install-release.ps1`, and a `windows-x64` matrix arm in the release workflow.

## Verification

`apps/cli/tests/args.spec.ts` pins the new subcommand routing; `apps/cli/tests/model.spec.ts` pins model selection writing the settings document and preserving unrelated keys; `scripts/native-distributions.spec.ts` pins the `dsh` launcher name, the home-patch install, and the checksum-verified installer. Host and client typecheck and the staged lint pass; Windows build/launcher/installer behavior is CI-verified only (no Windows host in the sandbox).

## Alternatives considered

**Keep the wrapper, rename it to `dsh`.** That keeps the login/model logic outside the published `@deepseek-ai/dsh` package, so `npx @deepseek-ai/dsh login` would not work; moving the commands into `dsh` makes the npm and native surfaces identical.

**Keep `--patch` in the launcher.** `dsh web` rejects a parent `--patch`, so the launcher would re-implement the launcher's subcommand routing; a home-level patch applies to every profile uniformly and needs no such routing.

## Consequences

The installed command is `dsh` on macOS, Linux, and Windows, matching the npm package. The App still launches `dsh web --patch desktop.cordis.patch.yml`, which now also inherits the home patch; the `llm-pi-ai` config in that patch is redundant with it but identical. `desktop/openai-oauth.mjs` remains for the App's native auth bridge, while the CLI uses the TypeScript port, so the OAuth flow exists in two places until the App bridge is consolidated.
