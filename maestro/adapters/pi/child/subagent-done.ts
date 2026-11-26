/** Legacy terminal entry retained for existing launch artifacts and session policies. */
// weihung fork: first, so a reload into another maestro build loads it fresh.
import "../../../../pi-extension/subagents/engine-build.ts";
export * from "@nubl/maestro/adapters/pi/child/protocol";
export { default } from "../../../../pi-extension/subagents/child.ts";
