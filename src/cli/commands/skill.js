// src/cli/commands/skill.js
// ==========================================
// AGENTOS SKILL COMMAND
// List, run, and manage agent skills
// ==========================================

const _chalk = require('chalk');
const chalk  = _chalk.default || _chalk;
const { intro, outro, note, log } = require('@clack/prompts');
const path   = require('path');

module.exports = (program) => {
  const skill = program
    .command('skill')
    .description('Manage and execute agent skills');

  // ── skill list ────────────────────────────────────────────────────────────
  skill
    .command('list')
    .description('List all installed skills')
    .action(async () => {
      try {
        const SkillRegistry = require('../../core/SkillRegistry');
        const registry = new SkillRegistry({});
        const skillsDir = path.join(process.cwd(), 'src', 'skills');
        await registry.loadFromDirectory(skillsDir);

        intro('📦 Skill Manager');

        const skills = registry.list();
        if (!skills.length) {
          log.warn('No skills installed. Drop skill folders into src/skills/');
          return;
        }

        const lines = skills.map(name => {
          const s = registry.get(name);
          return `● ${chalk.bold(name)} v${s.manifest.version}\n  ${chalk.gray(s.manifest.description)}`;
        });

        note(lines.join('\n\n'), `Installed Skills (${skills.length})`);
        outro(chalk.green('✓ Listing complete.'));
      } catch (err) {
        log.error(`Error: ${err.message}`);
      }
    });

  // ── skill run <name> ───────────────────────────────────────────────────────
  skill
    .command('run <skillName>')
    .description('Execute a skill by name')
    .option('-p, --param <key=value>', 'Pass parameter(s)', (v, prev) => {
      const [k, val] = v.split('=');
      return { ...prev, [k]: val };
    }, {})
    .action(async (skillName, options) => {
      try {
        const SkillRegistry = require('../../core/SkillRegistry');
        const registry = new SkillRegistry({});
        await registry.loadFromDirectory(path.join(process.cwd(), 'src', 'skills'));

        intro(`⚙️ Executing Skill: ${chalk.bold(skillName)}`);

        if (!registry.has(skillName)) {
          log.error(`Skill not found: ${skillName}`);
          process.exit(1);
        }

        const skill = registry.get(skillName);
        const result = await skill.execute(options.param, { skill });
        note(JSON.stringify(result, null, 2), 'Result');
        outro(chalk.green('✓ Execution complete.'));
      } catch (err) {
        log.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // ── skill info <name> ──────────────────────────────────────────────────────
  skill
    .command('info <skillName>')
    .description('Show skill manifest and parameters')
    .action(async (skillName) => {
      try {
        const SkillRegistry = require('../../core/SkillRegistry');
        const registry = new SkillRegistry({});
        await registry.loadFromDirectory(path.join(process.cwd(), 'src', 'skills'));

        intro(`ℹ️ Skill Info: ${chalk.bold(skillName)}`);

        const s = registry.get(skillName);
        if (!s) {
          log.error(`Skill not found: ${skillName}`);
          return;
        }

        const details = [
          chalk.gray(s.manifest.description),
          ''
        ];

        if (s.manifest.parameters) {
          details.push(chalk.cyan('Parameters:'));
          Object.entries(s.manifest.parameters).forEach(([k, cfg]) => {
            const req = cfg.required ? chalk.red('*') : ' ';
            details.push(`  ${req} ${chalk.bold(k)} (${cfg.type}) — ${cfg.description || ''}`);
          });
        }

        note(details.join('\n'), `${s.manifest.name} v${s.manifest.version}`);
        outro(chalk.green('✓ Done.'));
      } catch (err) {
        log.error(`Error: ${err.message}`);
      }
    });
};
