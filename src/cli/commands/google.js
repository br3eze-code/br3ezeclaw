// ==========================================
// AGENTOS GOOGLE COMMAND
// Google Workspace integration — @clack/prompts edition
// ==========================================

'use strict';

const { intro, outro, spinner, note, log } = require('@clack/prompts');
const GoogleWorkspaceSkill = require('../../skills/google-workspace');
const { getGateway } = require('../../core/gateway-engine');

module.exports = (program) => {
  const googleCmd = program
    .command('google')
    .description('Google Workspace integration tools');

  // ── Helper: build skill instance ──────────────────────────────────────────
  const buildSkill = async () => {
    const gateway = await getGateway();
    return new GoogleWorkspaceSkill(gateway.config, gateway.logger, gateway.workspace);
  };

  // ── google list-docs ──────────────────────────────────────────────────────
  googleCmd
    .command('list-docs')
    .description('List Google Drive documents')
    .option('-q, --query <string>', 'Search query')
    .action(async (options) => {
      intro('📄 Google Drive — Documents');
      const s = spinner();
      s.start('Fetching documents…');
      try {
        const skill  = await buildSkill();
        const result = await skill.execute('google.docs.list', { q: options.query });
        const files  = result?.files || [];
        s.stop(`${files.length} document(s) found`);

        if (!files.length) {
          log.warn('No documents found.');
        } else {
          const lines = files.map((f, i) =>
            `${String(i + 1).padStart(2)}. ${f.name}\n    ID: ${f.id}\n    Type: ${f.mimeType}`
          );
          note(lines.join('\n\n'), `📋 Documents (${files.length})`);
        }
        outro('Done.');
      } catch (err) {
        log.error(`Error: ${err.message}`);
      }
    });

  // ── google create-doc ─────────────────────────────────────────────────────
  googleCmd
    .command('create-doc')
    .description('Create a new Google Doc')
    .requiredOption('-t, --title <string>', 'Document title')
    .action(async (options) => {
      intro('📝 Google Docs — Create Document');
      const s = spinner();
      s.start(`Creating "${options.title}"…`);
      try {
        const skill  = await buildSkill();
        const result = await skill.execute('google.docs.create', { title: options.title });
        s.stop('Document created');
        note(
          [
            `Title :  ${options.title}`,
            `ID    :  ${result.documentId}`,
            `URL   :  https://docs.google.com/document/d/${result.documentId}/edit`,
          ].join('\n'),
          '✅ New Document'
        );
        outro('Done.');
      } catch (err) {
        s.stop(`Failed: ${err.message}`);
        log.error(err.message);
      }
    });

  // ── google create-event ───────────────────────────────────────────────────
  googleCmd
    .command('create-event')
    .description('Create a Google Calendar event')
    .requiredOption('-s, --summary <string>', 'Event summary / title')
    .option('--start <iso>', 'Start time (ISO 8601, defaults to now)')
    .option('--end <iso>',   'End time (ISO 8601, defaults to +1 hour)')
    .action(async (options) => {
      intro('📅 Google Calendar — Create Event');
      const s = spinner();
      s.start(`Creating event "${options.summary}"…`);
      try {
        const now   = new Date();
        const start = options.start || now.toISOString();
        const end   = options.end   || new Date(now.getTime() + 3_600_000).toISOString();

        const skill  = await buildSkill();
        const result = await skill.execute('google.calendar.create', {
          summary: options.summary,
          start,
          end,
        });
        s.stop('Event created');
        note(
          [
            `Title :  ${options.summary}`,
            `Start :  ${start}`,
            `End   :  ${end}`,
            `ID    :  ${result.id}`,
            `URL   :  ${result.htmlLink}`,
          ].join('\n'),
          '✅ New Calendar Event'
        );
        outro('Done.');
      } catch (err) {
        s.stop(`Failed: ${err.message}`);
        log.error(err.message);
      }
    });
};
