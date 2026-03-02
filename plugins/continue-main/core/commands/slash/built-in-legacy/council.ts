import ignore from "ignore";

import type { FileType, IDE } from "../../../index.js";
import { ChatMessage, ILLM, SlashCommand } from "../../../index.js";
import { DEFAULT_IGNORE, gitIgArrayFromFile } from "../../../indexing/ignore.js";
import { getGlobalXynapseIgArray } from "../../../indexing/xynapseignore.js";
import { renderChatMessage } from "../../../util/messageContent.js";
import {
  findUriInDirs,
  getUriPathBasename,
  joinPathsToUri,
} from "../../../util/uri.js";

// ── Types ──────────────────────────────────────────────────────────

interface CouncilAgent {
  name: string;
  systemPrompt: string;
  llm: ILLM;
}

type Difficulty = "easy" | "medium" | "hard";

interface CouncilGuiConfig {
  difficulty: Difficulty;
  roles: Array<{
    name: string;
    modelTitle: string;
  }>;
  saveDiscussion?: boolean;
}

interface HistoryEntry {
  agent: string;
  content: string;
  phase: "analysis" | "critique" | "plan";
  round: number; // 0-based within phase
}

// ── Config ─────────────────────────────────────────────────────────

/** Number of critique rounds per difficulty level */
const DIFFICULTY_CRITIQUE_ROUNDS: Record<Difficulty, number> = {
  easy: 0,
  medium: 1,
  hard: 2,
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

const MAX_EXPLORE_DEPTH = 2;

const LANGUAGE_DEP_MGMT_FILENAMES = [
  "package.json",
  "requirements.txt",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "composer.json",
  "Cargo.toml",
  "go.mod",
  "packages.config",
  "pubspec.yaml",
  "Project.toml",
  "mix.exs",
  "rebar.config",
  "shard.yml",
  "Package.swift",
  "dependencies.gradle",
  "Podfile",
  "dub.json",
];

// ── Role Prompts ───────────────────────────────────────────────────

const ROLE_PROMPTS: Record<string, string> = {
  "Architect": `You are the Architect on the Council team.
Your responsibilities:
- Propose the project architecture: file structure, modules, APIs
- Choose appropriate design patterns
- Consider scalability and extensibility
- Assess technical risks
- Respond to remarks from other participants

Justify your architectural decisions.
Be specific — name files, folder structures, data formats.`,

  "Developer": `You are the Senior Developer on the Council team.
Your responsibilities:
- Propose specific technologies, libraries, and frameworks
- Design algorithms and data structures
- Estimate implementation complexity for each component
- Critically evaluate architectural decisions — point out issues
- Suggest improvements and alternative approaches

Be practical — propose concrete code and solutions.`,

  "Reviewer": `You are the Code Reviewer and QA expert on the Council team.
Your responsibilities:
- Critically evaluate the proposed architecture and solutions
- Find potential bugs, vulnerabilities, and edge cases
- Assess security (SQL injection, XSS, CSRF, etc.)
- Suggest alternative approaches if current ones have problems
- Verify that the solution covers all task requirements

Be strict but constructive.`,

  "Tester": `You are the QA Engineer and Tester on the Council team.
Your responsibilities:
- Design the project testing strategy
- Identify key test cases and scenarios
- Point out edge cases that need test coverage
- Suggest test types: unit, integration, e2e
- Evaluate the testability of the proposed architecture

Be specific — describe test cases in detail.`,
};

const DEFAULT_ROLE_PROMPT = `You are a "{name}" expert on the Council team.
Your responsibilities:
- Evaluate the project from the perspective of your expertise
- Provide specific recommendations and suggestions
- Point out potential issues in your area
- Respond to suggestions from other participants

Be specific and practical.`;

// ── Phase Prompt Suffixes ──────────────────────────────────────────

const PHASE1_SUFFIX = `

Respond STRICTLY in the following format:

## Proposal
Your vision for solving the task. Specific technologies, approaches, structure.

## Risks
What problems and challenges you foresee. What could go wrong.

## Key Decisions
List of architectural/technical decisions that need to be made (2-5 items). For each — your recommendation.`;

const PHASE2_SUFFIX = `

You have received responses from all team members. Your task is to perform a CRITICAL ANALYSIS.

Respond STRICTLY in the following format:

## Agree
Which specific proposals from other participants you agree with and why. Name the participant and their point.

## Disagree
What you do NOT agree with. For each point:
- Whose proposal it is
- What the problem is
- Why it is a bad decision

## Suggest Changes
Your specific alternative proposals to replace what you disagree with.`;

const PLAN_PROMPT = `You are the Lead Architect. Based on the previous discussion, create the FINAL PROJECT PLAN.

You have seen each participant's individual analysis and their cross-critique. Now you must MAKE DECISIONS on all disputed points.

Plan format STRICTLY:

# Project Plan

## Description
Brief project description (2-3 sentences)

## Disputed Decisions
For each point where participants DID NOT agree with each other:
- What the dispute is about
- What decision was made and WHY (referencing participants' arguments)

## File Structure
\`\`\`
project/
├── file1.ext
├── file2.ext
└── dir/
    └── file3.ext
\`\`\`

## File Descriptions
For each file: what it contains, what it is responsible for.

## Implementation Order
Numbered list of steps. Each step must include:
- Which file to create/modify
- What exactly to write (key code fragments)
- Which dependencies to install

## Technologies
List of technologies/libraries used.

Be as specific as possible — each step must be implementable without additional clarification.`;

// ── Input Parsing ──────────────────────────────────────────────────

function parseInput(input: string): {
  difficulty: Difficulty;
  task: string;
  roleOverrides?: CouncilGuiConfig["roles"];
  saveDiscussion: boolean;
} {
  const trimmed = input.trim();

  // Try JSON config from GUI dialog (promptBlockContent + task on next line)
  if (trimmed.startsWith("{")) {
    const newlineIdx = trimmed.indexOf("\n");
    const jsonStr = newlineIdx > 0 ? trimmed.substring(0, newlineIdx) : trimmed;
    const task = newlineIdx > 0 ? trimmed.substring(newlineIdx + 1).trim() : "";

    try {
      const config: CouncilGuiConfig = JSON.parse(jsonStr);
      if (config.difficulty && config.roles) {
        return {
          difficulty: config.difficulty,
          task: task || "plan",
          roleOverrides: config.roles,
          saveDiscussion: config.saveDiscussion !== false,
        };
      }
    } catch {
      // Not valid JSON — fall through
    }
  }

  // Also try full JSON (old format with task inside)
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const config = JSON.parse(trimmed);
      if (config.task && config.difficulty) {
        return {
          difficulty: config.difficulty,
          task: config.task,
          roleOverrides: config.roles,
          saveDiscussion: config.saveDiscussion !== false,
        };
      }
    } catch {
      // fall through
    }
  }

  // Text-based: /council [level] task
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("easy ")) {
    return { difficulty: "easy", task: trimmed.replace(/^easy\s+/i, ""), saveDiscussion: true };
  }
  if (lower.startsWith("hard ")) {
    return { difficulty: "hard", task: trimmed.replace(/^hard\s+/i, ""), saveDiscussion: true };
  }
  return {
    difficulty: "medium",
    task: trimmed.replace(/^medium\s+/i, ""),
    saveDiscussion: true,
  };
}

