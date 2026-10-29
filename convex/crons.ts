import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.hourly("prune expired MCP credentials", { minuteUTC: 37 }, internal.mcpStore.pruneExpired);
export default crons;
