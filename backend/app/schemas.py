from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ConversationCreate(BaseModel):
    customer_name: str | None = Field(default=None, max_length=120)
    customer_email: str | None = Field(default=None, max_length=255)


class MessageView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    role: str
    content: str
    intent: str | None = None
    sentiment: str | None = None
    created_at: datetime


class TicketView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    external_id: str | None
    provider: str
    priority: str
    subject: str
    status: str
    created_at: datetime


class ConversationView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_name: str | None
    customer_email: str | None
    status: str
    language: str
    sentiment: str
    created_at: datetime
    updated_at: datetime
    messages: list[MessageView] = []
    ticket: TicketView | None = None


class ChatRequest(BaseModel):
    conversation_id: str
    message: str = Field(min_length=1, max_length=4000)


class ChatResponse(BaseModel):
    conversation_id: str
    reply: str
    intent: str
    sentiment: str
    sentiment_score: float
    language: str
    entities: dict[str, str]
    escalated: bool
    ticket: TicketView | None = None
