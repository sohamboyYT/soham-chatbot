# Deploy Soham's Chatbot

The app is configured as one production service: the Docker image builds the React frontend, serves it from FastAPI, and connects to PostgreSQL.

## Render deployment

1. Push this project to a GitHub repository.
2. Open [render.com](https://render.com), choose **New → Blueprint**.
3. Connect the repository and select the root `render.yaml`.
4. Add `OPENAI_API_KEY` when prompted, or leave it blank to use the built-in support responder.
5. Click **Apply**. Render provides a permanent public `onrender.com` URL.

The free plan may sleep when idle. Upgrade the web service if the chatbot needs continuous availability.

## Other Docker hosts

The root `Dockerfile` works on Railway, Fly.io, Google Cloud Run, Azure Container Apps, and any Docker host. Set:

```text
DATABASE_URL=postgresql+psycopg://...
CORS_ORIGINS=https://your-domain.example
CRM_PROVIDER=mock
OPENAI_API_KEY=optional
```

The container listens on the platform-provided `PORT` and exposes `/health` for health checks.
