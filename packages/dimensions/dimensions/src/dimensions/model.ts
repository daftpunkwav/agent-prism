/**
 * @file dimensions/model
 * @description Static fallback options for the model dimension.
 *
 * Responsibilities:
 * - Export fallback model options
 *
 * Overridden at runtime by the provider config sync.
 */

import { DEFAULT_MODEL_ID } from "@agentprism/contracts";
import { currentEndpointLabel, type DimensionOptionTriple } from "../fields.js";

export const MODEL_OPTIONS: DimensionOptionTriple[] = [
  { field: "endpoint_id", value: "default", label: currentEndpointLabel(DEFAULT_MODEL_ID) },
];
