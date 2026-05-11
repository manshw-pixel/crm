import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.dependencies import require_roles
from app.models.user import UserRole
from app.schemas.ai import TrainResponse, ModelInfoResponse, NarrativeResponse
from app.ai.churn_engine import ChurnEngine
from app.ai.ml_model import MLModel

router = APIRouter(prefix="/ai", tags=["ai"])

_MODELS_DIR = os.path.join(os.path.dirname(__file__), "../../ml_models")
_ml_model = MLModel(models_dir=_MODELS_DIR)
_engine = ChurnEngine()

@router.post("/narrative/{account_id}", response_model=NarrativeResponse)
async def get_narrative(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_roles(UserRole.csm, UserRole.admin)),
):
    result = await _engine.run(account_id, db, force_narrative=True)
    if result is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return NarrativeResponse(
        account_id=account_id,
        ai_narrative=result.get("ai_narrative"),
        generated_at=datetime.now(timezone.utc),
    )

@router.post("/train", response_model=TrainResponse)
async def train_model(
    training_data: UploadFile = File(...),
    current_user=Depends(require_roles(UserRole.admin)),
):
    import tempfile, shutil
    with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as tmp:
        shutil.copyfileobj(training_data.file, tmp)
        tmp_path = tmp.name
    try:
        result = _ml_model.train(tmp_path)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        os.unlink(tmp_path)
    return TrainResponse(**result)

@router.get("/model-info", response_model=ModelInfoResponse)
async def model_info(
    current_user=Depends(require_roles(UserRole.csm, UserRole.admin)),
):
    return ModelInfoResponse(**_ml_model.model_info())
