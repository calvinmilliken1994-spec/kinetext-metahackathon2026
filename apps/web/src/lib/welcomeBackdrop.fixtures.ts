// Welcome backdrop test fixture: the published label diagram of the pinned demo run job-20261101234914-97ba271b
// (NOAA water cycle, Muse Spark 1.3, revision 2) exactly as GET /api/jobs/:id served it on 2 Nov 2026, with the traced
// SAM outlines left out (the Welcome draws boxes only), and the page's stored text (GET /api/sources/:id, public domain,
// NOAA National Weather Service, JetStream). Real model output and real page text, copied unchanged.
import type { LabelDiagramSpec } from '../../../../packages/contracts/kit.ts';

export const WELCOME_FIXTURE_JOB = 'job-20261101234914-97ba271b';

export const WELCOME_FIXTURE_SPEC = {
  "schemaVersion": "0.6.0",
  "id": "job-20261101234914-97ba271b:label-diagram-v1:r2",
  "componentId": "label-diagram-v1",
  "title": "Label the water cycle processes",
  "sources": [
    {
      "id": "noaa-jetstream-hydrologic-cycle",
      "title": "The Hydrologic Cycle — NOAA National Weather Service, JetStream",
      "locator": "https://www.noaa.gov/jetstream/atmosphere/hydro",
      "license": "US-Gov-Work",
      "attribution": "Source material: NOAA National Weather Service, JetStream, 'The Hydrologic Cycle'. Credit: NOAA National Weather Service. NOAA's Education and Outreach FAQ states 'Nearly all of NOAA content, including images, videos, data products, educational materials, and more, is in the public domain and can be used without express permission', requires credit to NOAA and the NOAA program, and requires that any edits, including those made with a generative AI program, be made clear; the AI-generated lesson carrying this material is labelled as AI-generated in the product. NOAA has not reviewed, approved or endorsed this activity.",
      "sha256": "03cf335151841e953503b179c2b883ccfb8a9e47f4c740dcfa8c65ef05ff1e03"
    }
  ],
  "execution": {
    "maxWallTimeMs": 2000,
    "maxRepairAttempts": 2,
    "network": false,
    "generatedCodeAllowed": false
  },
  "provenance": {
    "provider": "meta",
    "requestedModel": "muse-spark-1.3",
    "returnedModel": "muse-spark-1.3",
    "responseId": "chatcmpl-01a19986-0253-7103-84f7-355663d6f72b",
    "runId": "job-20261101234914-97ba271b",
    "promptVersion": "s6-v10",
    "revision": 2,
    "repairOf": 1,
    "generatedAt": "2026-11-01T23:51:18.980Z"
  },
  "seed": 3502224648,
  "figureId": "noaa-hydrologic-cycle-1",
  "parts": [
    {
      "areaX1": 240,
      "areaX2": 348,
      "areaY1": 602,
      "areaY2": 829,
      "id": "evaporation",
      "labelX1": 193,
      "labelX2": 392,
      "labelY1": 563,
      "labelY2": 592,
      "name": "Evaporation",
      "quote": "Evaporation is the change of state in a substance from a liquid to a gas.",
      "sourceId": "noaa-jetstream-hydrologic-cycle",
      "x": 293,
      "y": 731
    },
    {
      "areaX1": 58,
      "areaX2": 170,
      "areaY1": 441,
      "areaY2": 652,
      "id": "transpiration",
      "labelX1": 11,
      "labelX2": 231,
      "labelY1": 340,
      "labelY2": 367,
      "name": "Transpiration",
      "quote": "Transpiration is the evaporation of water from plants through stomata.",
      "sourceId": "noaa-jetstream-hydrologic-cycle",
      "x": 113,
      "y": 537
    },
    {
      "areaX1": 390,
      "areaX2": 570,
      "areaY1": 198,
      "areaY2": 350,
      "id": "condensation",
      "labelX1": 343,
      "labelX2": 620,
      "labelY1": 99,
      "labelY2": 129,
      "name": "Condensation",
      "quote": "Condensation is the process whereby water vapor is changed into a liquid state.",
      "sourceId": "noaa-jetstream-hydrologic-cycle",
      "x": 523,
      "y": 210
    },
    {
      "areaX1": 700,
      "areaX2": 915,
      "areaY1": 340,
      "areaY2": 445,
      "id": "precipitation",
      "labelX1": 698,
      "labelX2": 913,
      "labelY1": 290,
      "labelY2": 318,
      "name": "Precipitation",
      "quote": "Precipitation can be in the form of rain, hail, snow, or sleet.",
      "sourceId": "noaa-jetstream-hydrologic-cycle",
      "x": 793,
      "y": 360
    },
    {
      "areaX1": 510,
      "areaX2": 567,
      "areaY1": 660,
      "areaY2": 730,
      "id": "runoff",
      "labelX1": 740,
      "labelX2": 861,
      "labelY1": 711,
      "labelY2": 739,
      "name": "Runoff",
      "quote": "Runoff occurs when there is excessive precipitation and the ground is saturated (cannot absorb any more water).",
      "sourceId": "noaa-jetstream-hydrologic-cycle",
      "x": 543,
      "y": 707
    }
  ],
  "hint": "Find evaporation, transpiration, condensation, precipitation and runoff in the diagram.",
  "figure": {
    "id": "noaa-hydrologic-cycle-1",
    "width": 572,
    "height": 504,
    "caption": "The basic hydrologic (water) cycle",
    "credit": "",
    "license": "U.S. Government work (NOAA National Weather Service, JetStream), public domain; credit NOAA; AI edits must be disclosed",
    "labelsInImage": true,
    "labelBoxes": [
      {
        "x1": 194,
        "y1": 54,
        "x2": 327,
        "y2": 73,
        "text": "Condensation",
        "group": 1
      },
      {
        "x1": 397,
        "y1": 159,
        "x2": 522,
        "y2": 181,
        "text": "Precipitation",
        "group": 2
      },
      {
        "x1": 3,
        "y1": 190,
        "x2": 133,
        "y2": 211,
        "text": "Transpiration",
        "group": 3
      },
      {
        "x1": 118,
        "y1": 194,
        "x2": 132,
        "y2": 208,
        "group": 3
      },
      {
        "x1": 267,
        "y1": 243,
        "x2": 432,
        "y2": 262,
        "text": "Snowmelt Runoff",
        "group": 4
      },
      {
        "x1": 109,
        "y1": 285,
        "x2": 227,
        "y2": 307,
        "text": "Evaporation",
        "group": 5
      },
      {
        "x1": 351,
        "y1": 340,
        "x2": 495,
        "y2": 360,
        "text": "Surface Runoff",
        "group": 6
      },
      {
        "x1": 351,
        "y1": 341,
        "x2": 379,
        "y2": 359,
        "group": 6
      }
    ],
    "partLabelGroups": [
      1,
      2,
      3,
      5,
      6
    ]
  },
  "regions": [
    {
      "partId": "condensation",
      "x1": 212,
      "y1": 86,
      "x2": 340,
      "y2": 186,
      "confidence": 0.66796875,
      "ground": {
        "x1": 223,
        "y1": 100,
        "x2": 326,
        "y2": 176
      }
    },
    {
      "partId": "precipitation",
      "x1": 394,
      "y1": 162,
      "x2": 524,
      "y2": 227,
      "confidence": 0.65625,
      "ground": {
        "x1": 400,
        "y1": 171,
        "x2": 523,
        "y2": 224
      }
    },
    {
      "partId": "transpiration",
      "x1": 34,
      "y1": 213,
      "x2": 96,
      "y2": 331,
      "confidence": 0.7890625,
      "ground": {
        "x1": 33,
        "y1": 222,
        "x2": 97,
        "y2": 329
      }
    },
    {
      "partId": "evaporation",
      "x1": 136,
      "y1": 310,
      "x2": 197,
      "y2": 426,
      "confidence": 0.76171875,
      "ground": {
        "x1": 137,
        "y1": 303,
        "x2": 199,
        "y2": 418
      }
    },
    {
      "partId": "runoff",
      "x1": 293,
      "y1": 337,
      "x2": 325,
      "y2": 369,
      "confidence": 0.59375,
      "ground": {
        "x1": 292,
        "y1": 333,
        "x2": 324,
        "y2": 368
      }
    }
  ]
} as unknown as LabelDiagramSpec;

