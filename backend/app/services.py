import re
from dataclasses import dataclass
from uuid import uuid4

import httpx

from .config import Settings


@dataclass
class Analysis:
    intent: str
    sentiment: str
    sentiment_score: float
    language: str
    entities: dict[str, str]
    should_escalate: bool


INTENT_KEYWORDS = {
    "order_status": ["where is", "track", "tracking", "order", "delivery", "shipment", "pedido", "envío"],
    "billing": ["charged", "charge", "invoice", "billing", "payment", "card", "factura", "cobro"],
    "refund": ["refund", "return", "money back", "cancel", "reembolso", "devolver"],
    "password_reset": ["password", "sign in", "login", "locked", "contraseña", "connexion"],
    "product_info": ["price", "pricing", "feature", "does it", "available", "precio", "fonctionne"],
    "human_agent": ["human", "agent", "manager", "representative", "person", "humano", "agent humain"],
    "complaint": ["terrible", "unacceptable", "complaint", "disappointed", "worst", "complain", "queja"],
}

POSITIVE = {"great", "good", "thanks", "thank", "excellent", "happy", "love", "perfect", "helpful", "gracias", "excelente"}
NEGATIVE = {"bad", "angry", "furious", "hate", "terrible", "awful", "worst", "broken", "wrong", "frustrated", "upset", "unacceptable", "charged", "failed", "horrible", "enojado", "problema"}
CRITICAL = {"lawsuit", "lawyer", "fraud", "scam", "stolen", "cancel everything", "sue", "legal", "demande"}


def detect_language(text: str) -> str:
    lower = text.lower()
    markers = {
        "es": ["hola", "necesito", "pedido", "gracias", "reembolso", "por favor", "dónde"],
        "fr": ["bonjour", "besoin", "commande", "merci", "remboursement", "s'il vous plaît"],
        "de": ["hallo", "bitte", "bestellung", "danke", "rückerstattung"],
        "hi": ["नमस्ते", "चाहिए", "ऑर्डर", "धन्यवाद"],
    }
    for language, words in markers.items():
        if any(word in lower for word in words):
            return language
    return "en"


def extract_entities(text: str) -> dict[str, str]:
    entities: dict[str, str] = {}
    email = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", text)
    order = re.search(r"(?:order|pedido|commande|#)\s*[-:#]?\s*([A-Z0-9-]{4,})", text, re.IGNORECASE)
    amount = re.search(r"(?:\$|€|£|₹)\s?\d+(?:[.,]\d{1,2})?", text)
    if email:
        entities["email"] = email.group(0)
    if order:
        entities["order_id"] = order.group(1).upper()
    if amount:
        entities["amount"] = amount.group(0)
    return entities


def analyze(text: str) -> Analysis:
    lower = text.lower()
    # Count matches instead of stopping at the first keyword. This prevents a
    # message such as “my order was charged twice” from being classified only
    # as an order-status question.
    matches = {
        candidate: sum(1 for word in words if word in lower)
        for candidate, words in INTENT_KEYWORDS.items()
    }
    intent = max(matches, key=matches.get) if max(matches.values(), default=0) else "general_question"

    tokens = set(re.findall(r"[\w'-]+", lower))
    positive_hits = sum(word in tokens or word in lower for word in POSITIVE)
    negative_hits = sum(word in tokens or word in lower for word in NEGATIVE)
    critical_hit = any(word in lower for word in CRITICAL)
    score = max(-1.0, min(1.0, (positive_hits - negative_hits) / 3))
    if critical_hit or score <= -0.66:
        sentiment = "critical"
    elif score < -0.15:
        sentiment = "angry"
    elif score > 0.2:
        sentiment = "satisfied"
    else:
        sentiment = "neutral"

    language = detect_language(text)
    should_escalate = sentiment in {"critical", "angry"} or intent in {"human_agent", "complaint"}
    return Analysis(intent, sentiment, round(score, 2), language, extract_entities(text), should_escalate)


