# Agent Note: Composer overlays — fuzzy search on top of the store

Status: implemented

English | [中文](2026-08-15-composer-history-search-overlay.zh.md)

## Problem

The composer recalled submitted lines only with ↑↓ one-at-a-time; Codex's `Ctrl+R` is a live search over the prompt history, and the same interaction will serve the `@` file search. Both need a ranked fuzzy matcher and a small overlay surface that reuses the composer rather than forking a second input.

## Decision

**A pure fuzzy matcher plus a pure overlay reducer.** `fuzzyScore`/`fuzzyFilter` (`src/ui/fuzzy.ts`) rank subsequence matches by consecutive runs, boundary bonuses, and match start. `overlayKey` (`src/ui/overlay.ts`) resolves one key against an open overlay: typing/backspace re-ranks the candidate set through the matcher, ↑/↓ moves the selection (wrapping), Enter closes and returns the selected text for the composer to adopt, Esc/Ctrl+C close without inserting. `openHistoryOverlay` seeds the overlay from the in-App submitted-line history, newest first.

**The store owns the overlay, the App owns the candidate source.** `UiStore.overlay` holds one `{kind: 'history' | 'files', query, matches, selected}` snapshot; the App passes the current candidate list (history lines, or later the project file cache) into `overlayKey`, so the reducer stays pure and the async file backend (next round) can refresh matches outside the key path. The overlay renders between the suggestions and the composer, Codex-style: a header line and `⏺`-marked rows with the selection bolded.

## Consequences

`fuzzy.ts` and `overlay.ts` are unit-covered at 100%; the App wiring is exercised through ui-render (Ctrl+R opens, filters, Enter reuses, Esc closes) and a PTY e2e that submits two lines, filters with `first`, reuses the line, and asserts it is the third request body. Help text and READMEs document Ctrl+R; the Known Limitations list drops history search from the deferred composer work.

## Alternatives considered

- **Reusing the session picker overlay** — the picker is selection-only (no query typing); a query-driven overlay needs its own reducer, shared later with the file search.
- **Substring matching instead of fuzzy** — history lines are long prose; subsequence ranking with boundary bonuses finds `fix` in `git checkout --fix/…` the way Codex's search does.
