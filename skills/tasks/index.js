
// skills/tasks/index.js
class TasksSkill {
  async execute(params, context) {
    const { action, provider = 'local', task, filters } = params;
    
    const adapter = this.getAdapter(provider, context);
    
    switch (action) {
      case 'create':
        return adapter.create(task);
      case 'list':
        return adapter.list(filters);
      case 'update':
        return adapter.update(task.id, task);
      case 'delete':
        return adapter.delete(task.id);
      case 'assign':
        return adapter.assign(task.id, task.assignee);
      case 'complete':
        return adapter.complete(task.id);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  getAdapter(provider, context) {
    switch (provider) {
      case 'todoist':
        return new TodoistAdapter(context);
      case 'asana':
        return new AsanaAdapter(context);
      case 'notion':
        return new NotionAdapter(context);
      case 'local':
      default:
        return new LocalTaskAdapter(context);
    }
  }
}

// Local implementation using agent memory
class LocalTaskAdapter {
  constructor(context) {
    this.context = context;
  }

  async create(task) {
    const id = crypto.randomUUID();
    const newTask = {
      id,
      ...task,
      createdAt: new Date().toISOString(),
      status: 'open',
      createdBy: this.context.userId
    };
    
    await this.context.memory.push(`tasks:${this.context.userId}`, newTask);
    return { success: true, task: newTask };
  }

  async list(filters = {}) {
    const tasks = await this.context.memory.get(`tasks:${this.context.userId}`) || [];
    
    let filtered = tasks;
    if (filters.status) {
      filtered = filtered.filter(t => t.status === filters.status);
    }
    if (filters.priority) {
      filtered = filtered.filter(t => t.priority === filters.priority);
    }
    if (filters.project) {
      filtered = filtered.filter(t => t.project === filters.project);
    }
    
    return {
      count: filtered.length,
      tasks: filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    };
  }

  async update(id, updates) {
    const tasks = await this.context.memory.get(`tasks:${this.context.userId}`) || [];
    const idx = tasks.findIndex(t => t.id === id);
    
    if (idx === -1) throw new Error('Task not found');
    
    tasks[idx] = { ...tasks[idx], ...updates, updatedAt: new Date().toISOString() };
    await this.context.memory.set(`tasks:${this.context.userId}`, tasks);
    
    return { success: true, task: tasks[idx] };
  }

  async delete(id) {
    const tasks = await this.context.memory.get(`tasks:${this.context.userId}`) || [];
    const filtered = tasks.filter(t => t.id !== id);
    await this.context.memory.set(`tasks:${this.context.userId}`, filtered);
    return { success: true };
  }

  async complete(id) {
    return this.update(id, { status: 'completed', completedAt: new Date().toISOString() });
  }

  async assign(id, assignee) {
    return this.update(id, { assignee, assignedAt: new Date().toISOString() });
  }
}

module.exports = new TasksSkill();
