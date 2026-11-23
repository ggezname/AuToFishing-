# AuToFishing

AutoFish for AutoX.js, rebuilt as a separate project.

## Safety-first development

This repository is independent from `ggezname/autofish`. The original repository is reference-only and must not be modified.

The new engine is intended for Redfinger, physical Android devices, and Android emulators. Compatibility must be verified per environment; it is not claimed until tested.

## Development stages

1. Build modular screen capture, device profile, calibration, and vision components.
2. Add red-zone detection and white-target tracking with confidence and freshness checks.
3. Add latency-aware motion prediction and anti-miss action guards.
4. Run diagnostic/replay tests with automated taps disabled.
5. Run supervised live safety trials before enabling unattended fishing.

## Safety invariants

- Never tap based on prediction alone.
- Reject stale frames, low-confidence detections, uncertain trajectories, and duplicate actions.
- Require the predicted uncertainty interval to fit inside a safe interior of the red zone.
- Diagnostic mode must not send game taps.
- Keep per-device calibration and timing profiles separate.

## Runtime

Target runtime: AutoX.js on Android. APIs and JavaScript syntax must remain compatible with the actual AutoX.js runtime used for testing.

## Status

Initial project setup. Live fishing is not yet enabled or validated.
