/**
 * ConversationSection - UI component for conversation recording and AI suggestions
 * Follows Single Responsibility Principle - only handles conversation UI
 * Uses existing ContentSection pattern for consistency
 * Integrates with screenshot system for cohesive experience
 */
import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AudioRecorder } from '../../utils/audioRecorder';

interface ConversationMessage {
  id: string;
  speaker: 'interviewer' | 'interviewee';
  text: string;
  timestamp: number;
  edited?: boolean;
}

interface AISuggestion {
  suggestions: string[];
  reasoning: string;
}

// Reuse the same ContentSection style from Solutions.tsx for consistency
const ContentSection = ({
  title,
  content,
  isLoading
}: {
  title: string;
  content: React.ReactNode;
  isLoading: boolean;
}) => (
  <div className="space-y-2">
    <h2 className="text-[13px] font-medium text-white tracking-wide">
      {title}
    </h2>
    {isLoading ? (
      <div className="mt-4 flex">
        <p className="text-xs bg-gradient-to-r from-gray-300 via-gray-100 to-gray-300 bg-clip-text text-transparent animate-pulse">
          Processing...
        </p>
      </div>
    ) : (
      <div className="text-[13px] leading-[1.4] text-gray-100 max-w-[600px]">
        {content}
      </div>
    )}
  </div>
);

