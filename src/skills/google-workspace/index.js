const { BaseSkill } = require('../base');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');

class GoogleWorkspaceSkill extends BaseSkill {
  static id = 'google-workspace'
  static name = 'Google Workspace'

  static getTools() {
    return {
      'google.docs.list': {
        description: 'List Google Drive documents',
        parameters: {
          q: { type: 'string', description: 'Search query' },
          pageSize: { type: 'number', description: 'Number of results' }
        }
      },
      'google.docs.create': {
        description: 'Create a new Google Doc',
        parameters: {
          title: { type: 'string', description: 'Document title' },
          content: { type: 'string', description: 'Initial content' }
        }
      },
      'google.calendar.list': {
        description: 'List Google Calendar events',
        parameters: {
          calendarId: { type: 'string', description: 'Calendar ID', default: 'primary' },
          timeMin: { type: 'string', description: 'ISO string for start time' }
        }
      },
      'google.calendar.create': {
        description: 'Create a Google Calendar event',
        parameters: {
          summary: { type: 'string', description: 'Event summary' },
          start: { type: 'string', description: 'Start time (ISO)' },
          end: { type: 'string', description: 'End time (ISO)' },
          description: { type: 'string', description: 'Event description' }
        }
      },
      'google.sheets.read': {
        description: 'Read a Google Sheet',
        parameters: {
          spreadsheetId: { type: 'string', description: 'Spreadsheet ID' },
          range: { type: 'string', description: 'A1 range' }
        }
      },
      'google.keep.list': {
        description: 'List Google Keep notes',
        parameters: {}
      },
      'google.keep.create': {
        description: 'Create a new Google Keep note',
        parameters: {
          title: { type: 'string', description: 'Note title' },
          text: { type: 'string', description: 'Note text content' }
        }
      }
    };
  }

  async _getAuth() {
    const keyFile = this.config.googleKeyFile || process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (keyFile) {
      const auth = new GoogleAuth({
        keyFile,
        scopes: [
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/keep'
        ]
      });
      return await auth.getClient();
    }
    throw new Error('Google Workspace credentials (googleKeyFile or GOOGLE_APPLICATION_CREDENTIALS) not configured');
  }

  async execute(toolName, params) {
    const client = await this._getAuth();
    const token = (await client.getAccessToken()).token;

    switch (toolName) {
      case 'google.docs.list':
        return this._listDrive(token, params);
      case 'google.docs.create':
        return this._createDoc(token, params);
      case 'google.calendar.list':
        return this._listCalendar(token, params);
      case 'google.calendar.create':
        return this._createCalendarEvent(token, params);
      case 'google.sheets.read':
        return this._readSheet(token, params);
      case 'google.keep.list':
        return this._listKeepNotes(token, params);
      case 'google.keep.create':
        return this._createKeepNote(token, params);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  async _listDrive(token, { q, pageSize = 10 }) {
    const res = await axios.get('https://www.googleapis.com/drive/v3/files', {
      headers: { Authorization: `Bearer ${token}` },
      params: { q, pageSize, fields: 'files(id, name, mimeType)' }
    });
    return res.data;
  }

  async _createDoc(token, { title, content }) {
    const res = await axios.post('https://docs.googleapis.com/v1/documents', { title }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    // If content provided, we could append it here (requires more complexity), 
    // but for now creating the doc is the first step.
    return res.data;
  }

  async _listCalendar(token, { calendarId = 'primary', timeMin }) {
    const res = await axios.get(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { timeMin: timeMin || new Date().toISOString(), singleEvents: true, orderBy: 'startTime' }
    });
    return res.data;
  }

  async _createCalendarEvent(token, { summary, start, end, description }) {
    const res = await axios.post('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      summary,
      description,
      start: { dateTime: start },
      end: { dateTime: end || start }
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.data;
  }

  async _readSheet(token, { spreadsheetId, range }) {
    const res = await axios.get(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.data;
  }

  async _listKeepNotes(token) {
    const res = await axios.get('https://keep.googleapis.com/v1/notes', {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.data;
  }

  async _createKeepNote(token, { title, text }) {
    const res = await axios.post('https://keep.googleapis.com/v1/notes', {
      title,
      body: {
        text: { text }
      }
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.data;
  }
}

module.exports = GoogleWorkspaceSkill;
