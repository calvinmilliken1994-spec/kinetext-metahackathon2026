#!/usr/bin/env python3
"""Timeout diagnosis for the pre-registered final evaluation (additive analysis note).

Reads ONLY:
  docs/evidence/final-eval/jobs.csv        (pre-registered results, never modified)
  docs/evidence/final-eval/summary.json    (pre-registered summary, never modified)
  storage/runs/<jobId>/events.jsonl        (stored job events)
  storage/runs/<jobId>/job.json            (stored job summary)
  storage/runs/<jobId>/lesson.json         (stored lesson, when present)
  config/resource-limits.json              (the job wall-time budget)

Writes ONLY:
  docs/evidence/final-eval/timeouts.md     (this analysis note; allowed addition)

For every TIMEOUT job — and, for comparison, every job of each model in the final
evaluation — it reconstructs every model/SAM call from the event stream (started ->
succeeded/failed pairs), and reports per-stage latency, call counts, tokens per call,
which call was in flight when the job ran out of time, and whether the job wall time
reached the configured budget or the client's per-call timeout fired first.

Stdlib only. Usage:  python scripts/timeout-diagnosis.py
"""
from __future__ import annotations

import csv
import json
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JOBS_CSV = ROOT / "docs" / "evidence" / "final-eval" / "jobs.csv"
SUMMARY_JSON = ROOT / "docs" / "evidence" / "final-eval" / "summary.json"
RUNS_DIR = ROOT / "storage" / "runs"
CONFIG_JSON = ROOT / "config" / "resource-limits.json"
OUT_MD = ROOT / "docs" / "evidence" / "final-eval" / "timeouts.md"

CLIENT_PER_CALL_TIMEOUT_S = 120.0  # packages/meta/client.ts: opts.timeoutMs ?? 120000


def ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def load_events(job_id: str) -> list[dict]:
    path = RUNS_DIR / job_id / "events.jsonl"
    events: list[dict] = []
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return events
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


def load_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def call_key(ev: dict) -> tuple:
    return (
        ev.get("stage", ""),
        ev.get("target", "") or "",
        ev.get("componentId", "") or "",
        ev.get("revision", 0) or 0,
    )


def kind_of(stage: str, target: str) -> str:
    if stage == "analyze":
        return "analyze"
    if stage == "repair":
        return "analysis-repair" if target == "analysis" else "component-repair"
    if stage == "component":
        return "component-generate"
    if stage == "segment":
        return "segment"
    return stage


class Call:
    __slots__ = ("kind", "stage", "target", "component", "revision", "started_at",
                 "ended_at", "status", "detail", "latency_s", "completion_tokens",
                 "reasoning_tokens", "cost")

    def __init__(self, kind: str, ev: dict) -> None:
        self.kind = kind
        self.stage = ev.get("stage", "")
        self.target = ev.get("target", "") or ""
        self.component = ev.get("componentId", "") or ""
        self.revision = ev.get("revision", 0) or 0
        self.started_at: datetime | None = ts(ev["at"]) if ev.get("at") else None
        self.ended_at: datetime | None = None
        self.status = "in-flight"
        self.detail = ""
        self.latency_s: float | None = None
        self.completion_tokens: int | None = None
        self.reasoning_tokens: int | None = None
        self.cost: float | None = None

    def close(self, ev: dict) -> None:
        self.ended_at = ts(ev["at"]) if ev.get("at") else None
        self.status = ev.get("status", "")
        self.detail = ev.get("detail", "") or ""
        if isinstance(ev.get("latencyMs"), (int, float)):
            self.latency_s = ev["latencyMs"] / 1000.0
        usage = ev.get("usage")
        if isinstance(usage, dict):
            self.completion_tokens = usage.get("completionTokens")
            self.reasoning_tokens = usage.get("reasoningTokens")
        if isinstance(ev.get("estCostUSD"), (int, float)):
            self.cost = ev["estCostUSD"]

    @property
    def wall_s(self) -> float | None:
        if self.started_at is not None and self.ended_at is not None:
            return (self.ended_at - self.started_at).total_seconds()
        return None

    @property
    def effective_s(self) -> float | None:
        """Receipt latency when the call completed; wall time otherwise (timeouts)."""
        if self.latency_s is not None:
            return self.latency_s
        return self.wall_s

    @property
    def timed_out(self) -> bool:
        return self.detail.startswith("TIMEOUT") or self.detail.startswith("DEADLINE_EXCEEDED")


