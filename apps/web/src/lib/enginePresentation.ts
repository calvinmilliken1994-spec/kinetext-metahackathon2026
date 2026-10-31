// Stage 8a (lead wiring): how presentation mode drives a new engine view. `step` counts the presenter's → presses
// inside the part's beat (0 on arrival), `revealed` is true after R. Views without a presentation prop are the normal
// lesson view. Frozen in docs/specs/STAGE-8a-subject-engines.md.
export interface EnginePresentation { mode: 'stage'; step: number; revealed: boolean }
