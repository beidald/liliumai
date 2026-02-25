import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import logger from '../src/utils/logger';

async function downloadWhisperModel(modelName: string = 'small') {
  const modelDir = path.join(process.cwd(), 'models', 'whisper');
  const modelPath = path.join(modelDir, `ggml-${modelName}.bin`);
  const baseUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
  const url = `${baseUrl}/ggml-${modelName}.bin`;

  await fs.ensureDir(modelDir);

  if (await fs.pathExists(modelPath)) {
    logger.info(`Whisper model ${modelName} already exists at ${modelPath}`);
    return;
  }

  logger.info(`Downloading Whisper model: ${modelName} (supports Chinese)...`);
  logger.info(`Source: ${url}`);
  logger.info(`Destination: ${modelPath}`);

  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream'
    });

    const totalLength = response.headers['content-length'];
    let downloadedLength = 0;

    const writer = fs.createWriteStream(modelPath);
    response.data.pipe(writer);

    response.data.on('data', (chunk: Buffer) => {
      downloadedLength += chunk.length;
      if (totalLength) {
        const progress = ((downloadedLength / parseInt(totalLength)) * 100).toFixed(2);
        if (downloadedLength % (1024 * 1024 * 10) < chunk.length) { // Log every 10MB
           logger.info(`Download progress: ${progress}% (${(downloadedLength / 1024 / 1024).toFixed(2)}MB / ${(parseInt(totalLength) / 1024 / 1024).toFixed(2)}MB)`);
        }
      }
    });

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        logger.info(`Successfully downloaded Whisper model: ${modelName}`);
        resolve(true);
      });
      writer.on('error', (err) => {
        logger.error(`Failed to download Whisper model: ${err}`);
        reject(err);
      });
    });
  } catch (err) {
    logger.error(`Error during Whisper model download: ${err}`);
    process.exit(1);
  }
}

downloadWhisperModel('small');
