#!/usr/bin/env node
/**
 * Xynapse Config Generator
 * 
 * Reads secrets.local.json and generates a ready-to-use config.yaml
 * for Xynapse Assistant (Continue fork).
 * 
 * Usage:
 *   node generate-config.js
 *   node generate-config.js --output ~/.continue/config.yaml
 */

const fs = require('fs');
const path = require('path');

// Paths to check for secrets.local.json
const secretsPaths = [
    // Relative to this script
    path.join(__dirname, '..', '..', '..', '..', 'vscode', 'extensions', 'yandex-gpt', 'secrets.local.json'),
    // Current directory
    path.join(process.cwd(), 'secrets.local.json'),
    // Home directory
    path.join(process.env.HOME || process.env.USERPROFILE, '.continue', 'secrets.local.json'),
];

// Find secrets file
let secretsPath = null;
let secrets = null;

for (const p of secretsPaths) {
    if (fs.existsSync(p)) {
        secretsPath = p;
        try {
            secrets = JSON.parse(fs.readFileSync(p, 'utf-8'));
            console.log(`✓ Found secrets at: ${p}`);
            break;
        } catch (e) {
            console.error(`✗ Failed to parse ${p}: ${e.message}`);
        }
    }
}

if (!secrets) {
    console.error('\n❌ Could not find secrets.local.json');
    console.error('Please create it with:');
    console.error('  {');
    console.error('    "apiKey": "your-yandex-api-key",');
    console.error('    "folderId": "your-folder-id"');
    console.error('  }');
    process.exit(1);
}

const { apiKey, folderId } = secrets;

if (!apiKey || !folderId) {
    console.error('❌ secrets.local.json must contain "apiKey" and "folderId"');
    process.exit(1);
}

// Generate config.yaml
const configYaml = `# Xynapse Assistant Configuration
# Auto-generated from secrets.local.json
# Generated at: ${new Date().toISOString()}

name: "Xynapse Config"
version: "1.0.0"
schema: "v1"

models:
  # YandexGPT Pro - primary model for chat and edit
  - name: "YandexGPT Pro"
    provider: "yandex_gpt"
    model: "yandexgpt"
    apiKey: "${apiKey}"
    roles:
      - chat
      - edit
    defaultCompletionOptions:
      temperature: 0.3
      maxTokens: 8192
    requestOptions:
      extraBodyProperties:
        folderId: "${folderId}"

  # YandexGPT Lite - faster for autocomplete
  - name: "YandexGPT Lite"
    provider: "yandex_gpt"
    model: "yandexgpt-lite"
    apiKey: "${apiKey}"
    roles:
      - autocomplete
    defaultCompletionOptions:
      temperature: 0.1
      maxTokens: 2048
    requestOptions:
      extraBodyProperties:
        folderId: "${folderId}"

context:
  - provider: "code"
  - provider: "docs"
  - provider: "diff"
  - provider: "terminal"
  - provider: "problems"
  - provider: "folder"

slashCommands:
  - name: "edit"
    description: "Редактировать выделенный код"
  - name: "explain"
    description: "Объяснить выделенный код"
  - name: "comment"
    description: "Добавить комментарии"
  - name: "test"
    description: "Сгенерировать тесты"

experimental:
  contextMenuPrompts:
    comment: "Добавь подробные комментарии к этому коду на русском языке."
    docstring: "Напиши docstring для этой функции на русском языке."
    fix: "Исправь ошибки в этом коде. Объясни что было исправлено."
    optimize: "Оптимизируй этот код для лучшей производительности."
`;

// Determine output path
let outputPath = path.join(process.env.HOME || process.env.USERPROFILE, '.continue', 'config.yaml');

// Check for --output argument
const outputArg = process.argv.indexOf('--output');
if (outputArg !== -1 && process.argv[outputArg + 1]) {
    outputPath = process.argv[outputArg + 1];
}

// Create directory if needed
const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`✓ Created directory: ${outputDir}`);
}

// Write config
fs.writeFileSync(outputPath, configYaml, 'utf-8');
console.log(`✓ Generated config.yaml at: ${outputPath}`);

console.log('\n🎉 Setup complete! Restart Xynapse IDE to use YandexGPT.');
