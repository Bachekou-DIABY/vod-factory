import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import Tesseract from 'tesseract.js';
import {
  GAME_SCREEN_DETECTOR_TOKEN,
  GameScreenEvent,
  GameScreenEventType,
  IGameScreenDetector,
} from '../../domain/interfaces/game-screen-detector.interface';

interface FrameAnalysis {
  timestamp: number;
  text: string;
  confidence: number;
}

@Injectable()
export class OcrGameScreenDetector implements IGameScreenDetector {
  private readonly logger = new Logger(OcrGameScreenDetector.name);
  private readonly templatesDir = path.join(process.cwd(), 'storage', 'templates', 'cropped');
  
  // Mots-clés à détecter
  private readonly startKeywords = ['go', 'partez', 'start', 'begin'];
  private readonly endKeywords = ['game', 'fini', 'end', 'finish', 'set'];
  
  // Seuils de détection
  private readonly confidenceThreshold = 0.7;
  private readonly minTextLength = 2;

  async detectEvents(videoPath: string): Promise<GameScreenEvent[]> {
    this.logger.log(`🔍 Analyse OCR de: ${videoPath}`);
    
    // TODO: Intégrer FFmpeg pour extraire les frames
    // Pour l'instant, simulation avec les templates de référence
    const events: GameScreenEvent[] = [];
    
    // Analyser les templates de référence pour calibration
    await this.calibrateWithTemplates();
    
    this.logger.log(`✅ Analyse terminée. ${events.length} événements détectés.`);
    return events;
  }

  private async calibrateWithTemplates(): Promise<void> {
    const templates = [
      { file: 'start_go.cropped.png', type: 'START' as GameScreenEventType, expected: 'go' },
      { file: 'start_partez.cropped.png', type: 'START' as GameScreenEventType, expected: 'partez' },
      { file: 'end_game.cropped.png', type: 'END' as GameScreenEventType, expected: 'game' },
      { file: 'end_fini.cropped.png', type: 'END' as GameScreenEventType, expected: 'fini' },
    ];

    for (const template of templates) {
      const templatePath = path.join(this.templatesDir, template.file);
      
      try {
        const result = await this.analyzeImage(templatePath);
        this.logger.debug(
          `Template ${template.file}: "${result.text}" (conf: ${(result.confidence * 100).toFixed(1)}%)`
        );
      } catch (error) {
        this.logger.warn(`Échec analyse template ${template.file}: ${error.message}`);
      }
    }
  }

  async analyzeImage(imagePath: string): Promise<FrameAnalysis> {
    try {
      const result = await Tesseract.recognize(
        imagePath,
        'fra+eng', // Français + Anglais
        {
          logger: (m) => {
            if (m.status === 'recognizing text') {
              this.logger.debug(`OCR Progress: ${(m.progress * 100).toFixed(0)}%`);
            }
          },
        }
      );

      const text = result.data.text.toLowerCase().trim();
      const confidence = result.data.confidence / 100;

      return {
        timestamp: 0, // Sera défini lors de l'analyse vidéo complète
        text,
        confidence,
      };
    } catch (error) {
      this.logger.error(`Erreur OCR sur ${imagePath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Détecte si le texte correspond à un événement de début ou fin de game
   */
  detectEventFromText(text: string, confidence: number): GameScreenEvent | null {
    if (confidence < this.confidenceThreshold) {
      return null;
    }

    const normalizedText = text.toLowerCase().trim();
    
    if (normalizedText.length < this.minTextLength) {
      return null;
    }

    // Détection START
    for (const keyword of this.startKeywords) {
      if (normalizedText.includes(keyword)) {
        return {
          type: 'START',
          timestamp: 0, // Sera défini par l'analyseur vidéo
          confidence,
          detectedText: normalizedText,
        };
      }
    }

    // Détection END
    for (const keyword of this.endKeywords) {
      if (normalizedText.includes(keyword)) {
        return {
          type: 'END',
          timestamp: 0,
          confidence,
          detectedText: normalizedText,
        };
      }
    }

    return null;
  }
}