// ── Model & Agent Helpers ──────────────────────────────────────────

function getAvailableModels(config: any, fallbackLlm: ILLM): ILLM[] {
  const seen = new Set<string>();
  const models: ILLM[] = [];

  const byRole = config?.modelsByRole ?? {};
  for (const role of ["chat", "edit", "apply", "summarize"]) {
    for (const m of byRole[role] ?? []) {
      const key = m.uniqueId ?? m.model ?? m.title;
      if (m && typeof m.streamChat === "function" && !seen.has(key)) {
        seen.add(key);
        models.push(m);
      }
    }
  }

  for (const m of config?.models ?? []) {
    const key = m.uniqueId ?? m.model ?? m.title;
    if (m && typeof m.streamChat === "function" && !seen.has(key)) {
      seen.add(key);
      models.push(m);
    }
  }

  if (models.length === 0 && fallbackLlm) {
    models.push(fallbackLlm);
  }

  return models;
}

function findModelByTitle(models: ILLM[], title: string): ILLM | undefined {
  return models.find((m) => m.title === title || m.model === title);
}

function getPromptForRole(name: string): string {
  return ROLE_PROMPTS[name] ?? DEFAULT_ROLE_PROMPT.replace("{name}", name);
}

function buildAgents(
  models: ILLM[],
  roleOverrides?: CouncilGuiConfig["roles"],
): CouncilAgent[] {
  if (models.length === 0) return [];

  if (roleOverrides && roleOverrides.length > 0) {
    return roleOverrides.map((role) => ({
      name: role.name,
      systemPrompt: getPromptForRole(role.name),
      llm: findModelByTitle(models, role.modelTitle) ?? models[0],
    }));
  }

  // Default: Architect + Developer
  const defaultRoles = ["Architect", "Developer"];
  return defaultRoles.map((name, i) => ({
    name,
    systemPrompt: getPromptForRole(name),
    llm: models[i % models.length],
  }));
}

