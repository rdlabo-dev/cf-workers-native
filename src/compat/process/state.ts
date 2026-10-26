/// <reference path="./base.d.ts" />
import original from "cf-workers-native:process-base";
// A dependency leaf keeps process.env available during events/util cycles.
const process = { ...original };
export default process;
