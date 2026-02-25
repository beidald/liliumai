declare module 'whisper-node' {
  export interface WhisperOptions {
    modelName?: string;
    modelPath?: string;
    whisperOptions?: any;
  }

  export interface WhisperSegment {
    start: string;
    end: string;
    speech: string;
  }

  export function whisper(
    filePath: string,
    options?: WhisperOptions
  ): Promise<WhisperSegment[] | string>;
}
