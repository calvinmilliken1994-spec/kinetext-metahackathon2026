"""Final-evaluation report (pre-registered measures in docs/evidence/final-eval/PREREGISTRATION.md).

Reads the driver result lines and each job's stored run directory, then writes:
  docs/evidence/final-eval/summary.json   all numbers
  docs/evidence/final-eval/jobs.csv       one row per job
  docs/evidence/final-eval/REPORT.md      tables
  docs/evidence/final-eval/charts/*.svg   charts for the video
Usage: python scripts/final-eval-report.py
"""
import csv
import json
import math
import pathlib
from collections import Counter, defaultdict
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
EV = ROOT / "docs/evidence/final-eval"
RUNS = ROOT / "storage/runs"
MODELS = ["muse-spark-1.3", "muse-spark-open"]
LABEL = {"muse-spark-1.3": "Muse Spark 1.3", "muse-spark-open": "Muse Spark Open"}
SUBJECT_LABEL = {
    "physics": "Physics", "chemistry": "Chemistry", "biology": "Biology", "earth-science": "Earth & space",
    "maths": "Maths", "computing": "Computing & AI", "finance": "Finance", "civics": "Civics", "history": "History",
}
ENGINE_LABEL = {
    "quiz-cards-v1": "Quiz cards", "sequence-v1": "Sequence", "sort-groups-v1": "Sort", "concept-map-v1": "Concept map",
    "compare-table-v1": "Compare table", "formula-explorer-v1": "Formula explorer", "balance-equation-v1": "Balance equation",
    "algorithm-trace-v1": "Algorithm tracer", "log-ladder-v1": "Log-scale ladder", "threshold-v1": "Vote threshold",
    "data-table-v1": "Data table", "label-diagram-v1": "Label the diagram", "timeline-v1": "Timeline",
    "forces-1d-v1": "Forces sim", "projectile-v1": "Projectile sim", "lift-equation-v1": "Lift sim",
    "half-life-v1": "Half-life sim", "hardy-weinberg-v1": "Hardy-Weinberg sim", "compound-interest-v1": "Compound interest sim",
}


def wilson(k, n, z=1.96):
    if n == 0:
        return [None, None]
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(max(0.0, c - h), 4), round(min(1.0, c + h), 4)]


def rate(k, n):
    return {"k": k, "n": n, "rate": round(k / n, 4) if n else None, "ci95": wilson(k, n)}


def pct(xs, q):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    i = min(len(xs) - 1, max(0, math.ceil(q * len(xs)) - 1))
    return xs[i]


