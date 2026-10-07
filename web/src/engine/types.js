// Shapes shared by the engine and the views. Documentation only - nothing to import.
//
// The engine runs in the browser, is deterministic for a given seed, and is driven through
// the Twin facade in twin.js; it never touches the DOM, Math.random or Date. It is a port
// of MetaAgri's Python hub (git history, commit a6c825d: hub/hub/*.py and hub/tests/), with
// the same rules and numbers; only the names are camelCase.
//
// Levels of the twin and where their data comes from:
//   Earth / Germany / Oderbruch -> Snapshot.farms (+ fields' polygons for our farm)
//   Farm (own)                  -> Snapshot.fields / weatherToday / forecast / resources /
//                                  pendingBundle, twin.log(), twin.notices()
//   Farm (neighbour)            -> Snapshot.farms[i], twin.farmHistory(), twin.farmReports()
//   Field (own farm only)       -> Snapshot.fields[f], twin.fieldHistory(), twin.fieldPlans()
//
// One tick = one day. The season starts Monday 6 July 2026 (tick 0). A plan made at tick t is
// the plan FOR that day (planFor = "Mon 6 Jul"). The tick counter is never shown to a human.

/**
 * @typedef {"North"|"West"|"River"} Field
 *
 * @typedef {Object} Weather
 * @property {string} date               "Tue 7 Jul"
 * @property {number} tempMaxC
 * @property {number} rainMm
 * @property {number} windMs
 * @property {number} et0Mm              reference evapotranspiration, mm/day
 * @property {number} humidityPct
 * @property {boolean} hail
 * @property {string} note               "" | "heatwave" | "hail storm"
 *
 * @typedef {Object} FieldSnapshot
 * @property {Field} id                  "North"
 * @property {string} routeId            "north" (places.js FIELD_IDS)
 * @property {string} name               "North field"
 * @property {string} crop               "winter wheat" | "rapeseed" | "potatoes"
 * @property {string} emoji              🌾 | 🌼 | 🥔
 * @property {number} areaHa
 * @property {string} stage              "grain fill" | "ripening" | "harvest-ready" | "harvested" |
 *                                       "cover crop" | "tuber bulking" | "maturing"
 * @property {number} daysToHarvest
 * @property {boolean} harvestReady      ripe and still standing
 * @property {boolean} harvested
 * @property {boolean} coverCrop
 * @property {number} soilMoisturePct    % of plant-available water (100 mm PAW: 1 mm = 1 %)
 * @property {number} stressThresholdPct the crop suffers below this
 * @property {boolean} irrigable
 * @property {number} cropHealth         0..1
 * @property {number} diseasePressure    0..1
 * @property {number} yieldEstimateT     tonnes the whole field would give today
 * @property {number} harvestWaitingDays days ripe and still waiting
 * @property {string|null} lastIrrigatedDate
 * @property {string|null} lastSprayedDate
 * @property {string[]} recentRejections the farm manager's last reasons (max 5)
 * @property {number[][]} polygon        closed ring of [lon, lat] (places.js FIELD_POLYGONS)
 *
 * @typedef {Object} Resources           today's availability on our farm
 * @property {number} waterPermitM3      today's abstraction permit (cut in a heatwave)
 * @property {number} waterPermitNormalM3
 * @property {number} workers
 * @property {number} combine            0 once our combine harvested today
 * @property {number} sprayer
 * @property {number} storageCapacityT
 * @property {number} storageUsedT
 * @property {number} storageFreeT
 *
 * @typedef {Object} FarmSummary         one row per farm, our own first
 * @property {string} id                 places.js id
 * @property {string} name
 * @property {boolean} isOwn
 * @property {number} lat
 * @property {number} lon
 * @property {string} crops
 * @property {number} areaHa
 * @property {number} storageCapacityT
 * @property {number} storageFreeT
 * @property {number} combineAvailable   0 | 1
 * @property {number} avgSoilMoisturePct
 * @property {"ok"|"warn"|"crit"} status crit: soil < 35 % or silo > 95 % full; warn: < 45 % or > 85 %
 *
 * @typedef {Object} Capacity            a farm agent's answer to the Machinery ring
 * @property {string} farm
 * @property {{combine: number, storageT: number}} canShare
 * @property {string} validUntil         "Wed 8 Jul"
 * @property {number} confidence         0..1
 * @property {string} note
 *
 * @typedef {Object} Action
 * @property {"irrigate"|"spray"|"fertilize"|"harvest"|"scout"|"defer_task"|"sow_cover_crop"|"borrow_combine"|"deliver_to"} type
 * @property {number} [mm]               irrigate depth
 * @property {string} [product]          spray: fungicide | insecticide | herbicide
 * @property {number} [kgNHa]            fertilize
 * @property {number} [tonnes]           deliver_to
 * @property {string} [farm]             borrow_combine / deliver_to: the neighbour's name
 * @property {number} [confidence]
 * @property {string} [reason]
 * @property {number} [movedT]           deliver_to, set on approval: tonnes that really moved
 *
 * @typedef {Object} Proposal
 * @property {Field} field
 * @property {Action[]} actions
 * @property {string} rationale
 * @property {number} confidence
 * @property {string[]} risks
 *
 * @typedef {Object} SafetyEntry
 * @property {Field} field
 * @property {Action} action
 * @property {boolean} blocked
 * @property {string|null} rule          the plain-language rule text when blocked
 *
 * @typedef {Object} PlanRow             one row of the plan table per allowed action
 * @property {Field} field
 * @property {string} crop
 * @property {string} actionType
 * @property {string} what               "Irrigate 25 mm" · "Harvest ~324 t" · "Deliver 109 t to Gut Rohrdommelsee" ...
 * @property {string} resources          "6,000 m³ water · 1 worker" · "combine · 2 workers" · "—"
 * @property {number} confidence
 * @property {string} reason
 *
 * @typedef {Object} ResourceLine        {waterM3, workers, combine, sprayer, storageFreeT}
 *
 * @typedef {Object} Bundle              a plan for one day
 * @property {number} id
 * @property {number} tick
 * @property {string} planFor            "Tue 7 Jul"
 * @property {string} summary            "Tue 7 Jul: 3 proposals, 3/3 actions cleared by the safety check"
 * @property {Proposal[]} proposals      allowed actions only (Machinery-ring proposals included)
 * @property {SafetyEntry[]} safety      every action checked, allowed or blocked
 * @property {PlanRow[]} planRows
 * @property {number|null} overallConfidence  min over rows; amber "review carefully" below 0.5
 * @property {Capacity[]} nearbyCapacity
 * @property {ResourceLine} resourcesBefore   available today
 * @property {ResourceLine} resourcesAfter    remaining if approved
 * @property {"pending"|"approved"|"rejected"|"expired"} status
 * @property {string|null} reason        rejection reason
 *
 * @typedef {Object} LogEntry            Team conversation
 * @property {number} tick
 * @property {string} date
 * @property {string} actor              "Farm" | "North field agent" | "Coordinator" | "Safety check" |
 *                                       "Machinery ring" | "Farm manager" | a farm name
 * @property {string} text
 * @property {"info"|"warn"|"block"|"decision"} level
 *
 * @typedef {Object} Notice              what buyers & neighbours see (approved plans only)
 * @property {number} tick
 * @property {string} date
 * @property {string} audience           "Buyers" | "Neighbours" | "Beekeepers & neighbours" | a farm name
 * @property {string} text
 *
 * @typedef {Object} RecentAction        today's approved work, for the hero animations
 * @property {Field} field
 * @property {"harvest"|"irrigate"|"spray"|"deliver"} kind
 * @property {string} [farm]
 *
 * @typedef {Object} Snapshot            twin.snapshot()
 * @property {number} tick
 * @property {string} date               "Mon 6 Jul"
 * @property {string} longDate           "Monday 6 July"
 * @property {number} seed
 * @property {string} farm               our farm's name
 * @property {{North: FieldSnapshot, West: FieldSnapshot, River: FieldSnapshot}} fields
 * @property {Weather} weatherToday
 * @property {Weather[]} forecast        the next 3 days; forecast[0] is tomorrow
 * @property {Resources} resources
 * @property {string[]} scenarios        active scenario messages, e.g. "heatwave: water permit cut to 3,600 m³/day"
 * @property {number} heatwaveDaysRemaining
 * @property {string|null} hailDate      "Thu 9 Jul" while a hail warning is active
 * @property {FarmSummary[]} farms       our own first
 * @property {Object<string, Capacity>} nearbyCapacity  today's answers by farm name
 * @property {RecentAction[]} recentActions
 * @property {Field[]} recentProposals   fields whose agent proposed in the latest plan
 * @property {Bundle|null} pendingBundle
 * @property {number} bundleCount
 *
 * @typedef {Object} FieldHistory        twin.fieldHistory(field)
 * @property {{tick: number, date: string, soilMoisturePct: number, cropHealth: number, rainMm: number,
 *             irrigationMm: number, yieldEstimateT: number}[]} history
 * @property {{tick: number, date: string, projectedMoisturePct: number}[]} projection  next 3 days, no irrigation
 * @property {number} stressThresholdPct
 *
 * @typedef {Object} FarmHistoryRow      twin.farmHistory(farmName)[i]
 * @property {number} tick
 * @property {string} date
 * @property {number} storageFreeT
 * @property {number} avgSoilMoisturePct
 * @property {number} combineAvailable
 *
 * @typedef {Object} FarmReport          twin.farmReports(farmName)[i], newest first
 * @property {string} planFor
 * @property {{combine: number, storageT: number}} canShare
 * @property {number} confidence
 * @property {string} note
 *
 * @typedef {Object} PlanSummary         twin.fieldPlans(field)[i], newest first
 * @property {number} bundleId
 * @property {string} planFor
 * @property {Bundle["status"]} status
 * @property {number} confidence
 */

