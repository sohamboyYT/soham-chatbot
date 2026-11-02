from app.config import Settings
from app.services import analyze, detect_language, extract_entities, generated_reply


def test_angry_billing_message_escalates():
    result = analyze("I am furious! You charged me twice and this is unacceptable.")
    assert result.intent == "billing"
    assert result.sentiment in {"angry", "critical"}
    assert result.should_escalate is True


def test_entities_and_multilingual_detection():
    result = analyze("Hola, necesito un reembolso para el pedido #ab-1234. Mi email es ana@example.com")
    assert result.language == "es"
    assert result.entities["order_id"] == "AB-1234"
    assert result.entities["email"] == "ana@example.com"


def test_neutral_password_response_does_not_escalate():
    result = analyze("How do I reset my password?")
    assert result.intent == "password_reset"
    assert result.should_escalate is False


def test_fallback_answers_the_specific_question():
    text = "I was charged twice for order #AB-1234"
    result = analyze(text)
    reply = generated_reply(text, result, Settings())
    assert result.intent == "billing"
    assert "duplicate charge" in reply.lower()
    assert "AB-1234" in reply
