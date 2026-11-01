# Stage 8d live runs: Label the diagram on Muse Spark Open (Modal)

| Run | Job | Label the diagram | Notes |
|---|---|---|---|
| DNA, round 1 | `job-20261101211438-e741b91a` | **Published on the first try, 12/12** | Spark Open located all 6 parts; SAM was 0.78-0.92 sure; 6 numbers placed |
| Water cycle, round 1 | `job-20261101211438-87fa1e93` | Held back | The SAM best-of retry kept a 0.74 runoff variant that covered the whole landscape; LD-06 (agreement) caught it. Fixed in `173310b`: a retry variant that disagrees with where Muse located the part can never win |
| Water cycle, round 2 | `job-20261101212123-3e4734fe` | **Published on the first try, 12/12** | SAM 0.61-0.88 on all 5 parts; the build line reads "Muse Spark Open located 5 parts · SAM 3.1 confirmed 5 of 5 in 2.3 s" |

Generation, grounding and repair all ran on Muse Spark Open (open weights, Modal shared endpoint). SAM 3.1 ran on the Meta
API. Cost (job totals): $0.140 + $0.192 + $0.137 (Modal plus about $0.0025 SAM each).
`open-water-glow-1920.jpg`: the build glow at 1920 (the clouds, the rain, both arrow groups, the runoff).
