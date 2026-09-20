/**
 * @file catalogs/zh-CN/index
 * @description Merges the zh-CN namespaces into the single source of truth.
 *
 * Responsibilities:
 * - Assemble all zh-CN namespace files into one catalog object
 *
 * Its inferred shape defines MessageCatalog, so key drift between locales
 * fails compilation.
 */

import { arena } from "./arena";
import { builder } from "./builder";
import { common } from "./common";
import { dimensions } from "./dimensions";
import { errors } from "./errors";
import { guide } from "./guide";
import { learn } from "./learn";
import { meta } from "./meta";
import { projects } from "./projects";
import { sessions } from "./sessions";
import { settings } from "./settings";
import { shell } from "./shell";

export const zhCN = {
  common,
  builder,
  shell,
  meta,
  errors,
  arena,
  dimensions,
  settings,
  projects,
  sessions,
  guide,
  learn,
};
