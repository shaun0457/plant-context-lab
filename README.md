# Plant Context Lab

An interactive concept demo of an industrial context layer, built on the Tennessee Eastman process (TEP).

**Live page:** https://shaun0457.github.io/plant-context-lab/

## What it shows

- **Plant view.** A TEP flowsheet in P&ID style, with a switch to a graph view of the same 17 units and 18 streams. Click a unit to see its bound signals, the reviewed engineering knowledge that applies to it, and how far its effects reach downstream (up to 6 hops, loops flagged).
- **Live trends with disturbance injection.** Inject a step in reactor cooling-water inlet temperature, TEP disturbance IDV(4), and watch the cooling-water valve take up the disturbance while the effect lights up across the flowsheet, hop by hop.
- **"What is happening now."** A structured summary of the reactor-cooling subsystem. Every line cites its signal ids, knowledge refs and the exact snapshot (event horizon T, ingest cutoff K).

## Honesty notes

- The trends are **simulated in the browser** for illustration. They are not output from the TEP simulator.
- The topology and signal bindings come from a human-verified TEP process graph. The flowsheet layout is hand-drawn after the classic TEP flowsheet.
- The underlying platform is developed in [tep-agent-lab](https://github.com/shaun0457/tep-agent-lab):
  - **Implemented:** live plant streaming through canonical telemetry; engineering-knowledge extraction with human review.
  - **In progress:** plant context composition and the UI read of pinned snapshots.

A later version will replay recorded runs from the real platform instead of the browser simulation.

## References

- J. J. Downs and E. F. Vogel, "A plant-wide industrial process control problem," *Computers & Chemical Engineering*, 17(3), 1993.
- A. Bathelt, N. L. Ricker and M. Jelali, "Revision of the Tennessee Eastman process model," *IFAC-PapersOnLine*, 48(8), 2015.

A single self-contained HTML file, with no external requests.