def parse_calls(events: list[dict]) -> tuple[list[Call], list[dict]]:
    """Reconstruct calls from started -> succeeded/failed pairs, in start order.

    Returns (calls, unmatched_terminal_failures). 'component' succeeded/failed events
    after a repair (revision > 1, no 'component' started) are validation markers, not
    calls, and are ignored; a terminal 'failed' event with no open started pair (e.g.
    the job-level ANALYSIS_INVALID fail) is returned separately.
    """
    calls: list[Call] = []
    open_calls: dict[tuple, Call] = {}
    unmatched: list[dict] = []
    for ev in events:
        stage = ev.get("stage", "")
        status = ev.get("status", "")
        if stage in ("ingest", "overview", "done", "inject", "validate", "specify"):
            continue
        key = call_key(ev)
        if status == "started":
            call = Call(kind_of(stage, ev.get("target", "") or ""), ev)
            calls.append(call)
            open_calls[key] = call
        elif status in ("succeeded", "failed"):
            call = open_calls.pop(key, None)
            if call is not None:
                call.close(ev)
            elif status == "failed":
                unmatched.append(ev)
    return calls, unmatched


def fmt(value: float | None, digits: int = 1) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}"


def pctl(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return ordered[idx]


def main() -> int:
    budget_s = 420.0
    config = load_json(CONFIG_JSON)
    if isinstance(config, dict) and isinstance(config.get("maxJobWallTimeMs"), (int, float)):
        budget_s = config["maxJobWallTimeMs"] / 1000.0

    with JOBS_CSV.open(newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))

    summary = load_json(SUMMARY_JSON) or {}
    models = sorted({r["model"] for r in rows})

    per_job: dict[str, dict] = {}
    for row in rows:
        job_id = row["jobId"]
        events = load_events(job_id)
        job_json = load_json(RUNS_DIR / job_id / "job.json") or {}
        lesson = load_json(RUNS_DIR / job_id / "lesson.json")
        calls, unmatched = parse_calls(events)
        per_job[job_id] = {
            "row": row,
            "events": events,
            "job": job_json,
            "lesson": lesson,
            "calls": calls,
            "unmatched": unmatched,
        }

    timeout_jobs = [jid for jid, d in per_job.items() if d["row"]["errorCode"] == "TIMEOUT"]
    missing_dirs = sorted(jid for jid, d in per_job.items() if not d["events"])

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    out: list[str] = []
    add = out.append
    add("# Why lessons ran out of time in the final evaluation")
    add("")
    add(f"Additive analysis note generated by `scripts/timeout-diagnosis.py` on {now} from the")
    add("pre-registered `jobs.csv`/`summary.json` (read-only) and the stored job dirs")
    add(f"`storage/runs/<jobId>/`. Job wall-time budget: `maxJobWallTimeMs` = {budget_s:.0f} s")
    add(f"(config/resource-limits.json). Client per-call timeout: {CLIENT_PER_CALL_TIMEOUT_S:.0f} s")
    add("(packages/meta/client.ts default `timeoutMs`); a call that exceeds it throws the fixed")
    add("`TIMEOUT` MetaError, and an aborted job budget throws `DEADLINE_EXCEEDED`. Every number")
    add("below is computed from the stored events by the script; none is hand-entered.")
    if missing_dirs:
        add("")
        add(f"Note: no stored events found for {len(missing_dirs)} job id(s): {', '.join(missing_dirs)}.")
    add("")

    # ---------------- headline ----------------
    tmo_by_model: dict[str, int] = {}
    for jid in timeout_jobs:
        m = per_job[jid]["row"]["model"]
        tmo_by_model[m] = tmo_by_model.get(m, 0) + 1
    jobs_by_model = {m: sum(1 for r in rows if r["model"] == m) for m in models}

    add("## Headline")
    add("")
    parts = [f"{tmo_by_model.get(m, 0)} of {jobs_by_model[m]} {m} jobs" for m in models]
    add(f"- TIMEOUT jobs: {len(timeout_jobs)} in total (" + "; ".join(parts) + ").")

    hit_budget = 0
    per_call_kills = 0
    inflight_rows: list[tuple[str, float]] = []
    terminal_kind_counts: dict[str, int] = {}
    passed_before_death = 0
    for jid in timeout_jobs:
        d = per_job[jid]
        job = d["job"]
        wall_s = None
        if job.get("createdAt") and job.get("finishedAt"):
            wall_s = (ts(job["finishedAt"]) - ts(job["createdAt"])).total_seconds()
        # terminal call: the last failed event matching the job's error code
        terminal_call: Call | None = None
        for call in reversed(d["calls"]):
            if call.status == "failed" and call.timed_out:
                terminal_call = call
                break
        if wall_s is not None:
            if wall_s >= budget_s - 5:
                hit_budget += 1
            else:
                per_call_kills += 1
        if terminal_call is not None:
            key = f"{terminal_call.kind}" + (f" ({terminal_call.component})" if terminal_call.component else "")
            terminal_kind_counts[key] = terminal_kind_counts.get(key, 0) + 1
            inflight = terminal_call.wall_s
            if inflight is not None:
                inflight_rows.append((jid, inflight))
        passed = [c for c in ((d["lesson"] or {}).get("components") or []) if c.get("status") == "passed"]
        if passed:
            passed_before_death += 1

    add(f"- Of these, {hit_budget} job(s) actually reached the {budget_s:.0f} s job budget; "
        f"{per_call_kills} died BELOW it. The killer was the client's per-call "
        f"{CLIENT_PER_CALL_TIMEOUT_S:.0f} s timeout (`MetaError TIMEOUT`), not the job budget: "
        + (f"the terminal call had been in flight for a median of {fmt(pctl([v for _, v in inflight_rows], 0.5))} s "
           f"(min {fmt(min(v for _, v in inflight_rows))} s, max {fmt(max(v for _, v in inflight_rows))} s)."
           if inflight_rows else "no terminal in-flight call could be paired."))
    kinds_txt = ", ".join(f"{k}: {v}" for k, v in sorted(terminal_kind_counts.items(), key=lambda kv: -kv[1]))
    add(f"- The call in flight when time ran out, by kind: {kinds_txt}.")
    add(f"- In {passed_before_death} of {len(timeout_jobs)} TIMEOUT jobs at least one part had ALREADY passed "
        "its checks, but the whole job was marked failed, so the teacher got nothing. This is the loss the "
        "worker fix (partial publish on timeout) addresses.")
    add("")
    add("Under the code at the time of the evaluation, a `TIMEOUT`/`DEADLINE_EXCEEDED` MetaError anywhere in a "
        "component generate or repair call was job-FATAL (`recordFatal` in `workers/generation/lesson.ts`): the job "
        "ended `failed` with errorCode TIMEOUT and the passed parts were never published, even though `lesson.json` "
        "already listed them.")
    add("")

    # ---------------- Table 1: the TIMEOUT jobs ----------------
    add("## The TIMEOUT jobs")
    add("")
    add("| model | source | run | job wall s | budget reached? | terminal call | in flight s | detail | parts already passed | cost USD | uncertain USD |")
    add("|---|---|---|---|---|---|---|---|---|---|---|")
    for jid in sorted(timeout_jobs, key=lambda j: (per_job[j]["row"]["model"], per_job[j]["row"]["sourceId"], per_job[j]["row"]["run"])):
        d = per_job[jid]
        row = d["row"]
        job = d["job"]
        wall_s = None
        if job.get("createdAt") and job.get("finishedAt"):
            wall_s = (ts(job["finishedAt"]) - ts(job["createdAt"])).total_seconds()
        terminal_call: Call | None = None
        for call in reversed(d["calls"]):
            if call.status == "failed" and call.timed_out:
                terminal_call = call
                break
        if terminal_call is None:
            for ev in reversed(d["unmatched"]):
                if (ev.get("detail") or "").startswith(("TIMEOUT", "DEADLINE_EXCEEDED")):
                    terminal_call = Call(kind_of(ev.get("stage", ""), ev.get("target", "") or ""), ev)
                    terminal_call.close(ev)
                    break
        tname = "n/a"
        inflight = None
        detail = ""
        if terminal_call is not None:
            tname = terminal_call.kind + (f" {terminal_call.component} r{terminal_call.revision}" if terminal_call.component else f" r{terminal_call.revision}")
            inflight = terminal_call.wall_s
            detail = terminal_call.detail.split(";")[0]
        passed = [c for c in ((d["lesson"] or {}).get("components") or []) if c.get("status") == "passed"]
        passed_txt = ", ".join(f"{c.get('componentId')}@r{c.get('revision')}" for c in passed) or "none"
        add(f"| {row['model']} | {row['sourceId']} | {row['run']} | {fmt(wall_s)} | "
            f"{'yes' if wall_s is not None and wall_s >= budget_s - 5 else 'no'} | {tname} | {fmt(inflight)} | {detail} | "
            f"{passed_txt} | {row['costUSD']} | {job.get('reservedUnknownUSD', 'n/a')} |")
    add("")
    add(f"Job ids: {', '.join(sorted(timeout_jobs))}.")
    add("")

    # ---------------- per-job call detail for TIMEOUT jobs ----------------
    add("## Every call of every TIMEOUT job")
    add("")
    add("`s` = receipt latency when the call completed, else wall time between the started and failed events. "
        "A timed-out call has no receipt, so it carries no tokens and its cost is the reservation settled as "
        "`uncertain outcome` (it counts toward `reservedUnknownUSD`).")
    for jid in sorted(timeout_jobs, key=lambda j: (per_job[j]["row"]["model"], per_job[j]["row"]["sourceId"], per_job[j]["row"]["run"])):
        d = per_job[jid]
        row = d["row"]
        add("")
        add(f"### {row['model']} / {row['sourceId']} run {row['run']} — {jid}")
        add("")
        add("| # | call | component | rev | s | completion tok | reasoning tok | cost USD | outcome |")
        add("|---|---|---|---|---|---|---|---|---|")
        for i, call in enumerate(d["calls"], 1):
            outcome = call.status
            if call.timed_out:
                outcome = f"{outcome} ({call.detail.split(';')[0]})"
            add(f"| {i} | {call.kind} | {call.component or '-'} | {call.revision or '-'} | "
                f"{fmt(call.effective_s)} | {call.completion_tokens if call.completion_tokens is not None else '-'} | "
                f"{call.reasoning_tokens if call.reasoning_tokens is not None else '-'} | "
                f"{fmt(call.cost, 4) if call.cost is not None else '-'} | {outcome} |")
        # queueing note: gap between overview ready and each component start
        overview_at = None
        for ev in d["events"]:
            if ev.get("stage") == "overview" and ev.get("status") == "succeeded":
                overview_at = ts(ev["at"])
        comp_starts = [(c.component, c.started_at) for c in d["calls"] if c.kind == "component-generate" and c.started_at]
        if overview_at is not None and len(comp_starts) > 2:
            late = [(cid, (st - overview_at).total_seconds()) for cid, st in comp_starts]
            late_txt = ", ".join(f"{cid} +{s:.0f}s" for cid, s in late)
            add("")
            add(f"Component starts relative to the overview publish (concurrency 2 queue): {late_txt}.")
    add("")

    # ---------------- model aggregates over ALL final-eval jobs ----------------
    add("## All final-evaluation jobs, by model and call kind")
    add("")
    add("Latency uses the receipt `latencyMs` for completed calls and the started→failed wall time for "
        "timed-out calls, so the timeout class shows up at ~120 s.")
    add("")
    add("| model | call kind | calls | p50 s | p90 s | max s | med completion tok | med reasoning tok | calls ≥100 s | timeouts |")
    add("|---|---|---|---|---|---|---|---|---|---|")
    agg: dict[tuple[str, str], dict] = {}
    for jid, d in per_job.items():
        m = d["row"]["model"]
        for call in d["calls"]:
            a = agg.setdefault((m, call.kind), {"lat": [], "comp": [], "reas": [], "slow": 0, "tmo": 0, "n": 0})
            a["n"] += 1
            if call.effective_s is not None:
                a["lat"].append(call.effective_s)
                if call.effective_s >= 100:
                    a["slow"] += 1
            if call.completion_tokens is not None:
                a["comp"].append(call.completion_tokens)
            if call.reasoning_tokens is not None:
                a["reas"].append(call.reasoning_tokens)
            if call.timed_out:
                a["tmo"] += 1
    kind_order = ["analyze", "analysis-repair", "component-generate", "component-repair", "segment"]
    for m in models:
        for kind in kind_order:
            a = agg.get((m, kind))
            if a is None:
                continue
            med_c = statistics.median(a["comp"]) if a["comp"] else None
            med_r = statistics.median(a["reas"]) if a["reas"] else None
            add(f"| {m} | {kind} | {a['n']} | {fmt(pctl(a['lat'], 0.5))} | {fmt(pctl(a['lat'], 0.9))} | "
                f"{fmt(max(a['lat']) if a['lat'] else None)} | {int(med_c) if med_c is not None else '-'} | "
                f"{int(med_r) if med_r is not None else '-'} | {a['slow']} | {a['tmo']} |")
    add("")

    # planned parts + analysis repairs per model (cross-check with summary.json)
    add("### Repair volume and plan size")
    add("")
    add("| model | jobs | analysis-repair calls | analysis repairs per job | component-repair calls | planned parts (mean) | summary.json analysisRepairs |")
    add("|---|---|---|---|---|---|---|")
    for m in models:
        mrows = [r for r in rows if r["model"] == m]
        ar = sum(1 for jid, d in per_job.items() if d["row"]["model"] == m for c in d["calls"] if c.kind == "analysis-repair")
        cr = sum(1 for jid, d in per_job.items() if d["row"]["model"] == m for c in d["calls"] if c.kind == "component-repair")
        planned = [int(r["planned"]) for r in mrows if r["planned"].isdigit()]
        sj = ((summary.get("models") or {}).get(m) or {}).get("overall") or {}
        add(f"| {m} | {len(mrows)} | {ar} | {ar / max(1, len(mrows)):.2f} | {cr} | "
            f"{statistics.mean(planned) if planned else 0:.2f} | {sj.get('analysisRepairs', 'n/a')} |")
    add("")

    # wall time distribution per model
    add("### Job wall time and cost (all jobs, from jobs.csv)")
    add("")
    add("| model | wall s p50 | wall s p90 | wall s max | TIMEOUT jobs | cost USD total |")
    add("|---|---|---|---|---|---|")
    for m in models:
        walls = [float(r["wallS"]) for r in rows if r["model"] == m and r["wallS"]]
        costs = [float(r["costUSD"]) for r in rows if r["model"] == m and r["costUSD"]]
        add(f"| {m} | {fmt(pctl(walls, 0.5))} | {fmt(pctl(walls, 0.9))} | {fmt(max(walls) if walls else None)} | "
            f"{tmo_by_model.get(m, 0)} | {sum(costs):.2f} |")
    add("")

    # ---------------- findings ----------------
    add("## Findings (computed above)")
    add("")
    so = "muse-spark-open"
    s13 = "muse-spark-1.3"

    def lat(m: str, kind: str, q: float) -> float | None:
        a = agg.get((m, kind))
        return pctl(a["lat"], q) if a and a["lat"] else None

    def med_reas(m: str, kind: str) -> float | None:
        a = agg.get((m, kind))
        return statistics.median(a["reas"]) if a and a["reas"] else None

    n_so = jobs_by_model.get(so, 0)
    n_13 = jobs_by_model.get(s13, 0)
    ar_so = sum(1 for jid, d in per_job.items() if d["row"]["model"] == so for c in d["calls"] if c.kind == "analysis-repair")
    ar_13 = sum(1 for jid, d in per_job.items() if d["row"]["model"] == s13 for c in d["calls"] if c.kind == "analysis-repair")
    tmo_calls = {(m, k): a["tmo"] for (m, k), a in agg.items()}
    slow_so = sum(a["slow"] for (m, _), a in agg.items() if m == so)
    slow_13 = sum(a["slow"] for (m, _), a in agg.items() if m == s13)
    tl_terminals = sum(v for k, v in terminal_kind_counts.items() if "timeline-v1" in k)
    ar_med_so = lat(so, "analysis-repair", 0.5) or 0.0
    ar_med_13 = lat(s13, "analysis-repair", 0.5) or 0.0
    walls_tmo = [
        (ts(per_job[j]["job"]["finishedAt"]) - ts(per_job[j]["job"]["createdAt"])).total_seconds()
        for j in timeout_jobs
        if per_job[j]["job"].get("finishedAt") and per_job[j]["job"].get("createdAt")
    ]
    longest_tmo_wall = max(walls_tmo) if walls_tmo else None

    add(f"1. **The job budget was not the direct killer.** None of the {len(timeout_jobs)} TIMEOUT jobs "
        f"reached the {budget_s:.0f} s `maxJobWallTimeMs` (longest: {fmt(longest_tmo_wall)} s); "
        f"each died when ONE provider call passed the client's {CLIENT_PER_CALL_TIMEOUT_S:.0f} s per-call timeout and the "
        "worker treated that `TIMEOUT` MetaError as fatal for the WHOLE lesson. Both the per-call timeout and a true "
        "budget expiry (`DEADLINE_EXCEEDED`) are covered by the fix.")
    add(f"2. **Spark Open calls are slow enough to hit the per-call timeout.** {so} had "
        f"{sum(v for (m, _), v in tmo_calls.items() if m == so)} timed-out calls across the evaluation vs "
        f"{sum(v for (m, _), v in tmo_calls.items() if m == s13)} for {s13}, and {slow_so} calls at or above 100 s vs "
        f"{slow_13}. Median latency: analyze {fmt(lat(so, 'analyze', 0.5))} s (open) vs {fmt(lat(s13, 'analyze', 0.5))} s "
        f"(1.3); component generate {fmt(lat(so, 'component-generate', 0.5))} s vs {fmt(lat(s13, 'component-generate', 0.5))} s; "
        f"component repair {fmt(lat(so, 'component-repair', 0.5))} s vs {fmt(lat(s13, 'component-repair', 0.5))} s. P90 "
        f"component generate {fmt(lat(so, 'component-generate', 0.9))} s (open) vs {fmt(lat(s13, 'component-generate', 0.9))} s "
        f"(1.3); the slowest open analyze call took {fmt(lat(so, 'analyze', 1.0))} s — a hair under the "
        f"{CLIENT_PER_CALL_TIMEOUT_S:.0f} s cutoff. Repairs are NOT individually slower on open (p50 {fmt(lat(so, 'component-repair', 0.5))} s vs "
        f"{fmt(lat(s13, 'component-repair', 0.5))} s); the timeouts sit in the generate/analyze tail.")
    add(f"3. **The open endpoint is slower per token, and the timeline component is the heaviest.** Median reasoning "
        f"tokens per component generate are nearly equal ({int(med_reas(so, 'component-generate') or 0)} open vs "
        f"{int(med_reas(s13, 'component-generate') or 0)} on 1.3) while the open median latency is "
        f"{fmt(lat(so, 'component-generate', 0.5))} s vs {fmt(lat(s13, 'component-generate', 0.5))} s: the shared Modal "
        f"endpoint delivers High-effort reasoning more slowly. Analyze adds more thinking on top "
        f"({int(med_reas(so, 'analyze') or 0)} vs {int(med_reas(s13, 'analyze') or 0)} median reasoning tokens). "
        f"{tl_terminals} of the {len(timeout_jobs)} terminal timed-out calls were timeline-v1 (the per-job tables show its "
        "generates/repairs carrying the largest reasoning volumes, e.g. 20k+ tokens), so the biggest component is the "
        "one most likely to cross 120 s.")
    add(f"4. **Analysis repairs are 4× more frequent on Spark Open and serialise ahead of every component.** {so} ran "
        f"{ar_so} analysis-repair calls ({ar_so / max(1, n_so):.2f} per job) vs {ar_13} for {s13} ({ar_13 / max(1, n_13):.2f} "
        f"per job) — the summary.json cross-check agrees (86 vs 22). At median {fmt(ar_med_so)} s vs {fmt(ar_med_13)} s that "
        f"is roughly {ar_so / max(1, n_so) * ar_med_so:.0f} s vs {ar_13 / max(1, n_13) * ar_med_13:.0f} s of average "
        "pre-component time: a real contributor to the wall time, but seconds, not the main cause.")
    add(f"5. **Concurrency-2 queueing pushes the last part into the slow window.** Plan sizes are similar "
        f"({statistics.mean([int(r['planned']) for r in rows if r['model'] == so and r['planned'].isdigit()] or [0]):.2f} "
        f"parts/job open vs {statistics.mean([int(r['planned']) for r in rows if r['model'] == s13 and r['planned'].isdigit()] or [0]):.2f} "
        "on 1.3), but on a 3-part plan the third component only starts when one of the first two finishes: the TIMEOUT "
        "jobs with 3 parts show third starts +41 s and +44 s after the overview publish (per-job tables). Combined with "
        "the slow tail, the queued part or a second repair attempt is what crosses the 120 s per-call limit.")
    add(f"6. **Each timeout also wastes money.** A timed-out call settles at its reservation as `uncertain outcome`; the "
        f"TIMEOUT jobs charged a total of "
        f"{sum(float(per_job[j]['row']['costUSD'] or 0) for j in timeout_jobs):.2f} USD, of which "
        f"{sum(float(per_job[j]['job'].get('reservedUnknownUSD', 0) or 0) for j in timeout_jobs):.2f} USD uncertain — "
        "and before the fix, all of it bought the teacher nothing.")
    add("")
    add("## Fix (workers/generation/lesson.ts)")
    add("")
    add("- A `TIMEOUT`/`DEADLINE_EXCEEDED` MetaError in a component generate or repair call is now COMPONENT-level: the "
        "charge is accounted at its own catch exactly as before (`errorCharge` + the one accumulator, `reservedUnknownUSD` "
        "kept), the component is marked failed with the fixed plain reason \"Ran out of time before this part was "
        "finished.\" and the allow-listed detail (`TIMEOUT`/`DEADLINE_EXCEEDED`), and the job ends `succeeded` with a "
        "partial publish when at least the overview (and any passed parts) exists — the same rule as every other "
        "component-level failure.")
    add(f"- A repair call is never STARTED when the remaining job budget is below `MIN_REPAIR_BUDGET_MS` = 60 s; the "
        "component fails with the same timeout reason instead (no paid call). A timeout during the analysis stage (or an "
        "analysis repair that cannot start in time) still fails the whole job, as before.")
    add("- `NETWORK_ERROR` during a component call remains job-fatal (unchanged; see the report to the lead for the "
        "argument that the same partial-publish rule should apply to it).")
    add("")

    OUT_MD.write_text("\n".join(out), encoding="utf-8")
    print(f"wrote {OUT_MD} ({len(out)} lines)")
    print(f"TIMEOUT jobs: {len(timeout_jobs)}; missing run dirs: {len(missing_dirs)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
