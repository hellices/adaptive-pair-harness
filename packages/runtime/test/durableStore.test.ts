import { describeDurableStoreConformance } from "./durableStoreConformance.js";
import { referenceDurableStoreHarness } from "./durableStoreReferenceFake.js";

describeDurableStoreConformance("reference fake", referenceDurableStoreHarness);
