from fastapi import FastAPI
from app.api.auth import router as auth_router
from app.api.accounts import router as accounts_router
from app.api.contacts import router as contacts_router
from app.api.tasks import router as tasks_router

app = FastAPI(title="CRM API", version="0.1.0")

app.include_router(auth_router)
app.include_router(accounts_router)
app.include_router(contacts_router)
app.include_router(tasks_router)

@app.get("/health")
async def health():
    return {"status": "ok"}
