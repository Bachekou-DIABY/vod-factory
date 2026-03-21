export const GAME_SCREEN_DETECTOR_TOKEN = Symbol('GAME_SCREEN_DETECTOR_TOKEN');

export type GameScreenEventType = 'START' | 'END';

export interface GameScreenEvent {
  type: GameScreenEventType;
  timestamp: number; // en secondes
  confidence: number; // 0-1
  detectedText: string;
}

export interface IGameScreenDetector {
  detectEvents(videoPath: string, startSeconds?: number, endSeconds?: number): Promise<GameScreenEvent[]>;
}
