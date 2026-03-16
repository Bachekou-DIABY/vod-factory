import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { gql } from 'graphql-tag';
import { print } from 'graphql';
import { IStartGGService, StartGGSetResponse } from '../../domain/services/startgg.service.interface';
import { Tournament } from '../../domain/entities/tournament.entity';

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
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
          },
        }
      );

      const data = response.data?.data?.tournament;

      if (!data) {
        return null;
      }

      return {
        name: data.name,
        slug: data.slug,
        startAt: new Date(data.startAt * 1000), // Start.gg renvoie des secondes, JS veut des ms
        endAt: new Date(data.endAt * 1000),
        startGGId: data.id.toString(),
      };
    } catch (error) {
      this.logger.error(`Error fetching tournament from Start.gg: ${error.message}`);
      throw new Error('Failed to fetch data from Start.gg');
    }
  }

  async getSetsByTournamentId(tournamentId: string): Promise<StartGGSetResponse[]> {
    const query = gql`
      query GetTournamentSets($id: ID!) {
        tournament(id: $id) {
          events {
            sets(page: 1, perPage: 100) {
              nodes {
                id
                fullRoundText
                bestOf
                winnerId
                displayScore
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
      }
    `;

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          query: print(query),
          variables: { id: tournamentId },
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
          },
        }
      );

      const events = response.data?.data?.tournament?.events || [];
      const allSets: StartGGSetResponse[] = [];

      for (const event of events) {
        const sets = event.sets?.nodes || [];
        for (const set of sets) {
          // On ne prend que les sets qui ont bien 2 entrants (joueurs)
          if (set.slots && set.slots.length === 2 && set.slots[0].entrant && set.slots[1].entrant) {
            allSets.push({
              id: set.id.toString(),
              roundName: set.fullRoundText,
              bestOf: set.bestOf || 3,
              winnerId: set.winnerId?.toString(),
              score: set.displayScore,
              player1: {
                id: set.slots[0].entrant.id.toString(),
                name: set.slots[0].entrant.name,
              },
              player2: {
                id: set.slots[1].entrant.id.toString(),
                name: set.slots[1].entrant.name,
              },
            });
          }
        }
      }

      return allSets;
    } catch (error) {
      this.logger.error(`Error fetching sets from Start.gg: ${error.message}`);
      throw new Error('Failed to fetch sets from Start.gg');
    }
  }
}