// ── Project Context Gathering ──────────────────────────────────────

async function getEntriesFilteredByIgnore(dir: string, ide: IDE) {
  const ig = ignore().add(DEFAULT_IGNORE).add(getGlobalXynapseIgArray());
  const entries = await ide.listDir(dir);

  const ignoreUri = joinPathsToUri(dir, ".gitignore");
  const fileExists = await ide.fileExists(ignoreUri);

  if (fileExists) {
    const gitIgnore = await ide.readFile(ignoreUri);
    const igPatterns = gitIgArrayFromFile(gitIgnore);
    ig.add(igPatterns);
  }

  const workspaceDirs = await ide.getWorkspaceDirs();

  const withRelativePaths = entries
    .filter(
      (entry) =>
        entry[1] === (1 as FileType.File) ||
        entry[1] === (2 as FileType.Directory),
    )
    .map((entry) => {
      const { relativePathOrBasename } = findUriInDirs(entry[0], workspaceDirs);
      return {
        uri: entry[0],
        type: entry[1],
        basename: getUriPathBasename(entry[0]),
        relativePath:
          relativePathOrBasename +
          (entry[1] === (2 as FileType.Directory) ? "/" : ""),
      };
    });

  return withRelativePaths.filter((entry) => !ig.ignores(entry.relativePath));
}

async function gatherProjectContext(ide: IDE): Promise<string> {
  const workspaceDirs = await ide.getWorkspaceDirs();
  if (workspaceDirs.length === 0) return "";

  const workspaceDir = workspaceDirs[0];
  let context = "";

  async function exploreDirectory(dir: string, currentDepth: number = 0) {
    if (currentDepth > MAX_EXPLORE_DEPTH) {
      return;
    }

    const entries = await getEntriesFilteredByIgnore(dir, ide);

    for (const entry of entries) {
      if (entry.type === (2 as FileType.Directory)) {
        context += `Folder: ${entry.relativePath}\n`;
        await exploreDirectory(entry.uri, currentDepth + 1);
      } else {
        if (entry.basename.toLowerCase() === "readme.md") {
          try {
            const content = await ide.readFile(entry.uri);
            const truncated = content.length > 2000
              ? content.substring(0, 2000) + "\n... (truncated)"
              : content;
            context += `\nREADME (${entry.relativePath}):\n${truncated}\n\n`;
          } catch {
            // skip unreadable files
          }
        } else if (LANGUAGE_DEP_MGMT_FILENAMES.includes(entry.basename)) {
          try {
            const content = await ide.readFile(entry.uri);
            const truncated = content.length > 3000
              ? content.substring(0, 3000) + "\n... (truncated)"
              : content;
            context += `\n${entry.basename} (${entry.relativePath}):\n${truncated}\n\n`;
          } catch {
            // skip unreadable files
          }
        }
      }
    }
  }

  try {
    await exploreDirectory(workspaceDir);
  } catch {
    // If context gathering fails, continue without it
  }

  return context;
}

