// src/core/WorkflowEngine.js
class WorkflowEngine {
  constructor(agent) {
    this.agent = agent;
    this.workflows = new Map();
  }

  register(id, definition) {
    this.workflows.set(id, {
      id,
      ...definition,
      createdAt: Date.now()
    });
  }

  async execute(workflowId, params, context) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const results = [];
    const variables = new Map(Object.entries(params));

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      
      try {
        // Resolve variables in parameters
        const resolvedParams = this.resolveVariables(step.params, variables);
        
        // Execute skill or sub-workflow
        let result;
        if (step.workflow) {
          result = await this.execute(step.workflow, resolvedParams, context);
        } else {
          result = await this.agent.executeSkill(step.skill, resolvedParams, context);
        }

        results.push({ step: i, success: true, result });

        // Store in variable if specified
        if (step.output) {
          variables.set(step.output, result.output);
        }

        // Check condition for next step
        if (step.condition) {
          const conditionMet = this.evaluateCondition(step.condition, variables);
          if (!conditionMet) {
            break;
          }
        }

      } catch (error) {
        results.push({ step: i, success: false, error: error.message });
        
        if (workflow.onError === 'stop') {
          throw error;
        } else if (workflow.onError === 'continue') {
          continue;
        } else if (step.onError) {
          // Execute error handler
          await this.agent.executeSkill(step.onError.skill, step.onError.params, context);
        }
      }
    }

    return {
      workflow: workflowId,
      success: results.every(r => r.success),
      steps: results,
      variables: Object.fromEntries(variables)
    };
  }

  resolveVariables(params, variables) {
    const resolved = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && value.startsWith('$')) {
        resolved[key] = variables.get(value.slice(1));
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  evaluateCondition(condition, variables) {
    // Simple condition evaluation
    const { var: varName, op, value } = condition;
    const actual = variables.get(varName);
    
    switch (op) {
      case 'eq': return actual === value;
      case 'ne': return actual !== value;
      case 'gt': return actual > value;
      case 'lt': return actual < value;
      case 'exists': return actual !== undefined;
      default: return true;
    }
  }
}

module.exports = WorkflowEngine;
