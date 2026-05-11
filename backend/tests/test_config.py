from app.core.config import settings

def test_settings_has_required_fields():
    assert settings.DATABASE_URL
    assert settings.SECRET_KEY
    assert settings.ACCESS_TOKEN_EXPIRE_MINUTES > 0