// ── Message Builders ───────────────────────────────────────────────

function buildPhase1Messages(
  agent: CouncilAgent,
  task: string,
  projectContext: string,
): ChatMessage[] {
  let systemContent = agent.systemPrompt;
  if (projectContext) {
    systemContent += `\n\n## Project Context\n${projectContext}`;
  }
  systemContent += PHASE1_SUFFIX;

  return [
    { role: "system", content: systemContent },
    { role: "user", content: `Task: ${task}` },
  ];
}

function buildPhase2Messages(
  agent: CouncilAgent,
  task: string,
  projectContext: string,
  previousResponses: HistoryEntry[],
): ChatMessage[] {
  let systemContent = agent.systemPrompt;
  if (projectContext) {
    systemContent += `\n\n## Project Context\n${projectContext}`;
  }
  systemContent += PHASE2_SUFFIX;

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: `Task: ${task}` },
  ];

  // Add each previous response as assistant/user pairs with clear attribution
  for (const entry of previousResponses) {
    messages.push({
      role: "assistant",
      content: `[${entry.agent}] responds:\n${entry.content}`,
    });
    messages.push({
      role: "user",
      content: `That was the response from "${entry.agent}". Continue the analysis.`,
    });
  }

  messages.push({
    role: "user",
    content: `Now respond as ${agent.name}. Perform a critical analysis of ALL responses above.`,
  });

  return messages;
}

function buildPlanMessages(
  task: string,
  projectContext: string,
  fullHistory: HistoryEntry[],
): ChatMessage[] {
  let systemContent = PLAN_PROMPT;
  if (projectContext) {
    systemContent += `\n\n## Project Context\n${projectContext}`;
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: `Task: ${task}` },
  ];

  // Group by phase for clear presentation
  const phase1 = fullHistory.filter((h) => h.phase === "analysis");
  const critiques = fullHistory.filter((h) => h.phase === "critique");

  if (phase1.length > 0) {
    let analysisBlock = "--- Phase 1: Individual Analysis ---\n\n";
    for (const entry of phase1) {
      analysisBlock += `[${entry.agent}]:\n${entry.content}\n\n`;
    }
    messages.push({ role: "assistant", content: analysisBlock });
    messages.push({ role: "user", content: "These were the individual analyses from participants." });
  }

  if (critiques.length > 0) {
    // Group critiques by round
    const maxRound = Math.max(...critiques.map((c) => c.round));
    for (let r = 0; r <= maxRound; r++) {
      const roundEntries = critiques.filter((c) => c.round === r);
      if (roundEntries.length === 0) continue;

      let critiqueBlock = `--- Phase 2: Critique, Round ${r + 1} ---\n\n`;
      for (const entry of roundEntries) {
        critiqueBlock += `[${entry.agent}]:\n${entry.content}\n\n`;
      }
      messages.push({ role: "assistant", content: critiqueBlock });
      messages.push({ role: "user", content: `These were the critiques from round ${r + 1}.` });
    }
  }

  messages.push({
    role: "user",
    content: "Based on the ENTIRE discussion, create the final plan. Be sure to resolve all disputed points in the 'Disputed Decisions' section.",
  });

  return messages;
}

// ── Discussion Formatter ───────────────────────────────────────────

