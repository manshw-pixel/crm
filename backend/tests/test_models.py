from app.models.user import User, UserRole
from app.models.account import Account, AccountTier, ChurnRiskTier

def test_user_model_tablename():
    assert User.__tablename__ == "users"

def test_account_model_tablename():
    assert Account.__tablename__ == "accounts"

def test_user_role_values():
    assert set(UserRole) == {"admin", "csm", "ae", "customer"}

def test_churn_risk_tier_values():
    assert set(ChurnRiskTier) == {"green", "yellow", "red"}