// Twin API (twin.js), all return JSON-safe copies:
//   new Twin({ seed = DEFAULT_SEED, firstPlan = true })   firstPlan: open with the plan for Mon 6 Jul
//   subscribe(fn) -> unsubscribe
//   tick() -> Bundle                 advance one day (an undecided plan expires) and make its plan
//   heatwave() -> { scenario }       cuts today's permit at once; no-op message if already on
//   hail() -> { scenario }           hail in 2 days; no-op if already warned
//   decide(id, "approve"|"reject", reason?) -> Bundle
//       throws Error(message) for an unknown or already-decided plan, and on approve when the plan
//       no longer passes the safety check (e.g. a heatwave cut the permit since it was built):
//       "This plan no longer passes the safety check: irrigate for River field: Irrigation must stay
//        within today's water permit. Reject it so the field agents re-plan."
//   reset({ seed }?)                 restart the season (same seed unless given)
//   snapshot() -> Snapshot
//   census(field), farmCensus(farmName)            what an agent sees (for the curious)
//   fieldHistory(field) -> FieldHistory, fieldPlans(field, limit = 3) -> PlanSummary[]
//   farmHistory(farmName) -> FarmHistoryRow[], farmReports(farmName, limit = 3) -> FarmReport[]
//   inbox() -> Bundle[], bundles() -> Bundle[] newest first, log() -> LogEntry[] newest first,
//   notices() -> Notice[] newest first

export {};
