# Stage 8d: Label the diagram on Muse Spark Open (open weights, Modal)

Status: FROZEN by the lead, 2026-11-02 (Calvin: "Start it, this is an amazing implementation").
Evidence: `docs/evidence/open-weights-vision-probe/`. Muse Spark Open on our Modal endpoint accepts images and grounds
diagram parts about as well as Spark 1.3. Only our client refused images on non-Meta providers.

## Changes
1. **Client (done, Muse via bridge):** `packages/meta/client.ts` sends images on both providers. Receipt:
   `docs/evidence/stage-8d/muse-s8d-client.json`.
2. **Worker (`workers/generation/lesson.ts`):** a Spark Open (Modal) job gets the source's figures exactly like a Meta-API
   job. Today `jobFigures` is `[]` unless `jobProvider === 'meta-api'`; the rule is now the same for both providers. So:
   - the analysis is told about figures and may plan `label-diagram-v1`;
   - the generation, repair and grounding calls send the figure image through the job's own client, i.e. Spark Open
     on Modal;
   - SAM 3.1 still runs on the Meta API key and the job's ledger, with provider `meta-api` for its spend; the Modal
     spend stays under the Modal cap.
   - Nothing else changes: checks, placement, the agreement check, and best-of retry.
3. **Event wording:** the grounding text names the model that actually located the parts:
   `muse-spark-1.3 located K of N part(s) for SAM` or `muse-spark-open located K of N part(s) for SAM` (from the job's
   model). The failure text also uses the job's model: `<model> grounding failed (<CODE>); used the generation areas`.
4. **Web (`apps/web/src/lib/liveBuild.ts` and the figure frame):** parse either model id. The line reads
   "Muse Spark Open located N parts · SAM 3.1 confirmed K of N" for open-weights runs, and keeps "Muse Spark located …"
   for 1.3. Wherever the lesson credits models (hook slide credit, run details), an open-weights diagram lesson says the
   parts were located by Muse Spark Open (open weights, Modal) and the regions came from SAM 3.1 (Meta API). It never
   implies a single provider.
5. **Tests:** the existing test "a Spark Open (Modal) job never sees figures or images" is replaced by "a Spark Open
   (Modal) job gets the figure; its generation and grounding calls carry the image through the Modal client; SAM spend
   is meta-api". Add a test for the event wording per model and for the web parse and line for both models.

Out of scope: the planner prompt (unchanged; the analysis already plans diagrams when figures are listed), and pricing.
