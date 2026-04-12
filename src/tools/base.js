// src/tools/base.js
class BaseTool {
  constructor(config) {
    this.name = config.name;
    this.description = config.description;
    this.version = config.version || '1.0.0';
    this.author = config.author;
    this.permissions = config.permissions || [];
    this.parameters = config.parameters || {};
  }
  
  validate(params) {
    const schema = z.object(this.parameters);
    return schema.parse(params);
  }
  
  async execute(params, context) {
    throw new Error('Tool must implement execute method');
  }
  
  async rollback(action, context) {
    return { status: 'no-rollback' };
  }
}
class DatabaseMigrationTool extends BaseTool {
  constructor() {
    super({
      name: 'db-migrate',
      description: 'Run database migrations safely',
      parameters: {
        direction: z.enum(['up', 'down']),
        version: z.string().optional(),
        dryRun: z.boolean().default(false)
      },
      permissions: ['database:write']
    });
  }
  
  async execute(params, context) {
    const { direction, version, dryRun } = this.validate(params);
    
    // Check if migration is safe
    if (direction === 'down' && !dryRun) {
      const approval = await context.requestApproval({
        action: 'destructive-migration',
        details: `Rolling back to ${version || 'previous'}`
      });
      
      if (!approval.granted) {
        throw new Error('Migration not approved');
      }
    }
    
    // Execute
    const result = await this.runMigration(direction, version, dryRun);
    
    return {
      status: 'success',
      migrations: result.applied,
      duration: result.duration,
      backup: result.backupLocation
    };
  }
}
