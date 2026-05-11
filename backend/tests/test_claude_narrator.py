import pytest
from unittest.mock import MagicMock, patch
from app.ai.claude_narrator import mask_pii, arr_band, build_context, generate

def test_mask_pii_email():
    assert mask_pii("Contact john.doe@acme.com for details") == "Contact [EMAIL] for details"

def test_mask_pii_phone():
    assert mask_pii("Call +1 (555) 867-5309 today") == "Call [PHONE] today"

def test_mask_pii_multiple():
    text = "Email test@example.com or call 555-1234567"
    result = mask_pii(text)
    assert "[EMAIL]" in result
    assert "[PHONE]" in result
    assert "test@example.com" not in result

def test_mask_pii_no_pii():
    text = "Customer health is declining this quarter"
    assert mask_pii(text) == text

def test_arr_band():
    assert arr_band(None) == "unknown"
    assert arr_band(49999) == "<$50k"
    assert arr_band(50000) == "$50k–$200k"
    assert arr_band(199999) == "$50k–$200k"
    assert arr_band(200000) == ">$200k"

def test_build_context_masks_notes():
    ctx = build_context(
        tier="enterprise",
        arr=150000,
        days_to_renewal=45,
        signal_scores={"latest_nps": 20.0, "days_since_activity": 0.0},
        weights={"latest_nps": 0.20, "days_since_activity": 0.20},
        ml_result=None,
        open_tasks=2,
        high_priority_tasks=1,
        nps_scores=[7, 8],
        notes=["Called client@example.com about renewal", "Good meeting"],
        playbook_trigger_count=1,
    )
    assert "client@example.com" not in ctx
    assert "[EMAIL]" in ctx
    assert "enterprise" in ctx
    assert "$50k–$200k" in ctx

def test_generate_returns_none_on_api_error():
    with patch("app.ai.claude_narrator._get_client") as mock_client:
        mock_client.return_value.messages.create.side_effect = Exception("API error")
        result = generate(
            tier="smb", arr=30000, days_to_renewal=60,
            signal_scores={}, weights={}, ml_result=None,
            open_tasks=0, high_priority_tasks=0,
            nps_scores=[], notes=[], playbook_trigger_count=0,
        )
        assert result is None

def test_generate_returns_narrative_on_success():
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text="ASSESSMENT: Risk is low.\nACTIONS:\n1. Do A\n2. Do B\n3. Do C")]
    with patch("app.ai.claude_narrator._get_client") as mock_client:
        mock_client.return_value.messages.create.return_value = mock_response
        result = generate(
            tier="enterprise", arr=250000, days_to_renewal=90,
            signal_scores={"latest_nps": 60.0}, weights={"latest_nps": 0.20},
            ml_result=None, open_tasks=1, high_priority_tasks=0,
            nps_scores=[8], notes=["Good progress"], playbook_trigger_count=0,
        )
        assert result is not None
        assert "ASSESSMENT" in result
