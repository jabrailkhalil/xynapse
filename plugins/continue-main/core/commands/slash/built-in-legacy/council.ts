import { ChatMessage, ILLM, SlashCommand } from "../../../index.js";
import { renderChatMessage } from "../../../util/messageContent.js";
import { joinPathsToUri } from "../../../util/uri.js";

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

const DIFFICULTY_CONFIG: Record<Difficulty, { maxRounds: number }> = {
  easy: { maxRounds: 1 },
  medium: { maxRounds: 3 },
  hard: { maxRounds: 5 },
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Легкий",
  medium: "Средний",
  hard: "Сложный",
};

const ROLE_PROMPTS: Record<string, string> = {
  "Архитектор": `Ты — Архитектор в команде Council.
Твои задачи:
- Предложить архитектуру проекта: структуру файлов, модули, API
- Выбрать подходящие паттерны проектирования
- Продумать масштабируемость и расширяемость
- Оценить технические риски
- Реагировать на замечания других участников

Отвечай на русском языке. Обосновывай архитектурные решения.
Будь конкретен — указывай имена файлов, структуру папок, форматы данных.`,

  "Разработчик": `Ты — Senior Developer в команде Council.
Твои задачи:
- Предложить конкретные технологии, библиотеки и фреймворки
- Продумать алгоритмы и структуры данных
- Оценить сложность реализации каждого компонента
- Критически оценить архитектурные решения — указать на проблемы
- Предложить улучшения и альтернативные подходы

Отвечай на русском языке. Будь практичен — предлагай конкретный код и решения.`,

  "Ревьюер": `Ты — Code Reviewer и QA-эксперт в команде Council.
Твои задачи:
- Критически оценить предложенную архитектуру и решения
- Найти потенциальные баги, уязвимости и edge cases
- Оценить безопасность решения (SQL-инъекции, XSS, CSRF и др.)
- Предложить альтернативные подходы, если текущие имеют проблемы
- Проверить, что решение покрывает все требования задачи

Отвечай на русском языке. Будь строгим но конструктивным.`,

  "Тестировщик": `Ты — QA-инженер и тестировщик в команде Council.
Твои задачи:
- Продумать стратегию тестирования проекта
- Определить ключевые тест-кейсы и сценарии
- Указать на edge cases, которые нужно покрыть тестами
- Предложить типы тестов: unit, integration, e2e
- Оценить тестируемость предложенной архитектуры

Отвечай на русском языке. Будь конкретен — описывай тест-кейсы подробно.`,
};

const DEFAULT_ROLE_PROMPT = `Ты — эксперт "{name}" в команде Council.
Твои задачи:
- Оценить проект с точки зрения своей экспертизы
- Дать конкретные рекомендации и предложения
- Указать на возможные проблемы в своей области
- Реагировать на предложения других участников

Отвечай на русском языке. Будь конкретен и практичен.`;

const PLAN_PROMPT = `Ты — ведущий архитектор. На основе предыдущего обсуждения составь ФИНАЛЬНЫЙ ПЛАН проекта.

Формат плана СТРОГО:

# План проекта

## Описание
Краткое описание проекта (2-3 предложения)

## Файловая структура
\`\`\`
project/
├── file1.ext
├── file2.ext
└── dir/
    └── file3.ext
\`\`\`

## Описание файлов
Для каждого файла: что содержит, за что отвечает.

## Порядок реализации
Нумерованный список шагов. Каждый шаг должен содержать:
- Какой файл создать/изменить
- Что конкретно написать (ключевые фрагменты кода)
- Какие зависимости установить

## Технологии
Список используемых технологий/библиотек.

Отвечай на русском языке. Будь максимально конкретен — каждый шаг должен быть реализуем без дополнительных уточнений.`;

/**
 * Parse input: can be GUI config (JSON on first line + task) or text command.
 */
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
  if (lower.startsWith("легко ") || lower.startsWith("easy ")) {
    return { difficulty: "easy", task: trimmed.replace(/^(легко|easy)\s+/i, ""), saveDiscussion: true };
  }
  if (lower.startsWith("сложно ") || lower.startsWith("hard ")) {
    return { difficulty: "hard", task: trimmed.replace(/^(сложно|hard)\s+/i, ""), saveDiscussion: true };
  }
  return {
    difficulty: "medium",
    task: trimmed.replace(/^(средне|medium)\s+/i, ""),
    saveDiscussion: true,
  };
}

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

  // Default: Архитектор + Разработчик
  const defaultRoles = ["Архитектор", "Разработчик"];
  return defaultRoles.map((name, i) => ({
    name,
    systemPrompt: getPromptForRole(name),
    llm: models[i % models.length],
  }));
}

function buildConversationForAgent(
  agent: CouncilAgent,
  history: { agent: string; content: string }[],
  task: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: agent.systemPrompt },
  ];

  let conversationLog = `Задача от пользователя: ${task}`;

  if (history.length > 0) {
    conversationLog += "\n\n--- Обсуждение команды ---\n";
    for (const msg of history) {
      conversationLog += `\n[${msg.agent}]:\n${msg.content}\n`;
    }
    conversationLog += "\n--- Конец обсуждения ---\n";
    conversationLog += `\nТеперь твоя очередь. Ответь как ${agent.name}, учитывая всё сказанное выше.`;
  }

  messages.push({ role: "user", content: conversationLog });
  return messages;
}

