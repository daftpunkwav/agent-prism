/**
 * @file task-templates
 * @description Preset task templates with suggested dimensions and judging rules.
 *
 * Responsibilities:
 * - List and fetch preset questions with suggested dimension selections
 * - Carry per-template judging rules
 */

import type { JudgeSpec, TaskTemplate } from "@agentprism/contracts";
import { JudgeSpecSchema } from "@agentprism/contracts";

// The default judging spec derives from the schema, avoiding hand-copied default values drifting from the contract
const NONE_JUDGE: JudgeSpec = JudgeSpecSchema.parse({ type: "none" });

function judge(spec: Partial<JudgeSpec> & { type: JudgeSpec["type"] }): JudgeSpec {
  return { ...NONE_JUDGE, ...spec };
}

/** Preset task templates (scored = auto-judgeable; quick = quick tasks). */
export const TEMPLATES: TaskTemplate[] = [
  {
    id: "json_profile",
    name: "JSON structured output",
    description: "Checks whether the model follows a JSON output constraint (L1 format validation)",
    question:
      "Output a JSON object with three fields: name (string), age (number), and hobbies (string array). Do not output anything else.",
    suggested_dimension: "prompt",
    suggested_selections: ["zero_shot", "structured"],
    judge: judge({ type: "json", required_fields: ["name", "age", "hobbies"] }),
    category: "scored",
  },
  {
    id: "arithmetic_mix",
    name: "Mixed arithmetic",
    description: "Checks multi-step math accuracy (auto-judgeable)",
    question: "Compute (128 + 64) * 2. Reply with the number only.",
    suggested_dimension: "reasoning",
    suggested_selections: ["react", "cot_tool"],
    judge: judge({ type: "numeric", operator: "==", value: 384, tolerance: 0.001 }),
    category: "scored",
  },
  {
    id: "prime_count",
    name: "Primes under 100",
    description: "Multi-step reasoning; auto-judgeable (25 primes ≤ 100)",
    question: "How many prime numbers are there up to 100 (inclusive)? Reply with the number only.",
    suggested_dimension: "reasoning",
    suggested_selections: ["react", "reflexion"],
    judge: judge({ type: "numeric", operator: "==", value: 25, tolerance: 0.001 }),
    category: "scored",
  },
  {
    id: "fibonacci_code",
    name: "Fibonacci function",
    description: "Checks code generation via substring and length checks (must_contain + min length), no syntax parsing",
    question:
      "Write a Python function fib(n) that returns the nth Fibonacci number (0-based, fib(0)=0). Output code only.",
    suggested_dimension: "framework",
    suggested_selections: ["langchain", "langgraph"],
    judge: judge({ type: "code", must_contain: ["def fib"], max_len: 6000 }),
    category: "scored",
  },
  {
    id: "builtin_types",
    name: "Python built-in data structures",
    description: "Knowledge retrieval: pass if at least 3 built-in structure names appear",
    question: "List 3 of Python's built-in data structures (e.g. list, dict).",
    suggested_dimension: "prompt",
    suggested_selections: ["zero_shot", "few_shot"],
    judge: judge({
      type: "keyword",
      any_of: ["list", "dict", "set", "tuple", "str", "int", "float", "bytes"],
      min_hits: 3,
    }),
    category: "scored",
  },
  {
    id: "no_refusal",
    name: "Refusal detection",
    description: "Robustness: the model should not refuse a simple question with 'cannot answer' style replies",
    question: "Explain recursion in one sentence. Do not reply with 'cannot answer' or similar.",
    suggested_dimension: "harness",
    suggested_selections: ["bare", "verify"],
    // Chinese refusal substrings kept via Unicode escapes for Chinese-model answers.
    judge: judge({
      type: "exclude",
      patterns: [
        "\u65e0\u6cd5", // unable / cannot
        "\u4e0d\u80fd\u56de\u7b54", // cannot answer
        "\u62b1\u6b49", // sorry
        "\u4e0d\u6e05\u695a", // unclear
        "sorry",
        "cannot answer",
        "can't answer",
        "unable to answer",
        "I cannot",
        "I can't",
        "unclear",
      ],
    }),
    category: "scored",
  },
  {
    id: "time_until_midnight",
    name: "Minutes until midnight",
    description: "Tool combo: obtain current time and compute minutes until midnight",
    question:
      "Get the current UTC time and compute how many minutes remain until the next midnight. Show the calculation and the result.",
    suggested_dimension: "context",
    suggested_selections: ["sliding", "vector"],
    // Chinese unit "minutes" kept via Unicode escape alongside English forms.
    judge: judge({
      type: "regex",
      pattern: "\\d{1,4}(\\.\\d+)?\\s*(\u5206\u949f|min|minutes?)",
    }),
    category: "scored",
  },
  {
    id: "snake_game",
    name: "Snake game",
    description: "Coding task: implement a runnable Snake game in the workspace (Python or HTML+JS); judged by substring and length checks (must_contain + min length), no syntax parsing",
    question:
      "Build a runnable Snake game in the workspace. " +
      "Include at least: a main game file (e.g. snake.py or index.html) and a short README on how to run it. " +
      "After writing, use the bash tool to verify it starts or runs.",
    suggested_dimension: "reasoning",
    suggested_selections: ["react", "cot_tool", "tot", "reflexion"],
    judge: judge({ type: "code", must_contain: ["snake"], max_len: 12000 }),
    category: "scored",
  },
  {
    id: "string_reverse",
    name: "String reverse",
    description: "Coding task: reverse 'hello' and explain the approach",
    question: "Write Python code that reverses the string 'hello', and explain your approach.",
    suggested_dimension: "framework",
    suggested_selections: ["native", "langchain", "langgraph"],
    judge: judge({ type: "code", must_contain: ["hello"], max_len: 6000 }),
    category: "scored",
  },
  {
    id: "quick_time",
    name: "Time",
    description: "Quick task: query current time",
    question: "What time is it now?",
    suggested_dimension: "framework",
    suggested_selections: [],
    judge: NONE_JUDGE,
    category: "quick",
  },
  {
    id: "quick_calc",
    name: "Calculation",
    description: "Quick task: arithmetic",
    question: "Compute (128 + 64) * 2 / 8 + 15",
    suggested_dimension: "framework",
    suggested_selections: [],
    judge: NONE_JUDGE,
    category: "quick",
  },
  {
    id: "quick_multi_time",
    name: "Multi-step · time",
    description: "Quick task: time tool combo",
    question: "Get the current time and compute minutes until midnight",
    suggested_dimension: "framework",
    suggested_selections: [],
    judge: NONE_JUDGE,
    category: "quick",
  },
  {
    id: "quick_factorial",
    name: "Multi-step · factorial",
    description: "Quick task: code + write file",
    question: "First compute 17! with code, then write the result to result.txt",
    suggested_dimension: "framework",
    suggested_selections: [],
    judge: NONE_JUDGE,
    category: "quick",
  },
  {
    id: "quick_files",
    name: "File read/write",
    description: "Quick task: workspace file operations",
    question: "Create notes.md with three todos for today, then read it and list workspace files",
    suggested_dimension: "framework",
    suggested_selections: [],
    judge: NONE_JUDGE,
    category: "quick",
  },
  {
    id: "quick_code_file",
    name: "Code + file",
    description: "Quick task: write and run code",
    question:
      "Write hello.py that prints Hello Arena, run it with run, and append the output to log.txt",
    suggested_dimension: "framework",
    suggested_selections: [],
    judge: NONE_JUDGE,
    category: "quick",
  },
  {
    id: "quick_primes",
    name: "Prime count",
    description: "Quick task: find primes with code",
    question: "Use code to find all primes from 1 to 100 and count them",
    suggested_dimension: "framework",
    suggested_selections: [],
    judge: NONE_JUDGE,
    category: "quick",
  },
  {
    id: "quick_fibonacci",
    name: "Fibonacci",
    description: "Quick task: generate sequence and write file",
    question: "Use code to generate the first 20 Fibonacci numbers and write them to fib.txt",
    suggested_dimension: "framework",
    suggested_selections: [],
    judge: NONE_JUDGE,
    category: "quick",
  },
  {
    id: "quick_summarize",
    name: "Text summary",
    description: "Quick task: summarization",
    question:
      "Summarize the following text in under 80 words: Agent comparison experiments need to observe " +
      "framework, prompt, reasoning-mode, and context-strategy differences on the same task in parallel " +
      "to quantify latency, tokens, and tool-call counts.",
    suggested_dimension: "framework",
    suggested_selections: [],
    judge: NONE_JUDGE,
    category: "quick",
  },
  {
    id: "quick_pipeline",
    name: "Pipeline",
    description: "Quick task: multi-tool pipeline",
    question:
      "Get the current time → compute minutes left in this hour → write the conclusion to report.md → then summarize that file",
    suggested_dimension: "framework",
    suggested_selections: [],
    judge: NONE_JUDGE,
    category: "quick",
  },
  {
    id: "quick_plan",
    name: "Experiment plan",
    description: "Quick task: planning",
    question:
      "Plan a three-step experiment comparing LangChain vs LangGraph on tool calling; " +
      "for each step state the goal, tools, and success criteria",
    suggested_dimension: "framework",
    suggested_selections: [],
    judge: NONE_JUDGE,
    category: "quick",
  },
  {
    id: "mcp_fs_probe",
    name: "MCP filesystem probe",
    description:
      "Ablation task for the mcp dimension (off vs fs vs full): the workspace always ships a " +
      "task briefing file, so every column can answer, while ablation rows show which columns " +
      "served the read through MCP-bridged tools.",
    question:
      "List the files in your workspace root that you can see. Your answer must contain the " +
      "filename of the task briefing file (the markdown file describing your task).",
    suggested_dimension: "mcp",
    suggested_selections: ["off", "fs", "full"],
    judge: judge({ type: "keyword", all_of: ["README.md"], any_of: [], min_hits: 1 }),
    category: "scored",
  },
  {
    id: "skill_commit_format",
    name: "Commit-message discipline",
    description:
      "Ablation task for the skill dimension (off vs on_demand vs preloaded): the repo commit " +
      "runbook pins type vocabulary and the 50-char subject budget; preloaded columns carry it " +
      "in context while off columns work from the base prompt only.",
    question:
      "Reply with exactly one conventional-commit message for adding user login (shape " +
      "`<type>: <subject>`, subject at most 50 chars). Reply with the message only.",
    suggested_dimension: "skill",
    suggested_selections: ["off", "on_demand", "preloaded"],
    judge: judge({
      type: "regex",
      pattern: "^(feat|fix|docs|refactor|chore|test|perf): .{1,50}$",
    }),
    category: "scored",
  },
  {
    id: "orchestration_two_files",
    name: "Two-file discipline task",
    description:
      "Ablation task for the orchestration dimension (direct vs plan_first vs goal_first): a " +
      "two-artifact chore where plan-first seeds a plan doc and goal-first seeds a tracked " +
      "objective; scored on the DONE marker while artifacts and ablation rows show the discipline.",
    question:
      "Create plan_notes.md with exactly 3 lines, then create goal_notes.md with exactly 2 lines. " +
      "Reply with DONE only when both files exist.",
    suggested_dimension: "orchestration",
    suggested_selections: ["direct", "plan_first", "goal_first"],
    judge: judge({ type: "keyword", all_of: ["DONE"], any_of: [], min_hits: 1 }),
    category: "scored",
  },
  {
    id: "loop_prime_race",
    name: "Loop architecture race",
    description:
      "Ablation task for the framework dimension across loop architectures " +
      "(native vs plan_execute vs self_critique): multi-step reasoning with an exact numeric " +
      "verdict so loop quality differences score.",
    question: "How many prime numbers are there up to 200 (inclusive)? Reply with the number only.",
    suggested_dimension: "framework",
    suggested_selections: ["native", "plan_execute", "self_critique"],
    judge: judge({ type: "numeric", operator: "==", value: 46, tolerance: 0.001 }),
    category: "scored",
  },
  {
    id: "terse_factorial",
    name: "Terse factorial",
    description:
      "Ablation task for the prompt dimension (zero_shot vs terse): exact numeric verdict " +
      "with a noiseless answer shape, so verbosity discipline shows up in token metrics " +
      "rather than in judging.",
    question: "Compute 17 factorial (17!). Reply with the number only.",
    suggested_dimension: "prompt",
    suggested_selections: ["zero_shot", "terse"],
    judge: judge({ type: "numeric", operator: "==", value: 355687428096000, tolerance: 1 }),
    category: "scored",
  },
  {
    id: "context_long_tail",
    name: "Long-log tail",
    description:
      "Ablation task for the context dimension (sliding vs tool_tail vs token_budget): a long " +
      "command log whose verdict sits on the last line, favoring strategies that preserve tails; " +
      "ablation observation_chars show what each strategy actually kept.",
    question: "Run `seq 1 2000 | tail -n 1` with the bash tool and reply with the number only.",
    suggested_dimension: "context",
    suggested_selections: ["sliding", "tool_tail", "token_budget"],
    judge: judge({ type: "numeric", operator: "==", value: 2000, tolerance: 0.001 }),
    category: "scored",
  },
];

const TEMPLATE_MAP = new Map(TEMPLATES.map((template) => [template.id, template]));

/** Returns every judging task template in catalog order (defensive copy). */
export function listTemplates(): TaskTemplate[] {
  return [...TEMPLATES];
}

/** Looks up one judging template by id; undefined when unknown (callers 404). */
export function getTemplate(templateId: string): TaskTemplate | undefined {
  return TEMPLATE_MAP.get(templateId);
}
