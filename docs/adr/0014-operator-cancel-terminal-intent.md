# ADR-0014: Operator cancel records terminal intent before termination

- **Status:** Accepted
- **Date:** 2026-10-05; amended 2026-10-19 (macOS identity, unconfirmed re-observation)
- **Scope:** Public `subagent_cancel` for ordinary managed Pi subagents

## Context

An operator could interrupt a turn (`subagent_interrupt`) but not end a run.
`subagent_stop` is the persistent-specialist graceful stop and rejects ordinary
children. Closing a child's pane by hand made the watcher report "pane
disappeared" as a provider/agent error, which the run session treated as a
retryable failure and launched the next configured fallback model. Wrapping the
existing primitives does not fix this: `suppress` drops delivery entirely, and
`kill` alone produces exactly that fallback-eligible error.

## Decision

`RunSession.cancel(taskId)` is the one cancellation path, owned by the existing
kernel producer, adapter, and finalization. It is not a second engine.

1. **Terminal intent first.** The call records the cancel intent synchronously,
   before any abort, kill, or await. Every later decision reads it: no fallback,
   acquisition, retry, or recovery starts after it.
2. **Settle point.** The producer's synchronous check after an attempt's wait
   settles decides the race. Intent recorded before it makes the run cancelled,
   even if natural evidence (including the kill's own pane-loss evidence)
   arrived first. A natural result that cannot start a fallback, taken before
   the intent, stays authoritative and cancel reports `already-terminal`. A
   cancel during a fallback-eligible attempt's finalization still wins because
   that result was not terminal.
3. **Owned termination.** The kernel calls the owning adapter's `kill` for the
   current attempt, one kill at a time; concurrent cancels join it. Only a
   resolved kill confirms termination, and only then is the producer's wait
   aborted, so a failed kill leaves the run supervised.
4. **Pending acquisition.** With an acquisition in flight, cancel reports
   `requested`. The acquired owner is registered as usual, so it is never
   leaked, and killed immediately; no later candidate is attempted. The
   kernel projects the cancel state (`requested`, then each kill's outcome,
   including kills it starts itself) onto whichever owner is current, so a
   transferred owner's unconfirmed kill is visible. A cancel
   before any acquisition rejects the launch without acquiring anything. If
   the in-flight acquisition fails, the settled previous attempt is still owned
   and is terminated before delivery. Once every fallback launch has failed,
   the natural failure is terminal before its delivery starts, so a later
   cancel reports `already-terminal`.
5. **One result.** A confirmed cancel is finalized once by the attempt that owns
   it and delivered once with the existing `killed` outcome and a
   `cancellation` record (`requestedAt`, `termination`, `confirmedAt`). Pi
   presents it with its existing "Subagent cancelled." summary and `cancelled`
   error marker, never as a provider failure.
6. **Unconfirmed is not terminal.** A failed kill reports `unconfirmed` with the
   error. The run keeps its live ownership, watcher, row, and panes; nothing is
   delivered, retired, or released. A retry repeats the kill and keeps the first
   `requestedAt`. If the wait later settles on its own, the producer makes one
   kill attempt itself, then waits for an operator retry or shutdown
   suppression, which settles without delivery and is not a cancellation:
   a worktree manifest records what a plain shutdown would, never
   `cancelled`.
7. **Surface ownership.** Pi `kill` closes an ordinary pane and confirms its
   absence through Herdr; a close error on an already-absent pane is still
   confirmed by that absence. A managed-worktree root pane is the retained
   review workspace, and Herdr refuses to close it. For that child, `kill`
   acts only on the child's **process identity**, established at launch from
   immutable kernel facts, never from command-line text: Pi assigns
   `process.title`, which rewrites `/proc/<pid>/cmdline` and erases
   `--session`, and Herdr lists foreground processes only.
   - *Capture.* The child protocol extension records its own PID, `/proc`
     start time, boot ID, and PID namespace into a once-only sidecar
     beside its session (`<session>.process.json`). In the background after
     launch, the parent accepts the record only for this run and session,
     only while that PID is alive with that start time on this boot in the
     parent's own PID namespace (also proven by `/proc/self` naming the
     parent), and only as Herdr's pane shell or a descendant of it. The
     identity lives on the run record. A shell PID merely existing locally is
     not namespace evidence; the recorded namespace link is. The kernel facts
     come from a platform probe: Linux `/proc`, and (amendment) macOS `ps`
     (`ppid`, `state`, `lstart` read under the C locale and UTC, as epoch
     seconds) plus `sysctl kern.bootsessionuuid`, with the fixed namespace
     name `darwin:host` because macOS has one PID space. `lstart` resolves one
     second, so a recycled PID is mistaken for the original only when reused
     within that second. A host with neither probe fails capture at once and
     says so, instead of waiting out the deadline; any other failure reading
     the host facts (for example a failed `sysctl`) may be transient, so it
     is retried within the capture window and reported as the last error.
   - *Signal.* SIGTERM goes only to that identity, re-read (PID and start
     time) immediately before `kill(2)`; a mismatch or read error is never
     signalled. Node exposes no pidfd signal, so the kernel could still reuse
     the PID between that read and the signal; this needs the Pi to exit and
     its PID to be recycled within that window. There is no SIGKILL.
   - *Confirm.* Confirmed only when that identity no longer exists (PID
     absent, or a zombie), or when the pane is gone while the identity is not
     known alive; an identity captured during that pane check is judged
     before confirming. A live identity (including a suspended Pi with
     SIGTERM pending) stays unconfirmed. An identity not captured (no record,
     capture still pending at the kill deadline, a host with no probe, a handoff
     or resumed child), unreadable, from another boot or PID namespace, or
     whose PID now has another start time is not signalled and is
     unconfirmed unless pane absence confirms termination.
   - *Bound.* Every provider await (Herdr process info during capture, pane
     inspection during cancel) is bounded by the remaining capture or kill
     deadline, so `unconfirmed` is reported on time; a late answer is
     dropped and never flips a reported outcome. A cancel after the launch
     capture expired starts one fresh capture bounded by that cancel's own
     deadline, so a retry can pick up a sidecar written late. A restarted
     capture hides the previous failure, so an unconfirmed message that would
     read only "still pending" also carries the earlier attempt's reason.

   The manifest records `cancelled` only for
   confirmed termination, and the handoff is captured as for any completion.
   There is no Git cleanup.
   - *Re-observation (amendment).* An unconfirmed kill is not the end of the
     evidence. A retained pane outlives its Pi, so the child can exit, or its
     pane be closed by another tool, after the kill deadline while no operator
     retries (the producer makes only one kill of its own). After every
     unconfirmed kill the kernel therefore asks the owning adapter
     `confirmTerminated`, every 2 seconds, with no signal and no pane action.
     The Pi adapter answers true when the captured identity no longer exists,
     or when the pane is gone while the identity is not known alive (or was
     never captured); the same rules as the kill's confirmation, so a live,
     unreadable, or reused identity under an open pane stays unconfirmed.
     A true answer confirms termination through the same single path: the
     producer's wait is aborted, the cancelled result is finalized and
     delivered once. The observation pauses while an owned kill is in flight,
     stops on shutdown suppression, and an error or late answer is never
     "gone".
