'use strict';

const { execSync } = require('child_process');

module.exports = (program) => {
    program
        .command('update')
        .description('Update AgentOS to the latest version')
        .action(async () => {
            const { intro, outro, spinner, log, note } = await import('@clack/prompts');
            const chalk = (await import('chalk')).default || require('chalk');

            console.clear();
            intro(chalk.cyan('🚀 AgentOS Update'));

            const s = spinner();
            s.start('Fetching latest code from repository...');
            
            try {
                execSync('git pull --ff-only', { stdio: 'pipe' });
                
                s.message('Updating dependencies...');
                execSync('npm install --omit=dev', { stdio: 'pipe' });
                
                s.stop(chalk.green('✔ AgentOS updated successfully.'));
                
                note('sudo systemctl restart agentos', chalk.yellow('Please restart the service to apply changes:'));
                outro('Update complete');
            } catch (err) {
                s.stop(chalk.red('✘ Update failed.'));
                log.error(chalk.red('Check your git status or network connection.'));
                log.error(`Error details: ${err.message}`);
                process.exitCode = 1;
            }
        });
};