function formatDiscussion(
  history: HistoryEntry[],
  task: string,
  agents: CouncilAgent[],
  difficulty: Difficulty,
): string {
  const lines: string[] = [];
  lines.push("# Council Discussion\n");
  lines.push(`**Task:** ${task}\n`);
  lines.push(`**Level:** ${DIFFICULTY_LABELS[difficulty]}\n`);
  lines.push(`**Participants:** ${agents.map((a) => `${a.name} (${a.llm.title || a.llm.model})`).join(", ")}\n`);

  const critiqueRounds = DIFFICULTY_CRITIQUE_ROUNDS[difficulty];
  const totalCalls = agents.length * (1 + critiqueRounds) + 1;
  lines.push(`**LLM Calls:** ${totalCalls} (${agents.length} analysis${critiqueRounds > 0 ? ` + ${agents.length * critiqueRounds} critique` : ""} + plan)\n`);
  lines.push("---\n");

  // Phase 1
  const phase1 = history.filter((h) => h.phase === "analysis");
  if (phase1.length > 0) {
    lines.push("\n## Phase 1 — Individual Analysis\n");
    for (const msg of phase1) {
      lines.push(`### ${msg.agent}\n`);
      lines.push(msg.content);
      lines.push("\n");
    }
  }

  // Phase 2
  const critiques = history.filter((h) => h.phase === "critique");
  if (critiques.length > 0) {
    const maxRound = Math.max(...critiques.map((c) => c.round));
    for (let r = 0; r <= maxRound; r++) {
      const roundEntries = critiques.filter((c) => c.round === r);
      if (roundEntries.length === 0) continue;

      lines.push(`\n## Phase 2 — Critique, Round ${r + 1}\n`);
      for (const msg of roundEntries) {
        lines.push(`### ${msg.agent}\n`);
        lines.push(msg.content);
        lines.push("\n");
      }
    }
  }

  return lines.join("\n");
}

// ── Main Command ───────────────────────────────────────────────────