RESPONSES = {
    "en": {
        "order_status": "I can help with your order. Please share the order number and I’ll look up its latest status.",
        "billing": "I can help review the billing issue. Please share the invoice or order number; do not send full card details.",
        "refund": "I can start a refund request. Please share the order number and the reason for the return.",
        "password_reset": "Use the “Forgot password” link on the sign-in page. If the reset email does not arrive within a few minutes, I can escalate this.",
        "product_info": "I’m happy to help with product information. Tell me which product or feature you’re considering.",
        "default": "Thanks for reaching out. Could you share a little more detail so I can point you to the right solution?",
    },
    "es": {
        "order_status": "Puedo ayudarte con tu pedido. Comparte el número de pedido y revisaré su estado.",
        "billing": "Puedo revisar el problema de facturación. Comparte el número de factura o pedido; no envíes los datos completos de tu tarjeta.",
        "refund": "Puedo iniciar una solicitud de reembolso. Comparte el número de pedido y el motivo de la devolución.",
        "default": "Gracias por contactarnos. ¿Puedes compartir un poco más de información para encontrar la solución correcta?",
    },
    "fr": {
        "order_status": "Je peux vous aider avec votre commande. Partagez le numéro de commande et je vérifierai son statut.",
        "billing": "Je peux examiner le problème de facturation. Partagez le numéro de facture ou de commande, sans les données complètes de votre carte.",
        "refund": "Je peux commencer une demande de remboursement. Partagez le numéro de commande et le motif du retour.",
        "default": "Merci de nous avoir contactés. Pouvez-vous donner un peu plus de détails ?",
    },
}


def fallback_reply(text: str, analysis: Analysis) -> str:
    """Answer locally when no LLM key is configured.

    These responses deliberately use the customer's extracted details and
    wording. They are useful in development and make the bot honest about
    unavailable live systems instead of pretending it looked up an order.
    """
    lower = text.lower()
    order_id = analysis.entities.get("order_id")
    language = analysis.language

    if language == "es":
        if analysis.intent == "password_reset":
            return "Para restablecer tu contraseña, selecciona «¿Olvidaste tu contraseña?» en la pantalla de inicio de sesión. Si no recibes el correo en unos minutos, puedo escalarlo a un agente."
        if analysis.intent == "order_status":
            reference = f" {order_id}" if order_id else ""
            return f"Veo la referencia de pedido{reference}, pero este entorno todavía no tiene acceso al sistema de envíos en tiempo real. Comparte el número completo de pedido y un agente podrá confirmar el estado." 
        if analysis.intent == "billing":
            return "Entiendo el problema de facturación. Si el cargo aparece dos veces, una de las operaciones puede ser una autorización pendiente. Comparte el número de pedido o factura —nunca los datos completos de tu tarjeta— y revisaremos el cargo."
        if analysis.intent == "refund":
            return "Puedo ayudarte a solicitar un reembolso. Necesito el número de pedido y el motivo de la devolución para iniciar la revisión."
        return "Entiendo tu pregunta. Puedo ayudarte con pedidos, facturación, reembolsos y acceso. ¿Cuál es el número de pedido o el detalle específico que quieres resolver?"

    if language == "fr":
        if analysis.intent == "password_reset":
            return "Pour réinitialiser votre mot de passe, utilisez « Mot de passe oublié » sur la page de connexion. Si l’e-mail n’arrive pas, je peux transférer la demande à un agent."
        if analysis.intent == "order_status":
            reference = f" {order_id}" if order_id else ""
            return f"Je vois la référence de commande{reference}, mais cet environnement n’a pas encore accès au suivi en temps réel. Partagez le numéro complet et un agent pourra vérifier le statut."
        if analysis.intent == "billing":
            return "Je comprends le problème de facturation. Un second montant peut être une autorisation bancaire temporaire. Partagez le numéro de commande ou de facture, sans les données complètes de votre carte, afin que nous vérifiions."
        if analysis.intent == "refund":
            return "Je peux vous aider à demander un remboursement. J’ai besoin du numéro de commande et du motif du retour pour commencer."
        return "Je comprends votre question. Je peux aider pour les commandes, la facturation, les remboursements et l’accès. Quel détail souhaitez-vous résoudre ?"

    identity_question = any(phrase in lower for phrase in ("who are you", "what are you", "your name"))
    if identity_question and analysis.intent == "refund":
        return "I’m ResolveAI, your customer-support assistant. Yes, I can help with the refund: please send the order number and tell me whether the item was returned, cancelled, or arrived damaged."
    if identity_question and analysis.intent == "order_status":
        return "I’m ResolveAI, your customer-support assistant. I can also track an order once you share its order number."
    if identity_question and analysis.intent == "billing":
        return "I’m ResolveAI, your customer-support assistant. I can also review billing issues using an order or invoice number—never send full card details."

    if analysis.intent == "password_reset":
        return "To reset your password, select “Forgot password” on the sign-in page and follow the email link. If the email does not arrive within a few minutes, I can escalate the login issue to a human agent."
    if analysis.intent == "order_status":
        if order_id:
            return f"I found order reference {order_id} in your message. I don’t have live shipping access in this demo yet, so I can’t claim a current status. An agent can verify {order_id} in the fulfillment system, or you can share the tracking link for help interpreting it."
        return "I can help track the delivery, but I need the order number first. Please send the order number (not payment-card details), and I’ll route it to the order-status workflow."
    if analysis.intent == "billing":
        if "twice" in lower or "duplicate" in lower or "two charge" in lower:
            reference = f" for order {order_id}" if order_id else ""
            return f"I’m sorry about the duplicate charge{reference}. One of the entries may be a temporary bank authorization, but we should verify it. I’ll start a billing review using the order or invoice number; please never send your full card number."
        return "I can help with the billing issue. Tell me whether the charge is incorrect, duplicated, or missing an invoice, and share the order or invoice number. Please do not send full card details."
    if analysis.intent == "refund":
        return "I can help start a refund request. Please send the order number and tell me whether the item was returned, cancelled, or arrived damaged. I’ll then route the request for review."
    if analysis.intent == "product_info":
        return "I can answer product questions, but I need the product or feature name. What are you trying to find out—pricing, availability, compatibility, or how it works?"
    if analysis.intent == "human_agent":
        return "I understand you want a human agent. I’ve marked this conversation for escalation and a support representative can take over."
    if "who are you" in lower or "what are you" in lower or "your name" in lower:
        return "I’m ResolveAI, your customer-support assistant. I can help with orders, billing, refunds, product questions, and account access."
    if analysis.sentiment in {"angry", "critical"}:
        return "I’m sorry this has been frustrating. I’ve flagged the conversation for a human agent. To help them resolve it faster, please share the order or invoice number without sending full payment details."
    return f"I understand you’re asking about: “{text.strip()}” I can help with orders, billing, refunds, product questions, and account access. Please include the relevant order number or detail, and I’ll take the next step."


