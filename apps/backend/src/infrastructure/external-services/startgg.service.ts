import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { gql } from 'graphql-tag';
import { print } from 'graphql';
import { IStartGGService, StartGGEventResponse, StartGGSetResponse, StartGGTournamentSearchResult } from '../../domain/services/startgg.service.interface';
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

  async searchTournaments(query: string): Promise<StartGGTournamentSearchResult[]> {
    const gqlQuery = gql`
      query SearchTournaments($query: String!) {
        tournaments(query: { perPage: 15, filter: { name: $query } }) {
          nodes {
            id
            name
            slug
            startAt
          }
        }
      }
    `;
    try {
      const response = await axios.post(
        this.apiUrl,
        { query: print(gqlQuery), variables: { query } },
        { headers: { Authorization: `Bearer ${this.apiToken}` } },
      );
      return (response.data?.data?.tournaments?.nodes || []).map((t: any) => ({
        id: t.id.toString(),
        name: t.name,
        slug: (t.slug as string).replace(/^tournament\//, ''),
        startAt: t.startAt,
      }));
    } catch (error) {
      this.logger.error(`Error searching tournaments: ${error.message}`);
      return [];
    }
  }

  async getEventsByTournamentId(startGGTournamentId: string): Promise<StartGGEventResponse[]> {
    const query = gql`
      query GetTournamentEventsOnly($id: ID!) {
        tournament(id: $id) {
          events { id name }
        }
      }
    `;
    try {
      const response = await axios.post(
        this.apiUrl,
        { query: print(query), variables: { id: startGGTournamentId } },
        { headers: { Authorization: `Bearer ${this.apiToken}` } }
      );
      return (response.data?.data?.tournament?.events || []).map((e: StartGGEvent) => ({
        id: e.id.toString(),
        name: e.name,
      }));
    } catch (error) {
      this.logger.error(`Error fetching events: ${error.message}`);
      return [];
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
      const popularGamesKeywords = ['ultimate', 'melee', 'rivals', 'roa', 'street', 'tekken', 'guilty', 'sf6', 'strive', 'smash', 'ssbu'];
      const filteredEvents = events.filter((e) =>
        popularGamesKeywords.some(keyword => e.name.toLowerCase().includes(keyword))
      );
      const results = await Promise.all(filteredEvents.map(e => this.getSetsByEventId(e.id)));
      return results.flat();
    } catch (error) {
      this.logger.error(`Error in getSetsByTournamentId: ${error.message}`);
      return [];
    }
  }

  async getStreamSetsByEventId(eventStartGGId: string, streamName?: string): Promise<StartGGSetResponse[]> {
    const query = gql`
      query GetEventStreamSets($eventId: ID!, $page: Int!) {
        event(id: $eventId) {
          sets(page: $page, perPage: 50, filters: { state: 3 }) {
            pageInfo { totalPages }
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
      const allSets = await this.paginateEventSets(eventStartGGId, print(query));

      const filtered = allSets.filter(
        (s) =>
          s.stream &&
          s.slots?.length === 2 &&
          s.slots[0].entrant &&
          s.slots[1].entrant &&
          (!streamName || s.stream.streamName.toLowerCase() === streamName.toLowerCase())
      );

      filtered.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));

      return filtered.map((s) => ({
        id: s.id.toString(),
        roundName: s.fullRoundText,
        totalGames: s.totalGames,
        streamName: s.stream?.streamName,
        winnerId: s.winnerId?.toString() ?? '',
        score: s.displayScore,
        startTime: s.startedAt ? new Date(s.startedAt * 1000).toISOString() : undefined,
        endTime: s.completedAt ? new Date(s.completedAt * 1000).toISOString() : undefined,
        stream: s.stream ? { streamName: s.stream.streamName, streamId: s.stream.streamId } : undefined,
        player1: { id: s.slots[0].entrant!.id.toString(), name: s.slots[0].entrant!.name },
        player2: { id: s.slots[1].entrant!.id.toString(), name: s.slots[1].entrant!.name },
      }));
    } catch (error) {
      this.logger.error(`Error fetching stream sets for event ${eventStartGGId}: ${error.message}`);
      return [];
    }
  }

  async getAllSetsByEventId(eventStartGGId: string, streamName?: string): Promise<StartGGSetResponse[]> {
    const allSets: StartGGSetNode[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const query = `query { event(id: ${eventStartGGId}) { sets(page: ${page}, perPage: 50) { pageInfo { totalPages } nodes { id fullRoundText winnerId displayScore totalGames startedAt completedAt stream { streamName streamId } slots { entrant { id name } } } } } }`;
      try {
        const response = await axios.post(
          this.apiUrl,
          { query },
          { headers: { Authorization: `Bearer ${this.apiToken}` } },
        );
        if (response.data?.errors) {
          this.logger.error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
          break;
        }
        const data = response.data?.data?.event?.sets;
        if (!data) break;
        totalPages = data.pageInfo?.totalPages ?? 1;
        allSets.push(...(data.nodes as StartGGSetNode[]));
        page++;
      } catch (error) {
        this.logger.error(`Error fetching sets page ${page} for event ${eventStartGGId}: ${error.message}`);
        break;
      }
    } while (page <= totalPages);

    const valid = allSets.filter(
      (s) => s.slots?.length === 2 && s.slots[0].entrant && s.slots[1].entrant &&
        (!streamName || s.stream?.streamName?.toLowerCase() === streamName.toLowerCase()),
    );
    valid.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    return valid.map((s) => ({
      id: s.id.toString(),
      roundName: s.fullRoundText,
      totalGames: s.totalGames,
      streamName: s.stream?.streamName,
      winnerId: s.winnerId?.toString() ?? '',
      score: s.displayScore,
      startTime: s.startedAt ? new Date(s.startedAt * 1000).toISOString() : undefined,
      endTime: s.completedAt ? new Date(s.completedAt * 1000).toISOString() : undefined,
      stream: s.stream ? { streamName: s.stream.streamName, streamId: s.stream.streamId } : undefined,
      player1: { id: s.slots[0].entrant!.id.toString(), name: s.slots[0].entrant!.name },
      player2: { id: s.slots[1].entrant!.id.toString(), name: s.slots[1].entrant!.name },
    }));
  }

  private async getSetsByEventId(eventId: string): Promise<StartGGSetResponse[]> {
    const query = gql`
      query GetEventSets($eventId: ID!, $page: Int!) {
        event(id: $eventId) {
          sets(page: $page, perPage: 50, filters: { state: 3 }) {
            pageInfo { totalPages }
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
      const allSets = await this.paginateEventSets(eventId, print(query));

      return allSets
        .filter((s) => s.stream && s.slots?.length === 2 && s.slots[0].entrant && s.slots[1].entrant)
        .map((s) => ({
          id: s.id.toString(),
          roundName: s.fullRoundText,
          totalGames: s.totalGames,
          streamName: s.stream?.streamName,
          winnerId: s.winnerId?.toString(),
          score: s.displayScore,
          startTime: s.startedAt ? new Date(s.startedAt * 1000).toISOString() : undefined,
          endTime: s.completedAt ? new Date(s.completedAt * 1000).toISOString() : undefined,
          stream: s.stream ? { streamName: s.stream.streamName, streamId: s.stream.streamId } : undefined,
          player1: { id: s.slots[0].entrant!.id.toString(), name: s.slots[0].entrant!.name },
          player2: { id: s.slots[1].entrant!.id.toString(), name: s.slots[1].entrant!.name },
        }));
    } catch (error) {
      this.logger.error(`Error fetching sets for event ${eventId}: ${error.message}`);
      return [];
    }
  }

  private async paginateEventSets(eventId: string, printedQuery: string): Promise<StartGGSetNode[]> {
    const allSets: StartGGSetNode[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const response = await axios.post(
        this.apiUrl,
        { query: printedQuery, variables: { eventId, page } },
        { headers: { Authorization: `Bearer ${this.apiToken}` } }
      );

      if (response.data?.errors) {
        this.logger.error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
      }

      const data = response.data?.data?.event?.sets;
      if (!data) break;

      totalPages = data.pageInfo?.totalPages ?? 1;
      allSets.push(...(data.nodes as StartGGSetNode[]));
      page++;
    } while (page <= totalPages);

    return allSets;
  }
}
