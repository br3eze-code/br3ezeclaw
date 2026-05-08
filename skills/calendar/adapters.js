
// skills/calendar/adapters.js
const fs = require('fs');
const path = require('path');

class BaseCalendarAdapter {
  constructor(context) {
    this.context = context;
  }
  async createEvent(event) { throw new Error('Not implemented'); }
  async listEvents(start, end) { throw new Error('Not implemented'); }
  async updateEvent(id, event) { throw new Error('Not implemented'); }
  async deleteEvent(id) { throw new Error('Not implemented'); }
}

class LocalCalendarAdapter extends BaseCalendarAdapter {
  constructor(context) {
    super(context);
    this.storagePath = path.join(process.cwd(), 'data', 'calendar.json');
    this._ensureStorage();
  }

  _ensureStorage() {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.storagePath)) fs.writeFileSync(this.storagePath, JSON.stringify([]));
  }

  async _read() {
    return JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
  }

  async _write(data) {
    fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
  }

  async createEvent(event) {
    const events = await this._read();
    const newEvent = {
      id: Date.now().toString(),
      ...event,
      createdAt: new Date().toISOString()
    };
    events.push(newEvent);
    await this._write(events);
    return newEvent;
  }

  async listEvents(start, end) {
    let events = await this._read();
    if (start) events = events.filter(e => new Date(e.start) >= new Date(start));
    if (end) events = events.filter(e => new Date(e.end) <= new Date(end));
    return events;
  }

  async updateEvent(id, updates) {
    const events = await this._read();
    const idx = events.findIndex(e => e.id === id);
    if (idx === -1) throw new Error('Event not found');
    events[idx] = { ...events[idx], ...updates, updatedAt: new Date().toISOString() };
    await this._write(events);
    return events[idx];
  }

  async deleteEvent(id) {
    const events = await this._read();
    const filtered = events.filter(e => e.id !== id);
    await this._write(filtered);
    return { success: true };
  }
}

class GoogleCalendarAdapter extends BaseCalendarAdapter {
  async listEvents() {
    return [{ id: 'mock-google', summary: 'Google Calendar Integration Pending Configuration' }];
  }
}

class OutlookCalendarAdapter extends BaseCalendarAdapter {
  async listEvents() {
    return [{ id: 'mock-outlook', summary: 'Outlook Calendar Integration Pending Configuration' }];
  }
}

module.exports = {
  LocalCalendarAdapter,
  GoogleCalendarAdapter,
  OutlookCalendarAdapter
};