def generated_reply(text: str, analysis: Analysis, settings: Settings) -> str:
    if not settings.openai_api_key:
        return fallback_reply(text, analysis)
    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.openai_api_key)
        response = client.chat.completions.create(
            model=settings.openai_model,
            temperature=0.2,
            max_tokens=180,
            messages=[
                {"role": "system", "content": "You are a concise, empathetic Tier-1 support agent. Never request full payment card details. If a human escalation is indicated, acknowledge it."},
                {"role": "user", "content": f"Language: {analysis.language}\nIntent: {analysis.intent}\nCustomer: {text}"},
            ],
        )
        return response.choices[0].message.content or fallback_reply(text, analysis)
    except Exception:
        return fallback_reply(text, analysis)


class CRMClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    def create_ticket(self, *, subject: str, description: str, customer_email: str | None, priority: str) -> tuple[str, str]:
        provider = self.settings.crm_provider.lower()
        if provider == "mock" or not self.settings.crm_webhook_url:
            return provider, f"MOCK-{uuid4().hex[:8].upper()}"

        payload = {"subject": subject, "description": description, "customer_email": customer_email, "priority": priority}
        headers = {"Authorization": f"Bearer {self.settings.crm_api_token}"} if self.settings.crm_api_token else {}
        try:
            response = httpx.post(self.settings.crm_webhook_url, json=payload, headers=headers, timeout=10)
            response.raise_for_status()
            external_id = str(response.json().get("id", response.headers.get("x-request-id", uuid4().hex[:10])))
            return provider, external_id
        except httpx.HTTPError:
            return provider, f"PENDING-{uuid4().hex[:8].upper()}"
