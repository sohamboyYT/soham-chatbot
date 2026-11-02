# ResolveAI

ResolveAI is an AI-powered Tier-1 customer support workspace. It classifies incoming messages, extracts useful entities, scores sentiment, answers common questions, and escalates high-friction conversations to a human agent with a CRM-ready ticket.

## Included

- FastAPI service with chat, conversation, ticket, health, and dashboard endpoints.
- Deterministic NLP fallback for local development: intent recognition, entity extraction, language detection, and sentiment scoring.
- Optional OpenAI-compatible provider for richer responses.
- Automatic escalation when sentiment is angry/critical or the request needs a human.
- CRM adapter interface with a local mock provider plus webhook-compatible Zendesk and Salesforce providers.
- SQLAlchemy persistence. SQLite works out of the box; PostgreSQL is supported through `DATABASE_URL`.
- React/Vite single-page support console.
- Docker Compose for the API, frontend, and PostgreSQL.

## Run locally

### API

```powershell
cd backend
python -m venv .venv
\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

The API is available at `http://localhost:8000` and Swagger docs at `/docs`.

### Frontend

Node.js 18+ is required.

```powershell
cd frontend
npm install
npm run dev
```

The UI runs at `http://localhost:5173`.

### Docker

```powershell
docker compose up --build
```

## Configuration

Copy `backend/.env.example` to `backend/.env`. The application is fully usable without an AI key or CRM credentials. Set `OPENAI_API_KEY` to enable generated responses, and set `CRM_PROVIDER` to `zendesk` or `salesforce` with the matching webhook URL and token to send escalations to an external system.

## API examples

```text
POST /api/conversations
{ "customer_name": "Asha", "customer_email": "asha@example.com" }

POST /api/chat
{ "conversation_id": "...", "message": "I was charged twice and need help" }
```

The chat response includes the reply, intent, sentiment, extracted entities, detected language, escalation status, and ticket details when a ticket was created.

## Tests

```powershell
cd backend
pip install -r requirements.txt
pytest
```
