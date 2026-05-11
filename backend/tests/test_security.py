from app.core.security import hash_password, verify_password, create_access_token, decode_token

def test_hash_and_verify_password():
    hashed = hash_password("secret")
    assert verify_password("secret", hashed)
    assert not verify_password("wrong", hashed)

def test_create_and_decode_access_token():
    token = create_access_token({"sub": "42", "role": "csm"})
    payload = decode_token(token)
    assert payload["sub"] == "42"
    assert payload["role"] == "csm"

def test_decode_token_invalid_raises():
    import pytest
    with pytest.raises(Exception):
        decode_token("not.a.valid.token")
