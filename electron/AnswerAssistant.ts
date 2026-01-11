/**
 * AnswerAssistant - Generates AI-powered answer suggestions based on conversation context
 * Follows Single Responsibility Principle - only handles answer suggestion generation
 * Uses Dependency Inversion Principle - depends on IConversationManager interface
 */
import OpenAI from 'openai';
import { configHelper } from './ConfigHelper';
import { IConversationManager } from './ConversationManager';

export interface AnswerSuggestion {
  suggestions: string[];
  reasoning: string;
}

export interface IAnswerAssistant {
  generateAnswerSuggestions(
    currentQuestion: string,
    conversationManager: IConversationManager,
    screenshotContext?: string
  ): Promise<AnswerSuggestion>;
}

export class AnswerAssistant implements IAnswerAssistant {
  private openai: OpenAI | null = null;
  private readonly defaultModel: string = 'gpt-4o-mini';

  constructor() {
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
   * Generates answer suggestions based on conversation context
   * @param currentQuestion - The current interviewer question
   * @param conversationManager - Conversation manager instance (dependency injection)
   * @param screenshotContext - Optional screenshot context for coding interviews
   * @returns Promise resolving to answer suggestions
   * @throws Error if OpenAI client not initialized or request fails
   */
  public async generateAnswerSuggestions(
    currentQuestion: string,
    conversationManager: IConversationManager,
    screenshotContext?: string
  ): Promise<AnswerSuggestion> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized. Please set API key.');
    }

    if (!currentQuestion || currentQuestion.trim().length === 0) {
      throw new Error('Current question cannot be empty');
    }

    const conversationHistory = conversationManager.getConversationHistory();
    const previousAnswers = conversationManager.getIntervieweeAnswers();

    const contextPrompt = this.buildContextPrompt(
      currentQuestion,
      conversationHistory,
      previousAnswers,
      screenshotContext
    );

    try {
      const response = await this.openai.chat.completions.create({
        model: this.defaultModel,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful interview assistant that provides contextual answer suggestions based on conversation history. Provide concise, actionable suggestions.'
          },
          {
            role: 'user',
            content: contextPrompt
          }
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const suggestionsText = response.choices[0]?.message?.content || '';
      const suggestions = this.parseSuggestions(suggestionsText);

      return {
        suggestions: suggestions.length > 0 
          ? suggestions 
          : ['Consider answering based on your experience and background.'],
        reasoning: 'Based on conversation history and previous answers',
      };
    } catch (error: any) {
      console.error('Error generating suggestions:', error);
      
      // Provide specific error messages
      if (error.status === 401) {
        throw new Error('Invalid API key. Please check your OpenAI API key in settings.');
      } else if (error.status === 429) {
        throw new Error('Rate limit exceeded. Please try again in a moment.');
      }
      
      throw new Error(`Failed to generate suggestions: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Builds the context prompt for the AI
   */
  private buildContextPrompt(
    currentQuestion: string,
    conversationHistory: string,
    previousAnswers: string[],
    screenshotContext?: string
  ): string {
    let prompt = `You are an AI assistant helping someone during an interview. 
The interviewer just asked: "${currentQuestion}"

Previous conversation:
${conversationHistory || 'No previous conversation yet.'}

Previous answers the interviewee has given:
${previousAnswers.length > 0 ? previousAnswers.join('\n\n') : 'No previous answers yet.'}

Based on the current question and conversation history, provide 3-5 bullet point suggestions that:
1. Directly answer the current question
2. Reference and build upon previous answers for consistency
3. Maintain a coherent narrative
4. Are specific and actionable

Format as simple bullet points, one per line starting with "-".`;

    if (screenshotContext) {
      prompt += `\n\nAdditional context from code screenshot: ${screenshotContext}`;
    }

    return prompt;
  }

  /**
   * Parses AI response into structured suggestions
   */
  private parseSuggestions(suggestionsText: string): string[] {
    return suggestionsText
      .split('\n')
      .map(line => line.trim())
      .filter(line => {
        // Match bullet points, numbered lists, or lines starting with common prefixes
        return line.startsWith('-') || 
               line.startsWith('•') || 
               line.match(/^\d+\./) ||
               (line.length > 0 && line.length < 200); // Reasonable length
      })
      .map(line => {
        // Remove bullet/number prefixes
        return line
          .replace(/^[-•]\s*/, '')
          .replace(/^\d+\.\s*/, '')
          .trim();
      })
      .filter(line => line.length > 0 && line.length < 200); // Filter out empty or too long
  }

  /**
   * Checks if OpenAI client is initialized
   */
  public isInitialized(): boolean {
    return this.openai !== null;
  }
}
