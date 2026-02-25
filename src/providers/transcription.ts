import fs from 'fs-extra';
import axios from 'axios';
import FormData from 'form-data';
// Dynamically imported to avoid CWD pollution: import { whisper } from 'whisper-node';
import path from 'path';
import os from 'os';
import logger from '../utils/logger';
import { exec } from 'child_process';
import util from 'util';
// @ts-ignore
import { Converter } from 'opencc-js';

const execAsync = util.promisify(exec);

export interface TranscriptionProvider {
  transcribe(filePath: string, options?: { convertAudio?: boolean }): Promise<string>;
}

export class LocalWhisperProvider implements TranscriptionProvider {
  private modelName: string;
  private modelPath: string;

  constructor(modelName: string = 'base') {
    this.modelName = modelName;
    // Download to current project directory: models/whisper/
    this.modelPath = path.join(process.cwd(), 'models', 'whisper', `ggml-${modelName}.bin`);
  }

  async ensureModel(): Promise<void> {
    const modelDir = path.dirname(this.modelPath);
    await fs.ensureDir(modelDir);

    if (!(await fs.pathExists(this.modelPath))) {
      logger.info(`Whisper model not found at ${this.modelPath}. Downloading ${this.modelName} model...`);
      logger.info('This may take a while depending on your internet connection.');
      
      const mirrors = [
        'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main', // Try mirror first for better speed in CN and usually good globally
        'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
      ];

      for (const baseUrl of mirrors) {
        try {
          const url = `${baseUrl}/ggml-${this.modelName}.bin`;
          logger.info(`Attempting download from: ${baseUrl}`);
          
          await this.downloadFile(url, this.modelPath);
          logger.info(`Successfully downloaded Whisper model from ${baseUrl}`);
          return;
        } catch (err: any) {
          logger.warn(`Failed to download from ${baseUrl}: ${err.message}. Trying next mirror...`);
          // Clean up partial file if any
          if (await fs.pathExists(this.modelPath)) {
            await fs.remove(this.modelPath);
          }
        }
      }
      
      throw new Error(`Failed to download Whisper model from all mirrors.`);
    }
  }

