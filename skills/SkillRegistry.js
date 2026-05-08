// skills/SkillRegistry.js
// Central skill registry — discovers and wires all built-in skills
// SPEC.md §12 Skill Loader

const path = require('path');

class SkillRegistry {
  constructor() {
    this.skills = new Map();
  }

  /** Load all built-in skills. Called once during Bootstrap §26. */
  loadBuiltinSkills() {
    const builtins = [
      'mikrotik',   // manage_network  — RouterOS users, firewall, system
      'finance',    // manage_finance  — revenue, P2P, Mastercard A2A
      'project',    // manage_project  — CPM + EVM
      'tasks',      // manage_project  — task CRUD (local/todoist/asana/notion)
      'memory',     // manage_memory   — vector + KV memory
      'mesh',       // manage_mesh     — multi-router NodeRegistry
      'voucher',    // manage_vouchers — create, redeem, stats, recurring billing
    ];

    for (const name of builtins) {
      try {
        const skillPath = path.join(__dirname, name, 'index.js');
        const skill = require(skillPath);
        let meta = {};
        try { meta = require(path.join(__dirname, name, 'skill.json')); } catch {}
        this.register(name, {
          description:  meta.description  || name,
          parameters:   meta.parameters   || {},
          dispatch:     meta.dispatch      || null,
          version:      meta.version       || '1.0.0',
          tags:         meta.tags          || [],
          execute:      (params, ctx) => skill.execute(params, ctx)
        });
      } catch (err) {
        // Skill not yet implemented — register as stub
        this.register(name, {
          description: `${name} (stub — not yet implemented)`,
          parameters:  {},
          version:     '0.0.0',
          tags:        [],
          execute:     async () => ({ success: false, error: `Skill '${name}' not implemented` })
        });
      }
    }
  }

  /**
   * Register a skill.
   * @param {string} name
   * @param {{ description, parameters, execute, dispatch?, version?, tags? }} skill
   */
  register(name, skill) {
    this.skills.set(name, {
      name,
      description: skill.description,
      parameters:  skill.parameters,
      dispatch:    skill.dispatch  || null,
      execute:     skill.execute,
      version:     skill.version   || '1.0.0',
      tags:        skill.tags      || []
    });
  }

  /** Execute a skill by name. */
  async execute(skillName, params, context = {}) {
    const skill = this.skills.get(skillName);
    if (!skill) throw new Error(`Skill '${skillName}' not found`);
    return await skill.execute(params, context);
  }

  /**
   * Find the skill registered for a given AskEngine dispatch key.
   * e.g. dispatch='manage_finance' → returns FinanceSkill
   */
  findByDispatch(dispatchKey) {
    for (const [, skill] of this.skills) {
      if (skill.dispatch === dispatchKey) return skill;
    }
    return null;
  }

  /** List all registered skills (for `tools` WS message and REPL `tools` command). */
  list() {
    return [...this.skills.values()].map(s => ({
      name:        s.name,
      description: s.description,
      version:     s.version,
      dispatch:    s.dispatch,
      tags:        s.tags
    }));
  }

  /** Check if a skill is registered. */
  has(skillName) {
    return this.skills.has(skillName);
  }
}

module.exports = new SkillRegistry();