export const WELCOME_FIXTURE_TEXT = "# The Hydrologic Cycle\n\nThe basic hydrologic (water) cycle\n\nThe hydrologic cycle involves the continuous circulation of water in the Earth-Atmosphere system. At its core, the water cycle is the motion of the water from the ground to the atmosphere and back again. Of the many processes involved in the hydrologic cycle, the most important are:\n\n• evaporation\n\n• transpiration\n\n• condensation\n\n• precipitation\n\n• runoff\n\nEvaporation\n\nEvaporation is the change of state in a substance from a liquid to a gas. In meteorology, the substance we are concerned about the most is water.\n\nFor evaporation to take place, energy is required. The energy can come from any source: the sun, the atmosphere, the Earth, or objects on the Earth such as humans.\n\nEveryone has experienced evaporation personally. When the body heats up due to the air temperature or through exercise, the body sweats, secreting water onto the skin. The purpose is to cause the body to use its own heat to evaporate the liquid, thereby removing heat and cooling the body. The same effect can be seen when you step out of a shower or swimming pool. The coolness you feel is the removal of body heat through evaporation of the water on your skin.\n\nTranspiration\n\nTranspiration is the evaporation of water from plants through stomata. Stomata are small openings found on the underside of leaves that are connected to vascular plant tissues. In most plants, transpiration is a passive process largely controlled by the humidity of the atmosphere and the moisture content of the soil. Of the transpired water passing through a plant only 1% is used in the growth process of the plant. The remaining 99% is passed into the atmosphere.\n\nLearning Lesson: Leaf it to Me\n\nCondensation\n\nCondensation is the process whereby water vapor is changed into a liquid state. In the atmosphere, condensation may appear as clouds or dew. This is also the process whereby water appears on the side of an uninsulated cold drink can or bottle.\n\nCondensation is not a matter of one particular temperature but of a difference between two temperatures: the air temperature and the dewpoint temperature. The dew point is the temperature at which dew can form - it is the point at which air becomes saturated and can not hold any more water vapor. Any additional cooling causes water vapor to condense. Foggy conditions often occur when air temperature and dew point are equal.\n\nCondensation is the opposite of evaporation. Since water vapor has a higher energy level than that of liquid water, when condensation occurs, the excess energy in the form of heat energy is released. This release of heat aids in the formation of hurricanes.\n\nLearning Lesson: Sweatin' to the Coldies\n\nPrecipitation\n\nPrecipitation results when tiny condensation particles, through collision and coalescence, grow too large for the rising air to support, and thus fall to the Earth. Precipitation can be in the form of rain, hail, snow, or sleet.\n\nPrecipitation is the primary way we receive fresh water on Earth. On average, the world receives about 38½\" (980 mm) each year over both the oceans and land masses.\n\nLearning Lesson: The Rain Man\n\nRunoff\n\nRunoff occurs when there is excessive precipitation and the ground is saturated (cannot absorb any more water). Rivers and lakes are results of runoff. Some runoff evaporates into the atmosphere, but most water in rivers and lakes returns to the oceans.\n\nIf runoff water flows into a lake only with no outlet for water to flow out, then evaporation is the only means for water to return to the atmosphere. As water evaporates, impurities or salts are left behind. As a result, the lake becomes salty, as in the case of the Great Salt Lake in Utah or Dead Sea in Israel.\n\nEvaporation of this runoff into the atmosphere begins the hydrologic cycle over again. Some of the water percolates into the soil and into the ground water only to be drawn into plants again for transpiration to take place.\n\nLearning Lesson: Water, Water Everywhere\n\nTake it to the MAX! What-a-cycle\n";