const CouncilCommand: SlashCommand = {
  name: "council",
  description: "Council — multi-agent project planning",
  run: async function* ({ ide, llm, input, config, abortController }) {
    if (!input.trim()) {
      yield "Describe a task for Council.\n\n";
      yield "Format: `/council [easy|medium|hard] task`\n\n";
      yield "Or use the Council button in the input toolbar.\n";
      return;
    }

    const { difficulty, task, roleOverrides, saveDiscussion } = parseInput(input);
    const critiqueRounds = DIFFICULTY_CRITIQUE_ROUNDS[difficulty];
    const diffLabel = DIFFICULTY_LABELS[difficulty];

    if (!task.trim()) {
      yield "Describe a task. Example: `/council easy build a calculator`";
      return;
    }

    const models = getAvailableModels(config, llm);
    const agents = buildAgents(models, roleOverrides);

    if (agents.length === 0) {
      yield "No available models. Add a model in config.yaml.";
      return;
    }

    const agentList = agents
      .map((a) => `${a.name} (${a.llm.title || a.llm.model})`)
      .join(", ");

    const totalCalls = agents.length * (1 + critiqueRounds) + 1;

    // Header
    yield `## Council | ${diffLabel}\n\n`;
    yield `**Task:** ${task}\n`;
    yield `**Participants:** ${agentList}\n`;
    yield `**Phases:** analysis${critiqueRounds > 0 ? ` → ${critiqueRounds} critique round(s)` : ""} → plan\n`;
    yield `**LLM Calls:** ${totalCalls}\n\n`;

    const history: HistoryEntry[] = [];
    const abortSignal = abortController.signal;

    // ── Gather Project Context ──
    yield `Gathering project context...\n`;
    let projectContext = "";
    try {
      projectContext = await gatherProjectContext(ide);
    } catch {
      // Continue without context
    }
    if (projectContext) {
      yield `Context gathered.\n\n`;
    } else {
      yield `No context found (no open folder).\n\n`;
    }

    // ── Phase 1: Independent Analysis ──
    yield `---\n\n### Phase 1 — Individual Analysis\n\n`;

    for (const agent of agents) {
      yield `**${agent.name}** is analyzing the task...\n\n`;

      const messages = buildPhase1Messages(agent, task, projectContext);
      let response = "";

      try {
        for await (const chunk of agent.llm.streamChat(messages, abortSignal)) {
          const text = renderChatMessage(chunk);
          response += text;
          yield text;
        }
      } catch (e: any) {
        response = `[Error: ${e.message}]`;
        yield `\n! Error: ${e.message}\n`;
      }

      history.push({
        agent: agent.name,
        content: response,
        phase: "analysis",
        round: 0,
      });

      yield `\n\n`;
    }

    // ── Phase 2: Cross-Critique ──
    if (critiqueRounds > 0) {
      yield `---\n\n### Phase 2 — Cross-Critique\n\n`;

      for (let round = 0; round < critiqueRounds; round++) {
        if (critiqueRounds > 1) {
          yield `**Round ${round + 1}/${critiqueRounds}**\n\n`;
        }

        for (const agent of agents) {
          yield `**${agent.name}** is critiquing...\n\n`;

          // For first critique round, show phase 1 responses.
          // For subsequent rounds, show all previous responses.
          const previousResponses = round === 0
            ? history.filter((h) => h.phase === "analysis")
            : history.filter(
                (h) => h.phase === "analysis" || (h.phase === "critique" && h.round < round),
              );

          const messages = buildPhase2Messages(
            agent,
            task,
            projectContext,
            previousResponses,
          );

          let response = "";
          try {
            for await (const chunk of agent.llm.streamChat(messages, abortSignal)) {
              const text = renderChatMessage(chunk);
              response += text;
              yield text;
            }
          } catch (e: any) {
            response = `[Error: ${e.message}]`;
            yield `\n! Error: ${e.message}\n`;
          }

          history.push({
            agent: agent.name,
            content: response,
            phase: "critique",
            round,
          });

          yield `\n\n`;
        }
      }
    }

    // ── Phase 3: Plan Synthesis ──
    yield `---\n\n### Phase 3 — Plan Synthesis\n\n`;

    const planMessages = buildPlanMessages(task, projectContext, history);

    let planContent = "";
    try {
      for await (const chunk of agents[0].llm.streamChat(planMessages, abortSignal)) {
        const text = renderChatMessage(chunk);
        planContent += text;
        yield text;
      }
    } catch (e: any) {
      yield `\n! Error generating plan: ${e.message}\n`;
    }

    // ── Save Files ──
    if (planContent.trim()) {
      try {
        const workspaceDirs = await ide.getWorkspaceDirs();
        if (workspaceDirs.length > 0) {
          // Save plan
          const planUri = joinPathsToUri(workspaceDirs[0], "council-plan.md");
          await ide.writeFile(planUri, planContent);
          await ide.openFile(planUri);

          yield `\n\n---\n\n`;
          yield `**Plan saved and opened:** \`council-plan.md\`\n`;

          // Save discussion (only if enabled)
          if (saveDiscussion) {
            const discussionContent = formatDiscussion(
              history,
              task,
              agents,
              difficulty,
            );
            const discussionUri = joinPathsToUri(
              workspaceDirs[0],
              "council-discussion.md",
            );
            await ide.writeFile(discussionUri, discussionContent);
            yield `**Discussion saved:** \`council-discussion.md\`\n`;
          }

          yield `\nTo implement the plan, copy the contents of council-plan.md into the chat and write "implement this plan, create all files".\n`;
        } else {
          yield `\n! No project folder open. Open a folder via File > Open Folder.\n`;
        }
      } catch (e: any) {
        yield `\n! Failed to save: ${e.message}\n`;
        try {
          await ide.showVirtualFile("council-plan.md", planContent);
          yield `Plan opened in a temporary tab.\n`;
        } catch {
          yield `\n${planContent}\n`;
        }
      }
    }
  },
};

export default CouncilCommand;
