// skills/project/index.js
// manage_project dispatcher — CPM (Critical Path Method) + EVM (Earned Value Management)
// SPEC.md §4.5 ProjectManager

class ProjectSkill {
  async execute(params, context) {
    const { action, project, task, filters } = params;
    const db = context.db;

    switch (action) {
      case 'project.create':        return this.createProject(project, db);
      case 'project.list':          return this.listProjects(db);
      case 'project.get':           return this.getProject(params.id, db);
      case 'project.update':        return this.updateProject(params.id, project || task, db);
      case 'project.delete':        return this.deleteProject(params.id, db);
      case 'project.critical_path': return this.criticalPath(params.id, db);
      case 'project.evm':           return this.evm(params.id, db);
      case 'project.report':        return this.report(params.id, db);
      case 'project.export':        return this.exportProject(params.id, db);
      default:
        throw new Error(`Unknown project action: ${action}`);
    }
  }

  // ── CRUD ─────────────────────────────────────────────────────────
  async createProject(project, db) {
    if (!project?.name) throw new Error('project.name is required');
    const id = `proj-${Date.now()}`;
    const record = {
      id,
      name: project.name,
      bac: project.bac || 0,          // Budget at Completion
      tasks: (project.tasks || []).map((t, i) => ({
        id: t.id || `t${i + 1}`,
        title: t.title,
        duration: t.duration || 1,
        dependencies: t.dependencies || [],
        actualCost: t.actualCost || 0,
        plannedValue: t.plannedValue || 0,
        earnedValue: t.earnedValue || 0,
        status: t.status || 'open'
      })),
      createdAt: new Date().toISOString()
    };
    await db.set(`project:${id}`, record);
    return { success: true, id, project: record };
  }

  async listProjects(db) {
    const projects = await db.list('project:') || [];
    return { success: true, count: projects.length, projects };
  }

  async getProject(id, db) {
    if (!id) throw new Error('id is required');
    const project = await db.get(`project:${id}`);
    if (!project) throw new Error(`Project not found: ${id}`);
    return { success: true, project };
  }

  async updateProject(id, updates, db) {
    if (!id) throw new Error('id is required');
    const project = await db.get(`project:${id}`);
    if (!project) throw new Error(`Project not found: ${id}`);
    const updated = { ...project, ...updates, updatedAt: new Date().toISOString() };
    await db.set(`project:${id}`, updated);
    return { success: true, project: updated };
  }

  async deleteProject(id, db) {
    if (!id) throw new Error('id is required');
    await db.delete(`project:${id}`);
    return { success: true, deleted: id };
  }

  async exportProject(id, db) {
    const { project } = await this.getProject(id, db);
    const cpm = this._computeCPM(project.tasks);
    const evm = this._computeEVM(project.tasks, project.bac);
    return {
      success: true,
      project: project.name,
      bac: project.bac,
      export: { tasks: cpm.tasks, evm, criticalPath: cpm.criticalPath }
    };
  }

  // ── CPM: Critical Path Method ────────────────────────────────────
  async criticalPath(id, db) {
    const { project } = await this.getProject(id, db);
    const result = this._computeCPM(project.tasks);
    return { success: true, project: project.name, ...result };
  }

  _computeCPM(tasks) {
    const map = Object.fromEntries(tasks.map(t => [t.id, { ...t, ES: 0, EF: 0, LS: 0, LF: 0, float: 0 }]));

    // Forward pass — ES / EF
    const visited = new Set();
    const forwardPass = (id) => {
      if (visited.has(id)) return;
      visited.add(id);
      const t = map[id];
      for (const dep of (t.dependencies || [])) {
        forwardPass(dep);
        t.ES = Math.max(t.ES, map[dep].EF);
      }
      t.EF = t.ES + t.duration;
    };
    tasks.forEach(t => forwardPass(t.id));

    // Project end
    const projectEnd = Math.max(...tasks.map(t => map[t.id].EF));

    // Backward pass — LS / LF
    tasks.forEach(t => { map[t.id].LF = projectEnd; map[t.id].LS = projectEnd - map[t.id].duration; });
    const backOrder = [...tasks].reverse();
    for (const t of backOrder) {
      const successors = tasks.filter(s => (s.dependencies || []).includes(t.id));
      if (successors.length) {
        map[t.id].LF = Math.min(...successors.map(s => map[s.id].LS));
        map[t.id].LS = map[t.id].LF - map[t.id].duration;
      }
      map[t.id].float = map[t.id].LF - map[t.id].EF;
    }

    const criticalPath = tasks.filter(t => map[t.id].float === 0).map(t => t.id);
    return { tasks: Object.values(map), criticalPath, projectDuration: projectEnd };
  }

  // ── EVM: Earned Value Management ─────────────────────────────────
  async evm(id, db) {
    const { project } = await this.getProject(id, db);
    const result = this._computeEVM(project.tasks, project.bac);
    return { success: true, project: project.name, bac: project.bac, ...result };
  }

  _computeEVM(tasks, bac) {
    const PV = tasks.reduce((s, t) => s + (t.plannedValue || 0), 0);
    const EV = tasks.reduce((s, t) => s + (t.earnedValue  || 0), 0);
    const AC = tasks.reduce((s, t) => s + (t.actualCost   || 0), 0);
    const BAC = bac || PV;

    const SPI  = PV  ? +(EV / PV).toFixed(3)  : null;
    const CPI  = AC  ? +(EV / AC).toFixed(3)  : null;
    const SV   = +(EV - PV).toFixed(2);
    const CV   = +(EV - AC).toFixed(2);
    const ETC  = CPI ? +((BAC - EV) / CPI).toFixed(2) : null;
    const EAC  = ETC != null ? +(AC + ETC).toFixed(2) : null;
    const VAC  = EAC != null ? +(BAC - EAC).toFixed(2) : null;
    const TCPI = (BAC - AC) ? +((BAC - EV) / (BAC - AC)).toFixed(3) : null;

    return { PV, EV, AC, BAC, SPI, CPI, SV, CV, ETC, EAC, VAC, TCPI };
  }

  // ── Combined Report ──────────────────────────────────────────────
  async report(id, db) {
    const { project } = await this.getProject(id, db);
    const cpm = this._computeCPM(project.tasks);
    const evm = this._computeEVM(project.tasks, project.bac);

    const scheduleHealth = evm.SPI >= 1 ? '✅ On/Ahead of Schedule' : `⚠️ Behind Schedule (SPI=${evm.SPI})`;
    const costHealth     = evm.CPI >= 1 ? '✅ Under Budget'          : `⚠️ Over Budget (CPI=${evm.CPI})`;

    return {
      success: true,
      project: project.name,
      cpm: { criticalPath: cpm.criticalPath, projectDuration: cpm.projectDuration },
      evm,
      health: { schedule: scheduleHealth, cost: costHealth },
      tasks: cpm.tasks
    };
  }

  validate(params) {
    return !!params.action;
  }
}

module.exports = new ProjectSkill();