def iso(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def subjects():
    out = {}
    for f in (ROOT / "data/sources").glob("*.json"):
        m = json.loads(f.read_text(encoding="utf-8"))
        if isinstance(m, dict) and "id" in m:
            out[m["id"]] = m.get("subject")
    return out


def load_job(row, subj):
    d = RUNS / row["jobId"]
    job = json.loads((d / "job.json").read_text(encoding="utf-8"))
    lesson = json.loads((d / "lesson.json").read_text(encoding="utf-8")) if (d / "lesson.json").exists() else None
    events = [json.loads(l) for l in (d / "events.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()] if (d / "events.jsonl").exists() else []
    comps = (lesson or {}).get("components", []) or []
    declined = job["status"] == "unsupported" or any(e["stage"] == "analyze" and str(e.get("detail", "")).startswith("declined") for e in events)
    tokens = Counter()
    stage_ms = defaultdict(int)
    comp_cost = defaultdict(float)
    sam = {"calls": 0, "images": 0, "usd": 0.0, "ms": []}
    for e in events:
        u = e.get("usage") or {}
        for k in ("promptTokens", "completionTokens", "reasoningTokens"):
            tokens[k] += u.get(k, 0) or 0
        if e.get("latencyMs") and e.get("status") in ("succeeded", "failed"):
            stage_ms[e["stage"]] += e["latencyMs"]
        if e.get("componentId") and e.get("estCostUSD"):
            comp_cost[e["componentId"]] += e["estCostUSD"]
        if e["stage"] == "segment" and e.get("status") == "succeeded":
            sam["calls"] += 1
            sam["images"] += e.get("imagesProcessed") or 0
            sam["usd"] += e.get("estCostUSD") or 0
            if e.get("latencyMs"):
                sam["ms"].append(e["latencyMs"])
    parts = []
    for c in comps:
        rev = c.get("revision") or 1
        parts.append({
            "componentId": c["componentId"], "status": c["status"], "revision": rev,
            "firstTry": c["status"] == "passed" and rev == 1,
            "repaired": c["status"] == "passed" and rev > 1,
            "failedR1": rev > 1 or c["status"] != "passed",
            "reason": (c.get("reason") or "")[:160],
            "estCostUSD": round(comp_cost.get(c["componentId"], 0.0), 6),
        })
    wall = (iso(job["finishedAt"]) - iso(job["createdAt"])).total_seconds() if job.get("finishedAt") else None
    published = sum(1 for p in parts if p["status"] == "passed")
    if declined:
        outcome = "declined"
    elif published >= 1 and job["status"] == "succeeded":
        outcome = "lesson"
    else:
        outcome = "failed"
    return {
        "jobId": row["jobId"], "sourceId": row["sourceId"], "subject": subj.get(row["sourceId"]), "model": row["model"],
        "run": row["run"], "status": job["status"], "outcome": outcome, "declined": declined,
        "errorCode": (job.get("error") or {}).get("code"), "wallS": wall, "costUSD": job.get("totalCostUSD") or 0.0,
        "reservedUnknownUSD": job.get("reservedUnknownUSD") or 0.0, "planned": len(parts), "published": published,
        "parts": parts, "analysisRepairs": len(job.get("analysisRepairs") or []),
        "analysisRepairPassed": any(r.get("passed") for r in (job.get("analysisRepairs") or [])),
        "componentRepairs": job.get("componentRepairs") or [], "tokens": dict(tokens), "stageMs": dict(stage_ms), "sam": sam,
    }


def summarise(jobs):
    n = len(jobs)
    usable = [j for j in jobs if not j["declined"]]
    parts = [p for j in usable for p in j["parts"]]
    failed_r1 = [p for p in parts if p["failedR1"]]
    repaired = [p for p in parts if p["repaired"]]
    targeted = Counter(t for j in jobs for r in j["componentRepairs"] for t in (r.get("targeted") or []))
    walls = [j["wallS"] for j in jobs]
    cost = sum(j["costUSD"] for j in jobs)
    pub = sum(j["published"] for j in jobs)
    failed_part_cost = sum(p["estCostUSD"] for j in jobs for p in j["parts"] if p["status"] != "passed")
    return {
        "jobs": n,
        "lessonWithPart": rate(sum(1 for j in jobs if j["outcome"] == "lesson"), n),
        "lessonWithPartOfUsable": rate(sum(1 for j in usable if j["outcome"] == "lesson"), len(usable)),
        "declined": rate(sum(1 for j in jobs if j["declined"]), n),
        "failed": rate(sum(1 for j in jobs if j["outcome"] == "failed"), n),
        "errorCodes": dict(Counter(j["errorCode"] for j in jobs if j["errorCode"])),
        "partsPlanned": len(parts), "partsPublished": sum(1 for p in parts if p["status"] == "passed"),
        "partsRate": rate(sum(1 for p in parts if p["status"] == "passed"), len(parts)),
        "publishedPerJob": round(pub / n, 3) if n else None,
        "firstTry": rate(sum(1 for p in parts if p["firstTry"]), len(parts)),
        "naturalRepair": rate(len(repaired), len(failed_r1)),
        "repairTargets": dict(targeted.most_common(12)),
        "analysisRepairs": sum(j["analysisRepairs"] for j in jobs),
        "wallS": {"p50": pct(walls, 0.5), "p90": pct(walls, 0.9), "max": pct(walls, 1.0)},
        "costUSD": round(cost, 4), "costPerJob": round(cost / n, 4) if n else None,
        "costPerPublishedPart": round(cost / pub, 4) if pub else None,
        "failedPartCostUSD": round(failed_part_cost, 4), "reservedUnknownUSD": round(sum(j["reservedUnknownUSD"] for j in jobs), 4),
        "tokens": dict(sum((Counter(j["tokens"]) for j in jobs), Counter())),
        "sam": {"calls": sum(j["sam"]["calls"] for j in jobs), "usd": round(sum(j["sam"]["usd"] for j in jobs), 4),
                "msP50": pct([m for j in jobs for m in j["sam"]["ms"]], 0.5)},
        "outcomePaths": {
            "firstTry": sum(1 for p in parts if p["firstTry"]), "repaired": len(repaired),
            "failed": sum(1 for p in parts if p["status"] != "passed"),
        },
    }


def consistency(jobs):
    by = defaultdict(dict)
    for j in jobs:
        by[j["sourceId"]][j["run"]] = j
    pairs = [(v[1], v[2]) for v in by.values() if 1 in v and 2 in v]
    same_outcome = sum(1 for a, b in pairs if a["outcome"] == b["outcome"])
    same_plan = sum(1 for a, b in pairs if sorted(p["componentId"] for p in a["parts"]) == sorted(p["componentId"] for p in b["parts"]))
    same_pub = sum(1 for a, b in pairs if a["published"] == b["published"])
    return {"pages": len(pairs), "sameOutcome": rate(same_outcome, len(pairs)), "samePlan": rate(same_plan, len(pairs)),
            "samePublishedCount": rate(same_pub, len(pairs))}


def engines(jobs):
    planned, published = Counter(), Counter()
    for j in jobs:
        for p in j["parts"]:
            planned[p["componentId"]] += 1
            if p["status"] == "passed":
                published[p["componentId"]] += 1
    return {k: {"planned": planned[k], "published": published[k]} for k in sorted(planned, key=lambda x: -planned[x])}


# ---------- SVG charts (no dependencies) ----------
FG, MUTED, GRID = "#1c2b33", "#5d6c7b", "#dfe3e8"
COL = {"muse-spark-1.3": "#0064e0", "muse-spark-open": "#00a884"}
FONT = "font-family='Inter, Segoe UI, system-ui, sans-serif'"


def svg_wrap(w, h, body, title):
    return (f"<svg xmlns='http://www.w3.org/2000/svg' width='{w}' height='{h}' viewBox='0 0 {w} {h}' {FONT}>"
            f"<rect width='100%' height='100%' fill='#ffffff'/>"
            f"<text x='24' y='36' font-size='20' font-weight='600' fill='{FG}'>{title}</text>{body}</svg>")


def legend(x, y):
    out = ""
    for i, m in enumerate(MODELS):
        out += (f"<rect x='{x + i * 190}' y='{y - 11}' width='14' height='14' rx='3' fill='{COL[m]}'/>"
                f"<text x='{x + i * 190 + 20}' y='{y + 1}' font-size='14' fill='{MUTED}'>{LABEL[m]}</text>")
    return out


def grouped_rate_chart(path, title, cats, values, cat_label):
    """values[model][cat] = rate dict; horizontal bars with Wilson whiskers, 0..100%."""
    w, left, right, top, row = 960, 190, 60, 80, 46
    h = top + row * len(cats) + 50
    pw = w - left - right
    body = legend(left, 62)
    for t in range(0, 101, 25):
        x = left + pw * t / 100
        body += f"<line x1='{x}' y1='{top - 6}' x2='{x}' y2='{h - 40}' stroke='{GRID}'/><text x='{x}' y='{h - 20}' font-size='12' fill='{MUTED}' text-anchor='middle'>{t}%</text>"
    for i, c in enumerate(cats):
        y0 = top + i * row
        body += f"<text x='{left - 12}' y='{y0 + 24}' font-size='14' fill='{FG}' text-anchor='end'>{cat_label(c)}</text>"
        for k, m in enumerate(MODELS):
            r = values[m].get(c)
            if not r or r["rate"] is None:
                continue
            y = y0 + 6 + k * 17
            body += f"<rect x='{left}' y='{y}' width='{pw * r['rate']:.1f}' height='14' rx='3' fill='{COL[m]}'/>"
            lo, hi = r["ci95"]
            body += f"<line x1='{left + pw * lo:.1f}' y1='{y + 7}' x2='{left + pw * hi:.1f}' y2='{y + 7}' stroke='{FG}' stroke-width='1.5' opacity='0.55'/>"
            body += f"<text x='{left + pw * r['rate'] + 8:.1f}' y='{y + 12}' font-size='12' fill='{MUTED}'>{round(100 * r['rate'])}% ({r['k']}/{r['n']})</text>"
    path.write_text(svg_wrap(w, h, body, title), encoding="utf-8", newline="\n")


def bar_pair_chart(path, title, items, unit):
    """items: list of (label, {model: value}); vertical grouped bars."""
    w, h, left, bottom, top = 960, 420, 70, 70, 90
    vmax = max((v for _, d in items for v in d.values() if v is not None), default=1) * 1.18
    pw, ph = w - left - 30, h - top - bottom
    gw = pw / len(items)
    body = legend(left, 62)
    for t in range(5):
        v = vmax * t / 4
        y = top + ph - ph * t / 4
        body += f"<line x1='{left}' y1='{y}' x2='{w - 30}' y2='{y}' stroke='{GRID}'/><text x='{left - 8}' y='{y + 4}' font-size='12' fill='{MUTED}' text-anchor='end'>{v:.2f}{unit}</text>"
    for i, (lab, d) in enumerate(items):
        x0 = left + i * gw
        for k, m in enumerate(MODELS):
            v = d.get(m)
            if v is None:
                continue
            bh = ph * v / vmax
            x = x0 + gw * 0.18 + k * gw * 0.32
            body += f"<rect x='{x:.1f}' y='{top + ph - bh:.1f}' width='{gw * 0.28:.1f}' height='{bh:.1f}' rx='3' fill='{COL[m]}'/>"
            body += f"<text x='{x + gw * 0.14:.1f}' y='{top + ph - bh - 6:.1f}' font-size='12' fill='{FG}' text-anchor='middle'>{v:.2f}{unit}</text>"
        body += f"<text x='{x0 + gw / 2:.1f}' y='{h - bottom + 24}' font-size='14' fill='{FG}' text-anchor='middle'>{lab}</text>"
    path.write_text(svg_wrap(w, h, body, title), encoding="utf-8", newline="\n")


def stacked_paths_chart(path, title, paths):
    """paths[model] = {firstTry, repaired, failed} parts; one horizontal 100% bar per model."""
    w, left, top, row = 960, 190, 90, 60
    h = top + row * len(MODELS) + 60
    pw = w - left - 60
    cols = {"firstTry": "#0064e0", "repaired": "#f7b928", "failed": "#c7ced6"}
    names = {"firstTry": "Passed first try", "repaired": "Fixed by repair", "failed": "Left out (failed checks)"}
    body = ""
    for i, k in enumerate(cols):
        body += f"<rect x='{left + i * 230}' y='51' width='14' height='14' rx='3' fill='{cols[k]}'/><text x='{left + i * 230 + 20}' y='63' font-size='14' fill='{MUTED}'>{names[k]}</text>"
    for r, m in enumerate(MODELS):
        p = paths[m]
        tot = sum(p.values()) or 1
        y = top + r * row
        body += f"<text x='{left - 12}' y='{y + 24}' font-size='14' fill='{FG}' text-anchor='end'>{LABEL[m]}</text>"
        x = left
        for k in cols:
            ww = pw * p[k] / tot
            body += f"<rect x='{x:.1f}' y='{y + 6}' width='{ww:.1f}' height='28' fill='{cols[k]}'/>"
            if ww > 60:
                body += f"<text x='{x + ww / 2:.1f}' y='{y + 25}' font-size='13' fill='{'#ffffff' if k == 'firstTry' else FG}' text-anchor='middle'>{p[k]} ({round(100 * p[k] / tot)}%)</text>"
            x += ww
    path.write_text(svg_wrap(w, h, body, title), encoding="utf-8", newline="\n")


def engine_chart(path, title, eng):
    keys = sorted({k for m in MODELS for k in eng[m]}, key=lambda k: -sum(eng[m].get(k, {}).get("published", 0) for m in MODELS))
    w, left, top, row = 960, 190, 80, 34
    h = top + row * len(keys) + 50
    vmax = max(eng[m].get(k, {}).get("planned", 0) for m in MODELS for k in keys) or 1
    pw = w - left - 120
    body = legend(left, 62)
    for i, k in enumerate(keys):
        y0 = top + i * row
        body += f"<text x='{left - 12}' y='{y0 + 18}' font-size='13' fill='{FG}' text-anchor='end'>{ENGINE_LABEL.get(k, k)}</text>"
        for j, m in enumerate(MODELS):
            d = eng[m].get(k, {"planned": 0, "published": 0})
            y = y0 + 4 + j * 13
            body += f"<rect x='{left}' y='{y}' width='{pw * d['planned'] / vmax:.1f}' height='11' rx='2' fill='{COL[m]}' opacity='0.25'/>"
            body += f"<rect x='{left}' y='{y}' width='{pw * d['published'] / vmax:.1f}' height='11' rx='2' fill='{COL[m]}'/>"
            body += f"<text x='{left + pw * d['planned'] / vmax + 6:.1f}' y='{y + 10}' font-size='11' fill='{MUTED}'>{d['published']}/{d['planned']}</text>"
    body += f"<text x='{left}' y='{h - 16}' font-size='12' fill='{MUTED}'>Solid: published. Faint: planned.</text>"
    path.write_text(svg_wrap(w, h, body, title), encoding="utf-8", newline="\n")


def main():
    subj = subjects()
    all_jobs = {}
    for m in MODELS:
        f = EV / f"results-{m}.jsonl"
        rows = [json.loads(l) for l in f.read_text(encoding="utf-8").splitlines() if l.strip()] if f.exists() else []
        latest = {}
        for r in rows:
            if r.get("jobId"):
                latest[(r["sourceId"], r["run"])] = r
        all_jobs[m] = [load_job(r, subj) for r in latest.values()]
    summary = {"generatedAt": datetime.now().isoformat(timespec="seconds"), "models": {}}
    for m in MODELS:
        jobs = all_jobs[m]
        by_subject = defaultdict(list)
        for j in jobs:
            by_subject[j["subject"]].append(j)
        summary["models"][m] = {
            "overall": summarise(jobs),
            "bySubject": {s: summarise(v) for s, v in sorted(by_subject.items())},
            "consistency": consistency(jobs),
            "engines": engines(jobs),
        }
    # page-paired comparison: mean published parts per page per model
    pages = sorted({j["sourceId"] for m in MODELS for j in all_jobs[m]})
    mean_pub = {m: {} for m in MODELS}
    for m in MODELS:
        acc = defaultdict(list)
        for j in all_jobs[m]:
            acc[j["sourceId"]].append(j["published"])
        mean_pub[m] = {p: sum(v) / len(v) for p, v in acc.items()}
    both = [p for p in pages if all(p in mean_pub[m] for m in MODELS)]
    summary["paired"] = {
        "pages": len(both),
        "sparkAhead": sum(1 for p in both if mean_pub[MODELS[0]][p] > mean_pub[MODELS[1]][p]),
        "openAhead": sum(1 for p in both if mean_pub[MODELS[1]][p] > mean_pub[MODELS[0]][p]),
        "tied": sum(1 for p in both if mean_pub[MODELS[0]][p] == mean_pub[MODELS[1]][p]),
    }
    (EV / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8", newline="\n")

    with (EV / "jobs.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["model", "sourceId", "subject", "run", "jobId", "status", "outcome", "errorCode", "wallS", "costUSD",
                    "planned", "published", "repairedParts", "analysisRepairs", "components"])
        for m in MODELS:
            for j in sorted(all_jobs[m], key=lambda j: (j["sourceId"], j["run"])):
                w.writerow([m, j["sourceId"], j["subject"], j["run"], j["jobId"], j["status"], j["outcome"], j["errorCode"] or "",
                            round(j["wallS"] or 0, 1), round(j["costUSD"], 6), j["planned"], j["published"],
                            sum(1 for p in j["parts"] if p["repaired"]), j["analysisRepairs"],
                            " ".join(f"{p['componentId']}:{p['status']}@r{p['revision']}" for p in j["parts"])])

    ch = EV / "charts"
    ch.mkdir(exist_ok=True)
    subjects_order = sorted({j["subject"] for m in MODELS for j in all_jobs[m]}, key=lambda s: SUBJECT_LABEL.get(s, s))
    grouped_rate_chart(ch / "lessons-by-subject.svg", "Pages that became a lesson with at least one interactive part",
                       subjects_order + ["__all"],
                       {m: {**{s: summary["models"][m]["bySubject"][s]["lessonWithPart"] for s in summary["models"][m]["bySubject"]},
                            "__all": summary["models"][m]["overall"]["lessonWithPart"]} for m in MODELS},
                       lambda s: "All pages" if s == "__all" else SUBJECT_LABEL.get(s, s))
    grouped_rate_chart(ch / "parts-by-subject.svg", "Planned interactive parts that passed every check and published",
                       subjects_order + ["__all"],
                       {m: {**{s: summary["models"][m]["bySubject"][s]["partsRate"] for s in summary["models"][m]["bySubject"]},
                            "__all": summary["models"][m]["overall"]["partsRate"]} for m in MODELS},
                       lambda s: "All parts" if s == "__all" else SUBJECT_LABEL.get(s, s))
    stacked_paths_chart(ch / "part-outcomes.svg", "What happened to every planned part",
                        {m: summary["models"][m]["overall"]["outcomePaths"] for m in MODELS})
    o = {m: summary["models"][m]["overall"] for m in MODELS}
    bar_pair_chart(ch / "time.svg", "Time to a finished lesson (seconds)",
                   [("Median", {m: o[m]["wallS"]["p50"] for m in MODELS}), ("90th percentile", {m: o[m]["wallS"]["p90"] for m in MODELS})], "s")
    bar_pair_chart(ch / "cost.svg", "Cost (USD)",
                   [("Per lesson", {m: o[m]["costPerJob"] for m in MODELS}), ("Per published part", {m: o[m]["costPerPublishedPart"] for m in MODELS})], "")
    engine_chart(ch / "engines.svg", "Which interactive parts Muse chose, and how many published", {m: summary["models"][m]["engines"] for m in MODELS})

    # REPORT.md
    L = ["# Final evaluation: results", "",
         "Pre-registration: `PREREGISTRATION.md`. Raw data: `results-*.jsonl`, `jobs.csv`, `summary.json`. Charts: `charts/`.",
         "Rates show the Wilson 95% interval in brackets.", ""]

    def r(x):
        return "n/a" if x["rate"] is None else f"{round(100 * x['rate'])}% ({x['k']}/{x['n']}) [{round(100 * x['ci95'][0])}–{round(100 * x['ci95'][1])}%]"

    L += ["## Overall", "", "| Measure | " + " | ".join(LABEL[m] for m in MODELS) + " |", "|---|" + "---|" * len(MODELS)]
    rows = [
        ("Jobs", lambda s: str(s["jobs"])),
        ("Lesson with at least one interactive part", lambda s: r(s["lessonWithPart"])),
        ("Same, among pages not declined", lambda s: r(s["lessonWithPartOfUsable"])),
        ("Honest declines", lambda s: r(s["declined"])),
        ("Failures (job failed or no part published)", lambda s: r(s["failed"])),
        ("Error codes", lambda s: ", ".join(f"{k} {v}" for k, v in s["errorCodes"].items()) or "none"),
        ("Parts published / planned", lambda s: r(s["partsRate"])),
        ("Published parts per lesson", lambda s: str(s["publishedPerJob"])),
        ("Parts passing first try", lambda s: r(s["firstTry"])),
        ("Natural repair (fixed / failed first try)", lambda s: r(s["naturalRepair"])),
        ("Analysis repairs", lambda s: str(s["analysisRepairs"])),
        ("Time p50 / p90", lambda s: f"{s['wallS']['p50']:.0f} s / {s['wallS']['p90']:.0f} s"),
        ("Cost total", lambda s: f"USD {s['costUSD']:.2f}"),
        ("Cost per lesson / per published part", lambda s: f"USD {s['costPerJob']:.3f} / {s['costPerPublishedPart']:.3f}"),
        ("Estimated spend on parts that failed", lambda s: f"USD {s['failedPartCostUSD']:.2f}"),
        ("SAM 3.1 calls (cost)", lambda s: f"{s['sam']['calls']} (USD {s['sam']['usd']:.4f})"),
    ]
    for name, fn in rows:
        L.append(f"| {name} | " + " | ".join(fn(o[m]) for m in MODELS) + " |")
    L += ["", "## Consistency (run 1 vs run 2, same page and model)", "", "| Measure | " + " | ".join(LABEL[m] for m in MODELS) + " |", "|---|" + "---|" * len(MODELS)]
    for key, name in [("sameOutcome", "Same outcome"), ("samePlan", "Same set of parts planned"), ("samePublishedCount", "Same number of parts published")]:
        L.append(f"| {name} | " + " | ".join(r(summary["models"][m]["consistency"][key]) for m in MODELS) + " |")
    L += ["", "## By subject", "", "| Subject | " + " | ".join(f"{LABEL[m]}: lessons / parts" for m in MODELS) + " |", "|---|" + "---|" * len(MODELS)]
    for s in subjects_order:
        L.append(f"| {SUBJECT_LABEL.get(s, s)} | " + " | ".join(
            f"{r(summary['models'][m]['bySubject'][s]['lessonWithPart'])} / {r(summary['models'][m]['bySubject'][s]['partsRate'])}" if s in summary["models"][m]["bySubject"] else "n/a"
            for m in MODELS) + " |")
    L += ["", "## Interactive parts chosen (published / planned)", "", "| Part | " + " | ".join(LABEL[m] for m in MODELS) + " |", "|---|" + "---|" * len(MODELS)]
    keys = sorted({k for m in MODELS for k in summary["models"][m]["engines"]}, key=lambda k: -sum(summary["models"][m]["engines"].get(k, {}).get("planned", 0) for m in MODELS))
    for k in keys:
        L.append(f"| {ENGINE_LABEL.get(k, k)} | " + " | ".join(
            f"{summary['models'][m]['engines'].get(k, {}).get('published', 0)}/{summary['models'][m]['engines'].get(k, {}).get('planned', 0)}" for m in MODELS) + " |")
    L += ["", "## Repairs: checks that repairs targeted", ""]
    for m in MODELS:
        L.append(f"- {LABEL[m]}: " + ", ".join(f"{k} {v}" for k, v in o[m]["repairTargets"].items()))
    p = summary["paired"]
    L += ["", "## Page-paired model comparison (mean published parts over 2 runs)", "",
          f"{p['pages']} pages: Muse Spark 1.3 ahead on {p['sparkAhead']}, Spark Open ahead on {p['openAhead']}, tied on {p['tied']}.", ""]
    (EV / "REPORT.md").write_text("\n".join(L) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({m: {k: o[m][k] for k in ("jobs", "lessonWithPart", "partsRate", "naturalRepair", "costUSD")} for m in MODELS}, indent=1))


if __name__ == "__main__":
    main()