function formatDiscussion(
  history: { agent: string; content: string; round: number }[],
  task: string,
  agents: CouncilAgent[],
  difficulty: Difficulty,
): string {
  const lines: string[] = [];
  lines.push("# Обсуждение Council\n");
  lines.push(`**Задача:** ${task}\n`);
  lines.push(`**Уровень:** ${DIFFICULTY_LABELS[difficulty]}\n`);
  lines.push(`**Участники:** ${agents.map((a) => `${a.name} (${a.llm.title || a.llm.model})`).join(", ")}\n`);
  lines.push("---\n");

  let currentRound = -1;
  for (const msg of history) {
    if (msg.round !== currentRound) {
      currentRound = msg.round;
      lines.push(`\n## Раунд ${currentRound + 1}\n`);
    }
    lines.push(`### ${msg.agent}\n`);
    lines.push(msg.content);
    lines.push("\n");
  }

  return lines.join("\n");
}

const CouncilCommand: SlashCommand = {
  name: "council",
  description: "Council — совет агентов для планирования проекта",
  run: async function* ({ ide, llm, input, config, abortController }) {
    if (!input.trim()) {
      yield "Опишите задачу для Council.\n\n";
      yield "Формат: `/council [легко|средне|сложно] задача`\n\n";
      yield "Или используйте кнопку Council в панели ввода.\n";
      return;
    }

    const { difficulty, task, roleOverrides, saveDiscussion } = parseInput(input);
    const diffConfig = DIFFICULTY_CONFIG[difficulty];
    const diffLabel = DIFFICULTY_LABELS[difficulty];

    if (!task.trim()) {
      yield "Опишите задачу. Например: `/council легко сделай калькулятор`";
      return;
    }

    const models = getAvailableModels(config, llm);
    const agents = buildAgents(models, roleOverrides);

    if (agents.length === 0) {
      yield "Нет доступных моделей. Добавьте модель в config.yaml.";
      return;
    }

    const agentList = agents
      .map((a) => `${a.name} (${a.llm.title || a.llm.model})`)
      .join(", ");

    // Header
    yield `## Council | ${diffLabel}\n\n`;
    yield `**Задача:** ${task}\n`;
    yield `**Участники:** ${agentList}\n`;
    yield `**Раундов:** ${diffConfig.maxRounds}\n\n`;

    // Discussion — quiet mode
    const history: { agent: string; content: string; round: number }[] = [];
    const abortSignal = abortController.signal;

    for (let round = 0; round < diffConfig.maxRounds; round++) {
      for (const agent of agents) {
        yield `[${agent.name}] думает (${round + 1}/${diffConfig.maxRounds})...\n`;

        const simpleHistory = history.map((h) => ({
          agent: h.agent,
          content: h.content,
        }));
        const messages = buildConversationForAgent(agent, simpleHistory, task);

        let response = "";
        try {
          for await (const chunk of agent.llm.streamChat(
            messages,
            abortSignal,
          )) {
            const text = renderChatMessage(chunk);
            response += text;
          }
        } catch (e: any) {
          response = `[Ошибка: ${e.message}]`;
          yield `  ! Ошибка: ${e.message}\n`;
        }

        history.push({ agent: agent.name, content: response, round });
      }
    }

    // Generate plan
    yield `\nГенерация плана...\n`;

    const planAgent: CouncilAgent = {
      name: "Планировщик",
      systemPrompt: PLAN_PROMPT,
      llm: agents[0].llm,
    };

    const simpleHistory = history.map((h) => ({
      agent: h.agent,
      content: h.content,
    }));
    const planMessages = buildConversationForAgent(planAgent, simpleHistory, task);

    let planContent = "";
    try {
      for await (const chunk of planAgent.llm.streamChat(
        planMessages,
        abortSignal,
      )) {
        const text = renderChatMessage(chunk);
        planContent += text;
      }
    } catch (e: any) {
      yield `! Ошибка генерации плана: ${e.message}\n`;
    }

    // Save plan and discussion
    if (planContent.trim()) {
      try {
        const workspaceDirs = await ide.getWorkspaceDirs();
        if (workspaceDirs.length > 0) {
          // Save plan
          const planUri = joinPathsToUri(workspaceDirs[0], "council-plan.md");
          await ide.writeFile(planUri, planContent);
          await ide.openFile(planUri);

          yield `\n---\n\n`;
          yield `**План сохранён и открыт:** \`council-plan.md\`\n`;

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
            yield `**Обсуждение сохранено:** \`council-discussion.md\`\n`;
          }

          yield `\nДля реализации плана скопируйте содержимое council-plan.md в чат и напишите \"реализуй по этому плану, создай все файлы\".\n`;
        } else {
          yield `\n! Нет открытой папки проекта. Откройте папку через File > Open Folder.\n`;
        }
      } catch (e: any) {
        yield `\n! Не удалось сохранить: ${e.message}\n`;
        try {
          await ide.showVirtualFile("council-plan.md", planContent);
          yield `План открыт во временной вкладке.\n`;
        } catch {
          yield `\n${planContent}\n`;
        }
      }
    }
  },
};

export default CouncilCommand;
