// core/ACPClient.js
class ACPClient {
  constructor(agentId) {
    this.agentId = agentId;
    this.sessionState = {};
    this.messageQueue = [];
  }
  
  async connect(endpoint) {
    // WebSocket or HTTP streaming connection
    this.ws = new WebSocket(`${endpoint}/agents/${this.agentId}`);
    this.ws.onmessage = (msg) => this.handleMessage(JSON.parse(msg.data));
  }
  
  async sendAction(action, payload) {
    const message = {
      type: 'action',
      action,
      payload,
      timestamp: Date.now(),
      session: this.sessionState
    };
    this.ws.send(JSON.stringify(message));
  }
}