8. **Persistent specialists are rejected** before any kill; `subagent_stop`
   keeps its graceful v1 semantics.

## Consequences

- Cancel never confirms more than its evidence: ordinary confirmation is Herdr
  pane absence, which terminates the pane's PTY, not an OS PID check. Worktree
  confirmation is the launch-captured process identity ceasing to exist; a
  stopped Pi keeps SIGTERM pending and stays unconfirmed until it is resumed
  or exits. The identity is the child's own report, trusted like its other
  sidecars and bounded by liveness, namespace, and pane-ancestry checks at
  capture.
- Worktree cancel signals only on Linux and macOS (amendment; it was Linux
  only): elsewhere no identity is captured, nothing is signalled, and only a
  gone pane confirms.
- An unconfirmed cancel stays a live row while its pane is open and its Pi is
  not proven gone, until a retry, parent shutdown, or (amendment) the
  re-observation seeing the pane or process gone, which settles it by itself.
- Late callbacks after delivery change nothing: the retired ID answers
  `already-terminal`.

## Rejected alternatives

- **Boolean flag plus gate around `kill`:** it misses pending acquisitions, the
  abort-before-confirmation race, and finalization provenance.
- **`suppress` then `kill`:** it drops the one result the parent is waiting for.
- **Deliver `unconfirmed` and retire:** it would release live ownership whose
  process may still be writing.
- **Close the worktree root pane:** it would discard the retained review
  workspace that worktree runs promise to keep.
- **Match the owned process by argv (`--session`):** Pi's process-title
  rewrite erases it, so a live Pi looked exited.
- **Treat a visible pane-shell PID as a shared PID namespace:** an unrelated
  local process can hold the same number.
- **Escalate to SIGKILL automatically:** an operator retry repeats the bounded
  SIGTERM check instead; forced escalation stays outside this decision.
