import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { gql } from 'graphql-tag';
import { print } from 'graphql';
import { IStartGGService, StartGGSetResponse } from '../../domain/services/startgg.service.interface';
import { Tournament } from '../../domain/entities/tournament.entity';

interface StartGGEvent {
  id: string;
  name: string;
}

interface StartGGSetNode {
  id: number | string;
  fullRoundText: string;
  winnerId: number | string | null;
  displayScore: string;
  totalGames?: number;
  startedAt?: number;
  completedAt?: number;
  stream?: {
    streamName: string;
    streamId: string;
  };
  slots: {
    entrant: {
      id: number | string;
      name: string;
    } | null;
  }[];
}

@Injectable()
export class StartGGService implements IStartGGService {
  private readonly logger = new Logger(StartGGService.name);
  private readonly apiUrl = 'https://api.start.gg/gql/alpha';
  private readonly apiToken: string;

  constructor(private readonly configService: ConfigService) {
    this.apiToken = this.configService.get<string>('STARTGG_API_TOKEN') || '';
    if (!this.apiToken) {
      this.logger.warn('STARTGG_API_TOKEN is not defined in environment variables');
    }
  }

  async getTournamentBySlug(slug: string): Promise<Omit<Tournament, 'id' | 'createdAt' | 'updatedAt'> | null> {
    const query = gql`
      query GetTournament($slug: String!) {
        tournament(slug: $slug) {
          id
          name
          slug
          startAt
          endAt
        }
      }
    `;

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          query: print(query),
          variables: { slug },
        },
        {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        }
      );

      const data = response.data?.data?.tournament;
      if (!data) return null;

      return {
        name: data.name,
        slug: data.slug.replace(/^tournament\//, ''),
        startAt: new Date(data.startAt * 1000),
        endAt: new Date(data.endAt * 1000),
        startGGId: data.id.toString(),
      };
    } catch (error) {
      this.logger.error(`Error fetching tournament: ${error.message}`);
      throw new Error('Failed to fetch data from Start.gg');
    }
  }

  async getSetsByTournamentId(startGGId: string): Promise<StartGGSetResponse[]> {
    const eventsQuery = gql`
      query GetTournamentEvents($id: ID!) {
        tournament(id: $id) {
          events {
            id
            name
          }
        }
      }
    `;

    try {
      const eventsResponse = await axios.post(
        this.apiUrl,
        { query: print(eventsQuery), variables: { id: startGGId } },
        { headers: { Authorization: `Bearer ${this.apiToken}` } }
      );

      const events = (eventsResponse.data?.data?.tournament?.events || []) as StartGGEvent[];
      const allSets: StartGGSetResponse[] = [];

      const popularGamesKeywords = ['ultimate', 'melee', 'rivals', 'roa', 'street', 'tekken', 'guilty', 'sf6', 'strive', 'smash', 'ssbu'];

      const filteredEvents = events.filter((e) =>
        popularGamesKeywords.some(keyword => e.name.toLowerCase().includes(keyword))
      );

      for (const event of filteredEvents) {
        const sets = await this.getSetsByEventId(event.id);
        allSets.push(...sets);
      }

      return allSets;
    } catch (error) {
      this.logger.error(`Error in getSetsByTournamentId: ${error.message}`);
      return [];
    }
  }

  private async getSetsByEventId(eventId: string): Promise<StartGGSetResponse[]> {
    const query = gql`
      query GetEventSets($eventId: ID!) {
        event(id: $eventId) {
          sets(page: 1, perPage: 50) {
            nodes {
              id
              fullRoundText
              winnerId
              displayScore
              totalGames
              startedAt
              completedAt
              stream {
                streamName
                streamId
              }
              slots {
                entrant {
                  id
                  name
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response = await axios.post(
        this.apiUrl,
        { query: print(query), variables: { eventId } },
        { headers: { Authorization: `Bearer ${this.apiToken}` } }
      );

      if (response.data?.errors) {
        this.logger.error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
      }

      const sets = (response.data?.data?.event?.sets?.nodes || []) as StartGGSetNode[];
      const filtered = sets.filter((s) => s.slots && s.slots.length === 2 && s.slots[0].entrant && s.slots[1].entrant);

      return filtered.filter((s) => s.stream)
        .map((s) => ({
          id: s.id.toString(),
          roundName: s.fullRoundText,
          totalGames: s.totalGames,
          streamName: s.stream?.streamName,
          winnerId: s.winnerId?.toString(),
          score: s.displayScore,
          startTime: s.startedAt ? new Date(s.startedAt * 1000).toISOString() : undefined,
          endTime: s.completedAt ? new Date(s.completedAt * 1000).toISOString() : undefined,
          stream: s.stream ? {
            streamName: s.stream.streamName,
            streamId: s.stream.streamId,
          } : undefined,
          player1: {
            id: s.slots[0].entrant!.id.toString(),
            name: s.slots[0].entrant!.name,
          },
          player2: {
            id: s.slots[1].entrant!.id.toString(),
            name: s.slots[1].entrant!.name,
          },
        }));
    } catch (error) {
      this.logger.error(`Error fetching sets for event ${eventId}: ${error.message}`);
      return [];
    }
  }
}