export const ConversationSection: React.FC = () => {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [currentSpeaker, setCurrentSpeaker] = useState<'interviewer' | 'interviewee'>('interviewee');
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Use ref to track recording state for event listener
  const isRecordingRef = useRef(false);
  
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    loadConversation();
    
    const unsubscribeMessageAdded = window.electronAPI.onConversationMessageAdded((message: ConversationMessage) => {
      setMessages(prev => [...prev, message]);
      scrollToBottom();
    });
    
    const unsubscribeSpeakerChanged = window.electronAPI.onSpeakerChanged((speaker: string) => {
      setCurrentSpeaker(speaker as 'interviewer' | 'interviewee');
    });

    const unsubscribeMessageUpdated = window.electronAPI.onConversationMessageUpdated((message: ConversationMessage) => {
      setMessages(prev => prev.map(msg => msg.id === message.id ? message : msg));
    });

    const unsubscribeCleared = window.electronAPI.onConversationCleared(() => {
      setMessages([]);
      setAiSuggestions(null);
    });

    // Listen for keyboard shortcut to toggle recording
    const handleToggleRecording = async () => {
      // Check actual recording state using ref to get latest value
      const currentIsRecording = isRecordingRef.current || (audioRecorderRef.current?.getIsRecording() || false);
      if (currentIsRecording) {
        await handleStopRecording();
      } else {
        await handleStartRecording();
      }
    };

    window.addEventListener('toggle-recording', handleToggleRecording);

    return () => {
      unsubscribeMessageAdded();
      unsubscribeSpeakerChanged();
      unsubscribeMessageUpdated();
      unsubscribeCleared();
      window.removeEventListener('toggle-recording', handleToggleRecording);
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadConversation = async () => {
    try {
      const result = await window.electronAPI.getConversation();
      if (result.success) {
        setMessages(result.messages);
        scrollToBottom();
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const handleStartRecording = async () => {
    try {
      // Check if already recording
      if (audioRecorderRef.current?.getIsRecording()) {
        console.log('Already recording');
        return;
      }
      
      if (!audioRecorderRef.current) {
        audioRecorderRef.current = new AudioRecorder();
      }
      
      await audioRecorderRef.current.startRecording();
      setIsRecording(true);
      isRecordingRef.current = true;
      setRecordingDuration(0);
      
      // Start duration counter
      durationIntervalRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (error: any) {
      console.error('Failed to start recording:', error);
      alert(error.message || 'Failed to start recording. Please check microphone permissions.');
    }
  };

  const handleStopRecording = async () => {
    // Check recorder state directly instead of React state to avoid stale closures
    if (!audioRecorderRef.current || !audioRecorderRef.current.getIsRecording()) {
      console.log('Not recording, cannot stop');
      return;
    }
    
    setIsRecording(false);
    isRecordingRef.current = false;
    
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    
    setIsProcessing(true);
    try {
      const audioBlob = await audioRecorderRef.current.stopRecording();
      
      // Convert blob to ArrayBuffer
      const arrayBuffer = await audioBlob.arrayBuffer();
      
      // Transcribe
      const transcribeResult = await window.electronAPI.transcribeAudio(arrayBuffer, audioBlob.type);
      
      if (transcribeResult.success && transcribeResult.result) {
        const text = transcribeResult.result.text;
        
        // Add message
        await window.electronAPI.addConversationMessage(text, currentSpeaker);
        
        // If interviewer question, get AI suggestions
        if (currentSpeaker === 'interviewer') {
          await fetchAISuggestions(text);
        }
        // Don't clear suggestions when interviewee responds - user needs to see them!
      }
    } catch (error: any) {
      console.error('Failed to process recording:', error);
      alert(error.message || 'Failed to process recording');
    } finally {
      setIsProcessing(false);
      setRecordingDuration(0);
    }
  };

  const fetchAISuggestions = async (question: string) => {
    try {
      // Get problem statement from query cache if available (from screenshots)
      const problemStatement = queryClient.getQueryData(['problem_statement']) as any;
      let screenshotContext: string | undefined;
      
      if (problemStatement?.problem_statement) {
        screenshotContext = `Problem Statement: ${problemStatement.problem_statement}\nConstraints: ${problemStatement.constraints || 'N/A'}\nExample Input: ${problemStatement.example_input || 'N/A'}\nExample Output: ${problemStatement.example_output || 'N/A'}`;
      }
      
      const result = await window.electronAPI.getAnswerSuggestions(question, screenshotContext);
      if (result.success && result.suggestions) {
        setAiSuggestions(result.suggestions);
      }
    } catch (error: any) {
      console.error('Failed to get AI suggestions:', error);
      // Don't show alert for suggestion errors - it's not critical
    }
  };

  const handleToggleSpeaker = async () => {
    try {
      const result = await window.electronAPI.toggleSpeaker();
      if (result.success) {
        setCurrentSpeaker(result.speaker);
        // Don't clear suggestions - user needs to see them when preparing their answer!
      }
    } catch (error) {
      console.error('Failed to toggle speaker:', error);
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Recording Controls - Always visible at top */}
      <div className="flex items-center gap-3 flex-wrap flex-shrink-0 mb-3">
        <button
          onClick={isRecording ? handleStopRecording : handleStartRecording}
          disabled={isProcessing}
          className={`px-3 py-1.5 rounded text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
            isRecording
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
        >
          {isRecording ? `⏹ Stop (${formatDuration(recordingDuration)})` : '⏺ Start Recording'}
        </button>
        
        <button
          onClick={handleToggleSpeaker}
          disabled={isRecording || isProcessing}
          className="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {currentSpeaker === 'interviewer' ? '👤 Interviewer' : '🎤 You'}
        </button>
        
        {isProcessing && (
          <span className="text-xs text-white/70">Processing...</span>
        )}
      </div>

      {/* Scrollable Conversation Area - Takes remaining space above AI suggestions */}
      <div 
        className="overflow-y-auto flex-1 min-h-0 mb-3 pr-2"
        style={{ 
          maxHeight: aiSuggestions ? 'calc(100% - 180px)' : '100%',
          scrollBehavior: 'smooth'
        }}
      >
        {messages.length > 0 && (
          <ContentSection
            title="Conversation"
            content={
              <div className="space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex flex-col ${
                      message.speaker === 'interviewer' ? 'items-start' : 'items-end'
                    }`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg p-2.5 ${
                        message.speaker === 'interviewer'
                          ? 'bg-blue-600/20 border border-blue-500/30'
                          : 'bg-green-600/20 border border-green-500/30'
                      }`}
                    >
                      <div className="text-xs text-white/60 mb-1">
                        {message.speaker === 'interviewer' ? '👤 Interviewer' : '🎤 You'}
                      </div>
                      <div className="text-white text-[13px]">{message.text}</div>
                      <div className="text-xs text-white/40 mt-1">
                        {formatTime(message.timestamp)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            }
            isLoading={false}
          />
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* AI Suggestions - Fixed at bottom, always visible, never scrolls */}
      {aiSuggestions && (
        <div className="flex-shrink-0 border-t border-white/10 pt-3 bg-black/60 -mx-4 -mb-4 px-4 pb-4">
          <ContentSection
            title="🤖 AI Answer Suggestions"
            content={
              <div className="space-y-3">
                <div className="space-y-1">
                  {aiSuggestions.suggestions.map((suggestion, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <div className="w-1 h-1 rounded-full bg-purple-400/80 mt-2 shrink-0" />
                      <div className="text-[13px]">{suggestion}</div>
                    </div>
                  ))}
                </div>
              </div>
            }
            isLoading={false}
          />
        </div>
      )}
    </div>
  );
};
