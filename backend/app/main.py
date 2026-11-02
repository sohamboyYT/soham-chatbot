from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .config import get_settings
from .db import Base, engine, get_db
from .models import Conversation, ConversationStatus, Message, Ticket
from .schemas import ChatRequest, ChatResponse, ConversationCreate, ConversationView, TicketView
from .services import CRMClient, analyze, generated_reply

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if (FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")


def conversation_query():
    return select(Conversation).options(selectinload(Conversation.messages), selectinload(Conversation.ticket))


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}


@app.post("/api/conversations", response_model=ConversationView, status_code=status.HTTP_201_CREATED)
def create_conversation(payload: ConversationCreate, db: Session = Depends(get_db)) -> Conversation:
    conversation = Conversation(customer_name=payload.customer_name, customer_email=payload.customer_email)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


@app.get("/api/conversations", response_model=list[ConversationView])
def list_conversations(db: Session = Depends(get_db)) -> list[Conversation]:
    return list(db.scalars(conversation_query().order_by(Conversation.updated_at.desc())).all())


@app.get("/api/conversations/{conversation_id}", response_model=ConversationView)
def get_conversation(conversation_id: str, db: Session = Depends(get_db)) -> Conversation:
    conversation = db.scalars(conversation_query().where(Conversation.id == conversation_id)).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.post("/api/chat", response_model=ChatResponse)
def chat(payload: ChatRequest, db: Session = Depends(get_db)) -> ChatResponse:
    conversation = db.scalars(select(Conversation).where(Conversation.id == payload.conversation_id)).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    text = payload.message.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Message cannot be blank")
    result = analyze(text)
    reply = generated_reply(text, result, settings)

    db.add(Message(conversation_id=conversation.id, role="user", content=text, intent=result.intent, sentiment=result.sentiment))
    db.add(Message(conversation_id=conversation.id, role="assistant", content=reply, intent=result.intent, sentiment=result.sentiment))
    conversation.language = result.language
    conversation.sentiment = result.sentiment
    conversation.status = ConversationStatus.escalated.value if result.should_escalate else ConversationStatus.open.value

    ticket = conversation.ticket
    if result.should_escalate and ticket is None:
        priority = "urgent" if result.sentiment == "critical" else "high"
        provider, external_id = CRMClient(settings).create_ticket(
            subject=f"{result.intent.replace('_', ' ').title()} support escalation",
            description=text,
            customer_email=conversation.customer_email,
            priority=priority,
        )
        ticket = Ticket(
            conversation_id=conversation.id,
            external_id=external_id,
            provider=provider,
            priority=priority,
            subject=f"{result.intent.replace('_', ' ').title()} support escalation",
        )
        db.add(ticket)

    db.commit()
    if ticket:
        db.refresh(ticket)
    return ChatResponse(
        conversation_id=conversation.id,
        reply=reply,
        intent=result.intent,
        sentiment=result.sentiment,
        sentiment_score=result.sentiment_score,
        language=result.language,
        entities=result.entities,
        escalated=result.should_escalate,
        ticket=TicketView.model_validate(ticket) if ticket else None,
    )


@app.patch("/api/conversations/{conversation_id}/resolve", response_model=ConversationView)
def resolve_conversation(conversation_id: str, db: Session = Depends(get_db)) -> Conversation:
    conversation = db.scalars(conversation_query().where(Conversation.id == conversation_id)).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conversation.status = ConversationStatus.resolved.value
    if conversation.ticket:
        conversation.ticket.status = "resolved"
    db.commit()
    return conversation


@app.patch("/api/conversations/{conversation_id}/reopen", response_model=ConversationView)
def reopen_conversation(conversation_id: str, db: Session = Depends(get_db)) -> Conversation:
    conversation = db.scalars(conversation_query().where(Conversation.id == conversation_id)).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conversation.status = ConversationStatus.open.value
    if conversation.ticket:
        conversation.ticket.status = "open"
    db.commit()
    return conversation


@app.patch("/api/conversations/{conversation_id}", response_model=ConversationView)
def update_conversation(conversation_id: str, payload: ConversationCreate, db: Session = Depends(get_db)) -> Conversation:
    conversation = db.scalars(conversation_query().where(Conversation.id == conversation_id)).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conversation.customer_name = payload.customer_name
    conversation.customer_email = payload.customer_email
    db.commit()
    return conversation


@app.get("/api/tickets", response_model=list[TicketView])
def list_tickets(db: Session = Depends(get_db)) -> list[Ticket]:
    return list(db.scalars(select(Ticket).order_by(Ticket.created_at.desc())).all())


@app.get("/api/stats")
def stats(db: Session = Depends(get_db)) -> dict[str, object]:
    total = db.scalar(select(func.count(Conversation.id))) or 0
    escalated = db.scalar(select(func.count(Conversation.id)).where(Conversation.status == ConversationStatus.escalated.value)) or 0
    resolved = db.scalar(select(func.count(Conversation.id)).where(Conversation.status == ConversationStatus.resolved.value)) or 0
    critical = db.scalar(select(func.count(Conversation.id)).where(Conversation.sentiment.in_(["angry", "critical"]))) or 0
    return {"total": total, "open": total - escalated - resolved, "escalated": escalated, "resolved": resolved, "at_risk": critical}


@app.get("/{full_path:path}")
def frontend_app(full_path: str):
    """Serve the built React app when the API is deployed as one service."""
    if full_path.startswith("api/") or full_path == "health":
        raise HTTPException(status_code=404, detail="Route not found")
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        requested = FRONTEND_DIST / full_path
        if full_path and requested.is_file():
            return FileResponse(requested)
        return FileResponse(index)
    raise HTTPException(status_code=404, detail="Frontend build not found")