  private async downloadFile(url: string, destPath: string): Promise<void> {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      timeout: 10000 // 10s timeout for connection/headers
    });

    const totalLength = response.headers['content-length'];
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      let downloadedLength = 0;
      response.data.on('data', (chunk: Buffer) => {
        downloadedLength += chunk.length;
        // Optional: Log progress periodically could be added here
      });

      writer.on('finish', () => resolve());
      writer.on('error', (err) => reject(err));
      response.data.on('error', (err: Error) => reject(err));
    });
  }

  async convertToWav16k(sourcePath: string): Promise<string> {
      const destPath = sourcePath + '.16k.wav';
      // -ar 16000: Sample rate 16kHz
      // -ac 1: Mono channel
      // -c:a pcm_s16le: PCM signed 16-bit little-endian
      // -af "volume=2.0": Increase volume by 2x to help with quiet voice messages
      const cmd = `ffmpeg -i "${sourcePath}" -ar 16000 -ac 1 -c:a pcm_s16le -af "volume=2.0" "${destPath}" -y`;
      
      logger.info(`Converting audio to 16k WAV: ${cmd}`);
      try {
          await execAsync(cmd);
          if (await fs.pathExists(destPath)) {
              return destPath;
          }
          throw new Error('Converted file not found');
      } catch (error) {
          logger.error(`FFmpeg conversion failed: ${error}`);
          throw error;
      }
  }

  async transcribe(filePath: string, options?: { convertAudio?: boolean }): Promise<string> {
    if (!(await fs.pathExists(filePath))) {
      logger.error(`Audio file not found: ${filePath}`);
      return '';
    }

    let targetFile = filePath;
    let needsCleanup = false;

    try {
      await this.ensureModel();

      // Convert to 16kHz WAV required by whisper.cpp IF requested
      // We assume ffmpeg is available in the system
      if (options?.convertAudio) {
        try {
            targetFile = await this.convertToWav16k(filePath);
            needsCleanup = true;
        } catch (convertErr) {
            logger.error(`Audio conversion failed, trying original file: ${convertErr}`);
            // Fallback to original file if conversion fails (though likely to fail in whisper too if format is wrong)
            targetFile = filePath;
        }
      }

      const whisperOptions = {
        // modelName: this.modelName, // Do not provide both modelName and modelPath
        modelPath: this.modelPath, // Pass the custom path
        whisperOptions: {
          language: 'auto', // Use auto detection for mixed language support
          gen_file_txt: true, // Enable txt file generation for debugging
          gen_file_subtitle: false,
          gen_file_vtt: false,
          word_timestamps: false
        }
      };

      logger.info(`Starting local transcription for ${targetFile} using whisper-node (${this.modelName})...`);
      
      // Dynamic import to avoid CWD pollution at startup
      const { whisper } = await import('whisper-node');
      const transcript = await whisper(targetFile, whisperOptions);
      
      // whisper-node returns an array of segments usually, or a string depending on version/config
      let resultText = '';
      if (Array.isArray(transcript)) {
        resultText = transcript.map(s => s.speech).join(' ').trim();
      } else if (typeof transcript === 'string') {
        resultText = transcript.trim();
      }

      // Fallback to text file if result is empty
      if (!resultText) {
        const txtPath = targetFile + '.txt';
        if (await fs.pathExists(txtPath)) {
          logger.info(`Reading transcription from generated file: ${txtPath}`);
          resultText = (await fs.readFile(txtPath, 'utf-8')).trim();
          await fs.remove(txtPath); // Clean up
        }
      }
      
      // Filter out common hallucinations
      const hallucinations = [
          '(字幕:Singles)',
          'Subtitle',
          'Subtitles',
          'Amara.org',
          'MBC',
          'The following is a subtitle'
      ];
      
      // Check for hallucination patterns
      if (hallucinations.some(h => resultText.includes(h) || resultText === h)) {
          logger.warn(`Filtered hallucination: ${resultText}`);
          resultText = '';
      }
      
      // If result is wrapped in parens/brackets and short, likely hallucination
      if (/^[\(\[].*[\)\]]$/.test(resultText) && resultText.length < 20) {
           logger.warn(`Filtered suspicious bracketed content: ${resultText}`);
           resultText = '';
      }

      // Convert Traditional Chinese to Simplified Chinese (HK/TW -> CN)
      if (resultText) {
          try {
              // Create converter: Traditional (Hong Kong) -> Simplified (Mainland)
              const convert = Converter({ from: 'hk', to: 'cn' });
              const simplified = convert(resultText);
              if (simplified !== resultText) {
                  logger.info(`Converted Traditional Chinese to Simplified: "${resultText}" -> "${simplified}"`);
                  resultText = simplified;
              }
          } catch (e) {
              logger.warn(`Failed to convert Traditional Chinese to Simplified: ${e}`);
          }
      }

      return resultText;

    } catch (error) {
      logger.error(`Transcription failed: ${error}`);
      return '';
    } finally {
      if (needsCleanup && targetFile !== filePath) {
        try {
            await fs.remove(targetFile);
            // Also try to remove potential .txt file generated from the temp wav
            const txtPath = targetFile + '.txt';
            if (await fs.pathExists(txtPath)) {
                await fs.remove(txtPath);
            }
        } catch (e) {
            // Ignore cleanup errors
        }
      }
    }
  }
}

export class GroqTranscriptionProvider implements TranscriptionProvider {
  private apiKey: string;
  private apiUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GROQ_API_KEY || '';
  }

  async transcribe(filePath: string, options?: { convertAudio?: boolean }): Promise<string> {
    if (!this.apiKey) {
      logger.warn('Groq API key not configured for transcription');
      return '';
    }

    if (!(await fs.pathExists(filePath))) {
      logger.error(`Audio file not found: ${filePath}`);
      return '';
    }

    try {
      const formData = new FormData();
      formData.append('file', fs.createReadStream(filePath));
      formData.append('model', 'whisper-large-v3');

      const response = await axios.post(this.apiUrl, formData, {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${this.apiKey}`,
        },
        timeout: 60000,
      });

      return response.data.text || '';
    } catch (err) {
      logger.error(`Groq transcription error: ${err}`);
      return '';
    }
  }
}
