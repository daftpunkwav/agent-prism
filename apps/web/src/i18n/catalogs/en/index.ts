/**
 * @file catalogs/en/index
 * @description Merges the en namespaces into the English catalog.
 *
 * Responsibilities:
 * - Assemble all en namespace files into one catalog object
 *
 * The MessageCatalog annotation makes any missing/extra key relative to
 * zh-CN a compile error.
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
import type { MessageCatalog } from "../types";

export const en: MessageCatalog = {
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
