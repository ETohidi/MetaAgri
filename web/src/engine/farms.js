// The farm agents of the Machinery ring: each farm (ours included) answers "what can you
// share today?" from its farm census. The Machinery ring never borrows from our own farm.
// Port of the Python hub's mock_farms.py.

import { dateLabel } from "./clock.js";
import { fixed, pyRound } from "./format.js";

export const STORAGE_HOLDBACK_T = 50; // keep this much of the silo free for yourself
export const VALID_FOR_DAYS = 1;

/** A farm agent's answer (a Capacity). */
export function generate(farmName, state) {
  const census = state.farmCensus(farmName);
  const scenario = census.scenario;

  const combine = census.combineAvailable && census.ripeBacklogHa === 0 ? 1 : 0;
  let storage = Math.max(0, census.storageFreeT - STORAGE_HOLDBACK_T);
  // A weather warning over the whole region: hold back harder.
  storage = scenario ? Math.floor(storage / 2) : pyRound(storage, 1);

  let machine;
  if (combine) machine = "combine free";
  else if (census.combineAvailable) machine = `combine needed for our own ${fixed(census.ripeBacklogHa, 0)} ha of ripe crop`;
  else machine = "combine busy";
  let note = `${machine}, ${fixed(census.storageFreeT, 0)} t silo space`;
  if (scenario) note += "; keeping a reserve while the weather warning lasts";

  return {
    farm: farmName,
    canShare: { combine, storageT: storage },
    validUntil: dateLabel(state.tick + VALID_FOR_DAYS),
    confidence: scenario ? 0.5 : 0.85,
    note,
  };
}
