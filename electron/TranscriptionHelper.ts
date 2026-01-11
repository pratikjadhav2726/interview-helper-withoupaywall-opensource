/**
 * TranscriptionHelper - Handles audio transcription using OpenAI Whisper API
 * Follows Single Responsibility Principle - only handles transcription
 */
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { configHelper } from './ConfigHelper';

export interface TranscriptionResult {
  text: string;
  language?: string;
}

export interface ITranscriptionHelper {
  transcribeAudio(audioBuffer: Buffer, mimeType?: string): Promise<TranscriptionResult>;
}

export class TranscriptionHelper implements ITranscriptionHelper {
  private openai: OpenAI | null = null;
  private readonly tempDir: string;

  constructor() {
    this.tempDir = path.join(app.getPath('temp'), 'audio-transcriptions');
    this.ensureTempDirectory();
    this.initializeOpenAI();
  }

  /**
   * Initializes OpenAI client with API key from config
   */
  private initializeOpenAI(): void {
    const config = configHelper.loadConfig();
    if (config.apiKey && config.apiKey.trim().length > 0) {
      this.openai = new OpenAI({ apiKey: config.apiKey });
    }
  }

  /**
   * Ensures temp directory exists for audio files
   */
  private ensureTempDirectory(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Transcribes audio buffer using OpenAI Whisper API
   * @param audioBuffer - Audio data as Buffer
   * @param mimeType - MIME type of the audio (default: 'audio/webm')
   * @returns Promise resolving to transcription result
   * @throws Error if transcription fails or OpenAI client not initialized
   */
  public async transcribeAudio(
    audioBuffer: Buffer, 
    mimeType: string = 'audio/webm'
  ): Promise<TranscriptionResult> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized. Please set API key.');
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Audio buffer is empty');
    }

    const tempPath = path.join(this.tempDir, `audio-${Date.now()}-${Math.random().toString(36).substring(7)}.webm`);
    
    try {
      // Write buffer to temp file
      fs.writeFileSync(tempPath, audioBuffer);
      
      // Create read stream for OpenAI API
      const file = fs.createReadStream(tempPath);
      
      // Transcribe using Whisper API
      const transcription = await this.openai.audio.transcriptions.create({
        file: file,
        model: 'whisper-1',
        language: 'en', // Optional: can be auto-detected
        response_format: 'verbose_json',
      });

      // Clean up temp file
      this.cleanupTempFile(tempPath);
      
      return {
        text: transcription.text,
        language: transcription.language,
      };
    } catch (error: any) {
      // Clean up on error
      this.cleanupTempFile(tempPath);
      
      console.error('Transcription error:', error);
      
      // Provide more specific error messages
      if (error.status === 401) {
        throw new Error('Invalid API key. Please check your OpenAI API key in settings.');
      } else if (error.status === 429) {
        throw new Error('Rate limit exceeded. Please try again in a moment.');
      } else if (error.message?.includes('file')) {
        throw new Error('Invalid audio file format. Please try recording again.');
      }
      
      throw new Error(`Transcription failed: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Safely removes temporary file
   */
  private cleanupTempFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error('Error cleaning up temp file:', error);
      // Don't throw - cleanup errors shouldn't break the flow
    }
  }

  /**
   * Checks if OpenAI client is initialized
   */
  public isInitialized(): boolean {
    return this.openai !== null;
  }
}
