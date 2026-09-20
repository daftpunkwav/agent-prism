/**
 * @file driver-crewai package barrel
 * @description Public exports for the CrewAI-pattern driver package.
 *
 * Responsibilities:
 * - Re-export the driver and the crew primitives
 */

export { CrewAIDriver, taskTurnCapFor } from "./crewai-driver.js";
export {
  CREW_COMPLETE_KEYWORD,
  CREW_ROLES,
  MANAGER_INSTRUCTION,
  SEQUENTIAL_TASKS,
  crewProcess,
  parseManagerAssignment,
  roleByKey,
  roleInstruction,
  type CrewProcess,
  type CrewRole,
  type CrewTask,
  type ManagerAssignment,
} from "./crew.js";
