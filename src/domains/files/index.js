// src/domains/files/index.js
const BaseDomain = require('../BaseDomain');
const { logger } = require('../../core/logger');

class FilesDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'files';
    
    this.registerTool({
      name: 'listFiles',
      description: 'List available files in a directory',
      execute: async (directoryPath = '/') => {
        logger.info(`[FilesDomain] Listing files in ${directoryPath}`);
        return { success: true, files: ['doc1.pdf', 'image2.png', 'audio3.mp3'] };
      }
    });

    this.registerTool({
      name: 'uploadFile',
      description: 'Upload a new file',
      execute: async (fileUrl, destinationPath) => {
        logger.info(`[FilesDomain] Uploading file to ${destinationPath}`);
        return { success: true, path: destinationPath, url: 'https://cdn.agentos.local/' + destinationPath };
      }
    });

    this.registerTool({
      name: 'deleteFile',
      description: 'Delete an existing file',
      execute: async (filePath) => {
        logger.info(`[FilesDomain] Deleting file ${filePath}`);
        return { success: true, deleted: true };
      }
    });
  }
}

module.exports = FilesDomain;
