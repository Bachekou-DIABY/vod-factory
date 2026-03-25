#!/bin/bash
set -e

# VOD Factory — Oracle Cloud deploy script
# Usage: ./deploy.sh [--build]
#
# First time setup:
#   1. Copy .env.production.example to .env.production and fill in values
#   2. Run: ./deploy.sh --build
#
# Update (no rebuild):
#   ./deploy.sh

ENV_FILE=".env.production"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ $ENV_FILE not found. Copy .env.production.example and fill in the values."
  exit 1
fi

if [ "$1" == "--build" ]; then
  echo "🔨 Building Docker images..."
  docker compose -f docker-compose.production.yml --env-file "$ENV_FILE" build --no-cache
fi

echo "🚀 Starting services..."
docker compose -f docker-compose.production.yml --env-file "$ENV_FILE" up -d

echo "⏳ Waiting for backend to be ready..."
sleep 5

echo "✅ Done! App running at http://$(curl -s ifconfig.me 2>/dev/null || echo 'your-server-ip')"
echo "📋 Bull Board: http://$(curl -s ifconfig.me 2>/dev/null || echo 'your-server-ip')/queues"
echo ""
echo "Useful commands:"
echo "  View logs:    docker compose -f docker-compose.production.yml logs -f backend"
echo "  Stop all:     docker compose -f docker-compose.production.yml down"
echo "  Shell into:   docker exec -it vod-factory-backend sh"
