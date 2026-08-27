import type { Registry, RegistryId } from "../types.js";
import { cargoRegistry } from "./cargo.js";
import { npmRegistry } from "./npm.js";
import { pubRegistry } from "./pub.js";

export const REGISTRIES: Record<RegistryId, Registry> = {
  npm: npmRegistry,
  pub: pubRegistry,
  cargo: cargoRegistry,
};

export { cargoRegistry, npmRegistry, pubRegistry };
